import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Users } from "../../data/models/users.js";
import validate from "../../middleware/validate.js";
import { Config } from "../../lib/config.js";

const router = Router();

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
    return res.cookie('auth_token', token, {
        httpOnly: true,
        sameSite: 'none',
        secure: true,
        maxAge: 1000 * 60 * 60
    }).json({
        success: true,
        data: {
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
    return res.cookie('auth_token', token, {
        httpOnly: true,
        sameSite: 'none',
        secure: true,
        maxAge: 1000 * 60 * 60
    }).json({
        success: true,
        data: {
            user: {
                username: user.username,
                createdAt: user.createdAt
            }
        }
    });

});

router.post('/logout', (req, res) => {
    return res.clearCookie('auth_token', {
        httpOnly: true,
        sameSite: 'none',
        secure: true
    }).json({
        success: true,
        data: {
            message: "Logged out successfully"
        }
    });
});

export default router;