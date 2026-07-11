import { Router } from "express";
import { Users } from "../../data/models/users.js";
import { logger } from "../../lib/logger.js";
import validate from "../../middleware/validate.js";

const router = Router();

router.post('/login', validate({ 
    body: { 
        username: "required|string",
        password: "required|string"
    } 
}), async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await Users.getByUsername(username);
        if(!user) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 401,
                    message: "Invalid credentials"
                }
            });
        }

        const isPasswordValid = user.password === password;
        if(!isPasswordValid) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 401,
                    message: "Invalid credentials"
                }
            });
        }
        return res.cookie('auth_token', user, {
            httpOnly: true,
            sameSite: 'strict',
            maxAge: 60 * 60 * 24 * 7
        }).json({
            success: true,
            data: { user }
        });
    } catch (error) {
        logger.error("Failed to create user " + error)
        return res.status(500).json({
            success: false,
            error: {
                code: 500,
                message: "Failed to create user"
            }
        });
    }
});



router.post('/register', validate({ 
    body: { 
        phoneNumber: "required|phoneNumber",
        username: "required|string",
        password: "required|string"
    } 
}), async (req, res) => {
    const { username, password, phoneNumber } = req.body;

    try {
        const user = await Users.create({ phoneNumber, username, password });
        return res.cookie('auth_token', user, {
            httpOnly: true,
            sameSite: 'strict',
            maxAge: 60 * 60 * 24 * 7
        }).json({
            success: true,
            data: { user }
        });
    } catch (error) {
        logger.error("Failed to create user " + error)
        return res.status(500).json({
            success: false,
            error: {
                code: 500,
                message: "Failed to create user"
            }
        });
    }
});


export default router;