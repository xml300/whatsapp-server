import type { Request, Response, NextFunction } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { Config } from "../lib/config.js";

export default function userAuthMiddleware(req: Request, res: Response, next: NextFunction){
    const authToken = req.cookies.auth_token;
    if(!authToken){
        return res.status(401).json({
            success: false,
            error: {
                code: 401,
                message: "Unauthorized"
            }
        })
    }
    try {
        const payload = jwt.verify(authToken, Config.JWT_SECRET) as JwtPayload;
        res.locals.userId = payload.userId; 
        next();
    } catch (error) {
        if(error instanceof jwt.JsonWebTokenError){
            return res.status(401).json({
                success: false,
                error: {
                    code: 401,
                    message: "Unauthorized"
                }
            })
        }
        next(error);
    }
}