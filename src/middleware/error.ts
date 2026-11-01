import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.js";
import { WhatsappServiceError } from "../errors/whatsapp-errors.js";
import { isBoom } from "@hapi/boom";

const ERROR_STATUS_MAP: Record<string, number> = {
    SESSION_NOT_FOUND: 404,
    NOT_CONNECTED: 409,
    RECIPIENT_NOT_ON_WHATSAPP: 400,
    INVALID_MESSAGE_KEY: 400,
    UNSUPPORTED_MEDIA_TYPE: 415,
    BLOCKED_URL: 403,
    TRANSPORT_ERROR: 502,
};

export default function errorMiddleware(err: any, req: Request, res: Response, next: NextFunction) {
    logger.error(err?.stack || err?.message || err);

    if (res.headersSent) {
        return next(err);
    }

    // 1. WhatsApp domain errors
    if (err instanceof WhatsappServiceError) {
        const statusCode = ERROR_STATUS_MAP[err.code] || 400;
        return res.status(statusCode).json({
            success: false,
            error: {
                code: statusCode,
                message: err.message,
                type: err.code
            }
        });
    }

    // 2. Boom errors (from Baileys or HTTP utilities)
    if (isBoom(err)) {
        const statusCode = err.output.statusCode;
        return res.status(statusCode).json({
            success: false,
            error: {
                code: statusCode,
                message: err.message || err.output.payload.message
            }
        });
    }

    // 3. Multer errors
    if (err?.name === "MulterError") {
        const statusCode = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        return res.status(statusCode).json({
            success: false,
            error: {
                code: statusCode,
                message: err.message
            }
        });
    }

    // 4. Default fallback
    const statusCode = typeof err?.statusCode === "number" ? err.statusCode : 500;
    return res.status(statusCode).json({
        success: false,
        error: {
            code: statusCode,
            message: statusCode === 500 ? "Internal Server Error" : (err.message || "An error occurred")
        }
    });
}