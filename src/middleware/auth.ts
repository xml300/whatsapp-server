import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { ApiKeys } from "../data/models/api-keys.js";
import { Config } from "../lib/config.js";

export default async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (typeof authHeader === "string") {
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (match && match[1].trim()) {
            const token = match[1].trim();
            try {
                const payload = jwt.verify(token, Config.JWT_SECRET) as JwtPayload;
                const userId = payload.userId || payload.sub;
                if (!userId || typeof userId !== "string") {
                    return res.status(401).json({
                        success: false,
                        error: {
                            code: 401,
                            message: "Invalid Bearer token: missing userId"
                        }
                    });
                }

                res.locals.userId = userId;
                res.locals.token = token;
                return next();
            } catch (err) {
                return res.status(401).json({
                    success: false,
                    error: {
                        code: 401,
                        message: "Invalid or expired Bearer token"
                    }
                });
            }
        }
    }

    const rawApiKey = req.headers["x-api-key"] || req.headers["X-Api-Key"];
    if (rawApiKey && typeof rawApiKey === "string" && rawApiKey.trim()) {
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

    return res.status(401).json({
        success: false,
        error: {
            code: 401,
            message: "Authentication required: provide 'Authorization: Bearer <token>' or 'x-api-key' header"
        }
    });
}
