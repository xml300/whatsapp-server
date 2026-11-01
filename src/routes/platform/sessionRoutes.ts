import express from "express";
import userAuthMiddleware from "../../middleware/user-auth.js";
import { PhoneNumber, Session } from "../../data/db.js";
import validate from "../../middleware/validate.js";
import { createHash } from "crypto";

const router = express.Router();
router.use(userAuthMiddleware);

router.get("/", async (req, res) => {
    const userId = res.locals.userId;
    const sessions = await Session.find({ userId: userId });
    return res.json({
        success: true,
        data: {
            sessions
        }
    });
});

router.post("/", validate({
    body: {
        phoneNumber: "required|phoneNumber"
    }
}), async (req, res) => {
    const { phoneNumber } = req.body;
    const userId = res.locals.userId;
    await PhoneNumber.create({
        userId: userId,
        phoneNumber: phoneNumber
    });
    const session = await Session.create({
        id: createHash('sha256').update(userId + phoneNumber).digest('hex'),
        userId,
        phoneNumber
    });

    return res.json({
        success: true,
        data: {
            session
        }
    });

});

export default router;