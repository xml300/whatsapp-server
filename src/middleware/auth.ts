import type { NextFunction, Request, Response } from "express";
import { Users } from "../lib/dataStore.js";

export default async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const apiKey = req.headers["x-api-key"] as string;

    if(!apiKey){
        return res.json({status: "error", message: "API Key is required"})
    }

    const user = await Users.get(apiKey);
    if(!user || !user.phoneNumber){
        return res.json({status: "error", message: "Invalid API Key"})
    }

    req.apiKey = apiKey;
    return next();
}