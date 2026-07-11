import express from "express";
import { Users } from "../../data/models/users.js";
import { whatsappService } from "../../lib/whatsapp.js";
import authMiddleware from "../../middleware/auth.js";

const router = express.Router();

router.post('/', authMiddleware, async (req, res) => {
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

router.get('/status', authMiddleware, async (req, res) => {
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

router.get('/qr', authMiddleware, async (req, res) => {
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

router.get('/pairing-code', authMiddleware, async (req, res) => {
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

router.post('/end', authMiddleware, async (req, res) => {
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