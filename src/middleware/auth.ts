import type { NextFunction, Request, Response } from "express";
import { Users } from "../data/models/users.js";
import { sendError } from "../utils/helpers.js";

export default async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const apiKey = req.headers["x-api-key"] as string;

    if(!apiKey){
        return sendError(res, "API Key is required", 401);
    }

    const user = await Users.get(apiKey);
    if(!user || !user.phoneNumber){
        return sendError(res, "Invalid API Key", 401);
    }

    req.apiKey = apiKey;
    return next();
}