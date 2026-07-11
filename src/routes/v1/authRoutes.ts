import { Router } from "express";
import { Users } from "../../data/models/users.js";
import validate from "../../middleware/validate.js";

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

    const isPasswordValid = user.password === password;
    if (!isPasswordValid) {
        return res.status(401).json({
            success: false,
            error: {
                code: 401,
                message: "Invalid credentials"
            }
        });
    }
    return res.cookie('auth_token', { userId: user._id, phoneNumber: user.phoneNumber }, {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 7
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
    return res.cookie('auth_token', { userId: user._id, phoneNumber: user.phoneNumber }, {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 7
    }).json({
        success: true,
        data: { user }
    });

});


export default router;