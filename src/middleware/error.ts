import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.js";
import { sendError } from "../utils/request.js";

export default async function errorMiddleware(err: Error, req: Request, res: Response, next: NextFunction){
    logger.error(err);
    return sendError(res, err.message || "Internal Server Error", 500);
}