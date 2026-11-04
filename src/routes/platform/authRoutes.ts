import { Router, type Request, type CookieOptions } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Users } from "../../data/models/users.js";
import validate from "../../middleware/validate.js";
import { Config } from "../../lib/config.js";

const router = Router();

function getAuthCookieOptions(req: Request, includeMaxAge = true): CookieOptions {
    const forwardedProto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim();
    const isSecure = process.env.NODE_ENV === "production" || req.secure || forwardedProto === "https";
    return {
        httpOnly: true,
        sameSite: isSecure ? "none" : "lax",
        secure: isSecure,
        partitioned: isSecure,
        path: "/",
        ...(includeMaxAge ? { maxAge: 1000 * 60 * 60 } : {})
    };
}

router.post('/login', validate({
    body: {
        username: "required|string",
        password: "required|string"
    }
}), async (req, res) => {
    const { username, password } = req.body;


    const user = await Users.getByUsername(username);
    if (!user) {
        return res.status(401).json({
            success: false,
            error: {
                code: 401,
                message: "Invalid credentials"
            }
        });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
        return res.status(401).json({
            success: false,
            error: {
                code: 401,
                message: "Invalid credentials"
            }
        });
    }
    const token = jwt.sign({ userId: user._id }, Config.JWT_SECRET, {
        expiresIn: "1h"
    });
    return res.cookie('auth_token', token, getAuthCookieOptions(req, true)).json({
        success: true,
        data: {
            token,
            tokenType: "Bearer",
            expiresIn: 3600,
            user: {
                username: user.username, 
                createdAt: user.createdAt
            }
        }
    });

});



router.post('/register', validate({
    body: {
        username: "required|string",
        password: "required|string"
    }
}), async (req, res) => {
    const { username, password } = req.body;

    const existingUser = await Users.getByUsername(username);
    if (existingUser) {
        return res.status(409).json({
            success: false,
            error: {
                code: 409,
                message: "Username already taken"
            }
        });
    }

    const user = await Users.create({ username, password });
    const token = jwt.sign({ userId: user._id }, Config.JWT_SECRET, {
        expiresIn: "1h"
    });
    return res.cookie('auth_token', token, getAuthCookieOptions(req, true)).json({
        success: true,
        data: {
            token,
            tokenType: "Bearer",
            expiresIn: 3600,
            user: {
                username: user.username,
                createdAt: user.createdAt
            }
        }
    });

});

/**
 * Standard OAuth 2.0 Token Endpoint
 * Supports Resource Owner Password Credentials (grant_type=password)
 * Returns RFC 6749 compliant token response
 */
router.post('/oauth/token', async (req, res) => {
    const grantType = req.body.grant_type || "password";
    const username = req.body.username;
    const password = req.body.password;

    if (grantType !== "password") {
        return res.status(400).json({
            error: "unsupported_grant_type",
            error_description: "Only grant_type=password is currently supported"
        });
    }

    if (!username || !password) {
        return res.status(400).json({
            error: "invalid_request",
            error_description: "Missing username or password"
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
});

router.post('/logout', (req, res) => {
    return res.clearCookie('auth_token', getAuthCookieOptions(req, false)).json({
        success: true,
        data: {
            message: "Logged out successfully"
        }
    });
});

export default router;