import { Router } from "express";
import { createHash } from "crypto";
import { Users } from "../../data/models/users.js";
import { whatsappService } from "../../lib/whatsapp.js";
import authMiddleware from "../../middleware/auth.js";
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
        const userId = createHash('sha256').update(phoneNumber).digest('hex');
        const user = await Users.create({ _id: userId, phoneNumber, username, password });
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

router.post("/api-key/regenerate", authMiddleware, async (req, res) => {
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

router.post('/connect', authMiddleware, async (req, res) => {
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
    const status = await whatsappService.connect(apiKey, user.phoneNumber);
    return res.json({
        success: true,
        data: { serviceStatus: status }
    });
});

router.get('/connect/status', authMiddleware, async (req, res) => {
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
    const isConnected = whatsappService.isConnected(apiKey);
    const isPairingReady = whatsappService.isConnectionReady(apiKey);
    return res.json({
        success: true,
        data: { isConnected, isPairingReady }
    });
});

router.get('/connect/qr', authMiddleware, async (req, res) => {
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
    const qr = whatsappService.getQrCode(apiKey);
    return res.json({
        success: true,
        data: { qr }
    });
});

router.get('/connect/pairing-code', authMiddleware, async (req, res) => {
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
    const pairingCode = await whatsappService.getPairingCode(apiKey, user.phoneNumber);
    return res.json({
        success: true,
        data: { pairingCode }
    });
});

router.post('/disconnect', authMiddleware, async (req, res) => {
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
    const status = await whatsappService.disconnect(apiKey);
    return res.json({
        success: true,
        data: { serviceStatus: status ? "disconnected" : "failed to disconnect" }
    });
});


export default router;