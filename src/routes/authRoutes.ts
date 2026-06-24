import { Router } from "express";
import { createHash } from "crypto";
import { Users } from "../data/models/users.js";
import { whatsappService } from "../lib/whatsappService.js";
import authMiddleware from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import validate from "../middleware/validate.js";
import { rules } from "../utils/validators.js";
import { sendSuccess, sendError } from "../utils/helpers.js";

const router = Router();

router.post("/me", validate([rules.phoneNumber()]), async (req, res) => {
    const {phoneNumber} = req.body;
    const user = await Users.getByPhoneNumber(phoneNumber);
    if(!user) {
        return sendError(res, "User not found", 404);
    }
    return sendSuccess(res, {
        message: "User found",
        apiKey: user.apiKey
    });
})

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: User's phone number
 *     responses:
 *       200:
 *         description: User registered successfully
 */
router.post('/register', validate([rules.phoneNumber()]), async (req, res) => {
    const { phoneNumber } = req.body;

    try {
        const userId = createHash('sha256').update(phoneNumber).digest('hex');
        const apiKey = crypto.randomUUID();
        const user = await Users.create({ _id: userId, apiKey, phoneNumber });
        return sendSuccess(res, { apiKey });
    } catch (error) {
        logger.error("Failed to create user " + error)
        return sendError(res, "Failed to create user", 500);
    }
});

router.post("/api-key/regenerate", authMiddleware, async (req, res) => {
    const apiKey = req.apiKey;
    const user = await Users.get(apiKey);
    if (!user || !user.phoneNumber) {
        return sendError(res, "Invalid API Key", 401);
    }
    const phoneNumber = user.phoneNumber;
    if (!phoneNumber) {
        return sendError(res, "Invalid phone number", 400);
    }
    
    try {
        const status = await whatsappService.disconnect(apiKey);
        const newApiKey = crypto.randomUUID();
        await Users.update(phoneNumber, { apiKey: newApiKey });
        return sendSuccess(res, { apiKey: newApiKey, serviceStatus: status });
    } catch (error) {
        logger.error("Failed to regenerate API key " + error)
        return sendError(res, "Failed to regenerate API key", 500);
    }
});

/**
 * @openapi
 * /api/auth/connect:
 *   post:
 *     summary: Connect to WhatsApp
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Connection status and QR code if available
 */
router.post('/connect', authMiddleware, async (req, res) => {
    const apiKey = req.apiKey;
    const user = await Users.get(apiKey);
    if (!user || !user.phoneNumber) {
        return sendError(res, "Invalid API Key", 401);
    }
    const status = await whatsappService.connect(apiKey, user.phoneNumber);
    return sendSuccess(res, { serviceStatus: status });
});

/**
 * @openapi
 * /api/auth/connect/status:
 *   get:
 *     summary: Get connection status
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Whether the connection is ready
 */
router.get('/connect/status', authMiddleware, async (req, res) => {
    const apiKey = req.apiKey;
    const user = await Users.get(apiKey);
    if (!user || !user.phoneNumber) {
        return sendError(res, "Invalid API Key", 401);
    }
    const isConnected = whatsappService.isConnected(apiKey);
    const isPairingReady = whatsappService.isConnectionReady(apiKey);
    return sendSuccess(res, { isConnected, isPairingReady });
});

/**
 * @openapi
 * /api/auth/connect/qr:
 *   get:
 *     summary: Get QR code for connection
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: QR code string
 */
router.get('/connect/qr', authMiddleware, async (req, res) => {
    const apiKey = req.apiKey;
    const user = await Users.get(apiKey);
    if (!user || !user.phoneNumber) {
        return sendError(res, "Invalid API Key", 401);
    }
    const qr = whatsappService.getQrCode(apiKey);
    return sendSuccess(res, { qr });
});

/**
 * @openapi
 * /api/auth/connect/pairing-code:
 *   get:
 *     summary: Get pairing code for connection
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Pairing code string
 */
router.get('/connect/pairing-code', authMiddleware, async (req, res) => {
    const apiKey = req.apiKey;
    const user = await Users.get(apiKey);
    if (!user || !user.phoneNumber) {
        return sendError(res, "Invalid API Key", 401);
    }
    const pairingCode = await whatsappService.getPairingCode(apiKey, user.phoneNumber);
    return sendSuccess(res, { pairingCode });
});

router.post('/disconnect', authMiddleware, async (req, res) => {
    const apiKey = req.apiKey;
    const user = await Users.get(apiKey);
    if (!user || !user.phoneNumber) {
        return sendError(res, "Invalid API Key", 401);
    }
    const status = await whatsappService.disconnect(apiKey);
    return sendSuccess(res, { serviceStatus: status ? "disconnected" : "failed to disconnect" });
});


export default router;