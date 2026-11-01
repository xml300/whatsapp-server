import type { NextFunction, Request, Response } from "express";
import { ApiKeys } from "../data/models/api-keys.js";

export default async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const rawApiKey = req.headers["x-api-key"];

    if (!rawApiKey || typeof rawApiKey !== "string" || !rawApiKey.trim()) {
        return res.status(401).json({
            success: false,
            error: {
                code: 401,
                message: "API Key is required"
            }
        });
    }

    const apiKey = rawApiKey.trim();
    const apiKeyData = await ApiKeys.get(apiKey);
    if (!apiKeyData) {
        return res.status(401).json({
            success: false,
            error: {
                code: 401,
                message: "Invalid API Key"
            }
        });
    }

    res.locals.userId = apiKeyData.userId;
    res.locals.apiKey = apiKeyData.apiKey;
    return next();
}