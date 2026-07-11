import { Router } from "express";
import { createHash } from "crypto";
import { Users } from "../../data/models/users.js";
import { logger } from "../../lib/logger.js";
import validate from "../../middleware/validate.js";

const router = Router();

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
        return res.json({
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