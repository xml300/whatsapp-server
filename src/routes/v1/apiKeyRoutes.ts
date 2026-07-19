import { Router } from "express";
import { Users } from "../../data/models/users.js";
import { whatsappService } from "../../lib/whatsapp.js";
import { logger } from "../../lib/logger.js";
import userAuthMiddleware from "../../middleware/user-auth.js";
import { ApiKeys } from "../../data/models/api-keys.js";

const router = Router();
router.use(userAuthMiddleware);

router.get("/", async (req, res) => {
    const userId = res.locals.userId;
    const apiKeys = await ApiKeys.getByUserId(userId); 
    return res.json({
        success: true,
        data: { apiKeys }
    });
});

router.post("/create", async (req, res) => {
    const userId = res.locals.userId;
    const phoneNumber = res.locals.phoneNumber;
    if (!phoneNumber) {
        return res.status(400).json({
            success: false,
            error: {
                code: 400,
                message: "Invalid phone number"
            }
        });
    }
    const newApiKey = crypto.randomUUID();
    await ApiKeys.create({ userId, apiKey: newApiKey });
    return res.json({
        success: true,
        data: { apiKey: newApiKey }
    });

});

router.post("/regenerate", async (req, res) => {
    const apiKey = res.locals.apiKey;
    const userId = res.locals.userId;
    const user = await Users.getById(userId);
    if (!user || !user.phoneNumber) {
        return res.status(401).json({
            success: false,
            error: {
                code: 401,
                message: "Invalid API Key"
            }
        });
    }
    const phoneNumber = user.phoneNumber;
    if (!phoneNumber) {
        return res.status(400).json({
            success: false,
            error: {
                code: 400,
                message: "Invalid phone number"
            }
        });
    }

    try {
        const status = await whatsappService.disconnect(apiKey);
        const newApiKey = crypto.randomUUID();
        await Users.update(phoneNumber, { apiKey: newApiKey });
        return res.json({
            success: true,
            data: { apiKey: newApiKey, serviceStatus: status }
        });
    } catch (error) {
        logger.error("Failed to regenerate API key " + error)
        return res.status(500).json({
            success: false,
            error: {
                code: 500,
                message: "Failed to regenerate API key"
            }
        });
    }
});


export default router;