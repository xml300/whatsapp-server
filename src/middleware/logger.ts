import type { Request, Response, NextFunction } from "express";

const colors = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
} as const;

function colorForStatus(status: number): string {
    if (status >= 500) return colors.red;
    if (status >= 400) return colors.yellow;
    if (status >= 300) return colors.cyan;
    return colors.green;
}

function colorForMethod(method: string): string {
    switch (method) {
        case "GET": return colors.green;
        case "POST": return colors.cyan;
        case "PUT": return colors.yellow;
        case "DELETE": return colors.red;
        default: return colors.magenta;
    }
}

export function loggingMiddleware(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();

    res.on("finish", () => {
        const durationNs = process.hrtime.bigint() - start;
        const durationMs = Number(durationNs) / 1_000_000;

        const status = res.statusCode;
        const contentLength = res.getHeader("content-length") ?? "-";
        const timestamp = new Date().toISOString();

        const methodColor = colorForMethod(req.method);
        const statusColor = colorForStatus(status);

        console.log(
            `${colors.dim}[${timestamp}]${colors.reset} ` +
            `${methodColor}${req.method}${colors.reset} ` +
            `${req.originalUrl} ` +
            `${statusColor}${status}${colors.reset} ` +
            `${contentLength} - ` +
            `${colors.dim}${durationMs.toFixed(2)}ms${colors.reset}`
        );
    });

    next();
}
