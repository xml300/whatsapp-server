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
    const token = jwt.sign({ userId: user._id, phoneNumber: user.phoneNumber }, Config.JWT_SECRET, {
        expiresIn: "1h"
    });
    return res.cookie('auth_token', token, {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 1000 * 60 * 60
    }).json({
        success: true,
        data: { user }
    });

});



router.post('/register', validate({
    body: {
        phoneNumber: "required|phoneNumber",
        username: "required|string",
        password: "required|string"
    }
}), async (req, res) => {
    const { username, password, phoneNumber } = req.body;
    const user = await Users.create({ phoneNumber, username, password });
    const token = jwt.sign({ userId: user._id, phoneNumber: user.phoneNumber }, Config.JWT_SECRET, {
        expiresIn: "1h"
    });
    return res.cookie('auth_token', token, {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 1000 * 60 * 60
    }).json({
        success: true,
        data: { user }
    });

});


export default router;