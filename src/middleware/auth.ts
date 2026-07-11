import type { NextFunction, Request, Response } from "express";
import { Users } from "../data/models/users.js";
import { ApiKeys } from "../data/models/api-keys.js";

export default async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const apiKey = req.headers["x-api-key"] as string;

    if(!apiKey){
        return res.status(401).json({
            success: false,
            error: {
                code: 401,
                message: "API Key is required"
            }
        });
    }

    const apiKeyData = await ApiKeys.get(apiKey);
    if(!apiKeyData){
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