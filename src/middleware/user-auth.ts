import type { Request, Response, NextFunction } from "express";

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
    
    next();
}