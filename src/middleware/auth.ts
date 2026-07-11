import type { NextFunction, Request, Response } from "express";
import { Users } from "../data/models/users.js";

export default async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const apiKey = req.headers["x-api-key"] as string;

    if(!apiKey){
        return res.status(401).json({
            status: "error",
            message: "API Key is required"
        });
    }

    const user = await Users.get(apiKey);
    if(!user || !user.phoneNumber){
        return res.status(401).json({
            status: "error",
            message: "Invalid API Key"
        });
    }

    res.locals.apiKey = apiKey;
    return next();
}