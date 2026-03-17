import type { NextFunction, Request, Response } from "express";
import { dataStore } from "../lib/dataStore.js";

export default function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const apiKey: string = req.headers["x-api-key"] as string;

    if(!apiKey){
        return res.json({status: "error", message: "API Key is required"})
    }

    const user = dataStore.readData(apiKey);
    if(!user || !user.phoneNumber){
        return res.json({status: "error", message: "Invalid API Key"})
    }

    req.apiKey = apiKey;

    return next();
}