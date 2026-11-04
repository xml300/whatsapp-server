import { Router, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Users } from "../data/models/users.js";
import { Config } from "../lib/config.js";

const router = Router();

export function handleOAuthMetadata(req: Request, res: Response) {
    const host = req.get("host") || "localhost:3000";
    const forwardedProto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim();
    const protocol = forwardedProto || req.protocol || "http";
    const baseUrl = `${protocol}://${host}`;

    res.json({
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
        grant_types_supported: ["password"],
        response_types_supported: ["token"],
        scopes_supported: ["whatsapp:read", "whatsapp:messages:send", "whatsapp:messages:modify", "whatsapp:admin"]
    });
}

export async function handleTokenExchange(req: Request, res: Response) {
    const grantType = req.body?.grant_type || "password";
    const username = req.body?.username;
    const password = req.body?.password;

    if (grantType !== "password") {
        return res.status(400).json({
            error: "unsupported_grant_type",
            error_description: "Only grant_type=password is currently supported"
        });
    }

    if (!username || !password) {
        return res.status(400).json({
            error: "invalid_request",
            error_description: "Missing username or password in request body"
        });
    }

    const user = await Users.getByUsername(username);
    if (!user) {
        return res.status(401).json({
            error: "invalid_grant",
            error_description: "Invalid credentials"
        });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
        return res.status(401).json({
            error: "invalid_grant",
            error_description: "Invalid credentials"
        });
    }

    const token = jwt.sign({ userId: user._id, sub: user._id }, Config.JWT_SECRET, {
        expiresIn: "1h"
    });

    return res.json({
        access_token: token,
        token_type: "Bearer",
        expires_in: 3600,
        user_id: user._id
    });
}

router.post("/token", handleTokenExchange);

export default router;
