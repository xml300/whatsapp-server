import type { Request, Response, NextFunction } from "express";

/**
 * Middleware that strictly verifies the Origin / Referer header on platform routes (/api/*).
 * Blocks cross-site requests or unauthorized origins from executing platform operations.
 */
export function platformOriginGuard(req: Request, res: Response, next: NextFunction) {
    // OPTIONS preflight is handled by CORS middleware
    if (req.method === "OPTIONS") {
        return next();
    }

    const rawAllowed = process.env.CORS_ORIGIN || "http://localhost:3000";
    const allowedOrigins = rawAllowed
        .split(",")
        .map((o) => o.trim().replace(/\/+$/, "").toLowerCase())
        .filter(Boolean);

    const requestOrigin = (req.headers.origin as string | undefined)?.trim().replace(/\/+$/, "").toLowerCase();
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
