import type { Request, Response, NextFunction } from "express";

export function normalizeOrigin(raw: string): string {
    const cleaned = raw.trim().replace(/^['"]+|['"]+$/g, "").trim().replace(/\/+$/, "");
    if (!cleaned || cleaned === "*") return cleaned;
    try {
        return new URL(cleaned).origin.toLowerCase();
    } catch {
        return cleaned.toLowerCase();
    }
}

export function getAllowedOrigins(): string[] {
    const rawAllowed = process.env.CORS_ORIGIN || "http://localhost:3000";
    return rawAllowed
        .split(",")
        .map(normalizeOrigin)
        .filter(Boolean);
}

/**
 * Middleware that strictly verifies the Origin / Referer header on platform routes (/api/*).
 * Blocks cross-site requests or unauthorized origins from executing platform operations.
 */
export function platformOriginGuard(req: Request, res: Response, next: NextFunction) {
    // OPTIONS preflight is handled by CORS middleware
    if (req.method === "OPTIONS") {
        return next();
    }

    const allowedOrigins = getAllowedOrigins();

    const rawOrigin = req.headers.origin as string | undefined;
    const requestOrigin = rawOrigin ? normalizeOrigin(rawOrigin) : undefined;
    const requestReferer = req.headers.referer as string | undefined;

    let refererOrigin: string | null = null;
    if (requestReferer) {
        try {
            const parsed = new URL(requestReferer);
            refererOrigin = parsed.origin.toLowerCase();
        } catch {
            refererOrigin = null;
        }
    }

    // Determine the effective origin of the caller
    const effectiveOrigin = requestOrigin || refererOrigin;

    // If no origin or referer is present (e.g. direct server-to-server or non-browser)
    // and route is not in production, allow it; in production, require matching origin
    if (!effectiveOrigin) {
        if (process.env.NODE_ENV === "production") {
            return res.status(404).json({
                success: false,
                error: {
                    code: 404,
                    message: `Route ${req.method} ${req.originalUrl} not found`
                }
            });
        }
        return next();
    }

    const isAllowed = allowedOrigins.includes("*") || allowedOrigins.includes(effectiveOrigin);

    if (!isAllowed) {
        return res.status(404).json({
            success: false,
            error: {
                code: 404,
                message: `Route ${req.method} ${req.originalUrl} not found`
            }
        });
    }

    next();
}
