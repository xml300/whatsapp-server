import type { Response } from "express";

export function sendSuccess(res: Response, data: any = null, meta: any = null, statusCode = 200) {
    return res.status(statusCode).json({
        success: true,
        data,
        meta: meta ? meta : undefined
    });
}

export function sendError(res: Response, message: string, statusCode = 400, details?: any[]) {
    return res.status(statusCode).json({
        success: false,
        error: {
            message,
            ...(details ? { details } : {})
        }
    });
}