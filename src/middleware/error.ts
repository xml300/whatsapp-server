import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.js";

export default async function errorMiddleware(err: Error, req: Request, res: Response, next: NextFunction){
    logger.error(err);
    return res.status(500).json({
        status: "error",
        message: err.message || "Internal Server Error"
    });
}