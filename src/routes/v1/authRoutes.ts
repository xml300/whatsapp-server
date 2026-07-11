import { Router } from "express";
import { createHash } from "crypto";
import { Users } from "../../data/models/users.js";
import { whatsappService } from "../../lib/whatsapp.js";
import authMiddleware from "../../middleware/auth.js";
import { logger } from "../../lib/logger.js";
import validate from "../../middleware/validate.js";
import { rules } from "../../utils/validators.js";

const router = Router();

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
    const { username, password, phoneNumber } = req.body;

    try {
        const userId = createHash('sha256').update(phoneNumber).digest('hex');
        const user = await Users.create({ _id: userId, phoneNumber, username, password });
        return res.json({ status: "success", user });
    } catch (error) {
        logger.error("Failed to create user " + error)
        return res.status(500).json({ status: "error", message: "Failed to create user" });
    }
});

router.post("/api-key/regenerate", authMiddleware, async (req, res) => {
    const apiKey = res.locals.apiKey;
    const user = await Users.get(apiKey);
    if (!user || !user.phoneNumber) {
        return res.status(401).json({ status: "error", message: "Invalid API Key" });
    }
    const phoneNumber = user.phoneNumber;
    if (!phoneNumber) {
        return res.status(400).json({ status: "error", message: "Invalid phone number" });
    }

    try {
        const status = await whatsappService.disconnect(apiKey);
        const newApiKey = crypto.randomUUID();
        await Users.update(phoneNumber, { apiKey: newApiKey });
        return res.json({ status: "success", apiKey: newApiKey, serviceStatus: status });
    } catch (error) {
        logger.error("Failed to regenerate API key " + error)
        return res.status(500).json({ status: "error", message: "Failed to regenerate API key" });
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
    const apiKey = res.locals.apiKey;
    const user = await Users.get(apiKey);
    if (!user || !user.phoneNumber) {
        return res.status(401).json({ status: "error", message: "Invalid API Key" });
    }
    const status = await whatsappService.connect(apiKey, user.phoneNumber);
    return res.json({ status: "success", serviceStatus: status });
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
    const apiKey = res.locals.apiKey;
    const user = await Users.get(apiKey);
    if (!user || !user.phoneNumber) {
        return res.status(401).json({ status: "error", message: "Invalid API Key" });
    }
    const isConnected = whatsappService.isConnected(apiKey);
    const isPairingReady = whatsappService.isConnectionReady(apiKey);
    return res.json({ status: "success", isConnected, isPairingReady });
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
    const apiKey = res.locals.apiKey;
    const user = await Users.get(apiKey);
    if (!user || !user.phoneNumber) {
        return res.status(401).json({ status: "error", message: "Invalid API Key" });
    }
    const qr = whatsappService.getQrCode(apiKey);
    return res.json({ status: "success", qr });
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
    const apiKey = res.locals.apiKey;
    const user = await Users.get(apiKey);
    if (!user || !user.phoneNumber) {
        return res.status(401).json({ status: "error", message: "Invalid API Key" });
    }
    const pairingCode = await whatsappService.getPairingCode(apiKey, user.phoneNumber);
    return res.json({ status: "success", pairingCode });
});

router.post('/disconnect', authMiddleware, async (req, res) => {
    const apiKey = res.locals.apiKey;
    const user = await Users.get(apiKey);
    if (!user || !user.phoneNumber) {
        return res.status(401).json({ status: "error", message: "Invalid API Key" });
    }
    const status = await whatsappService.disconnect(apiKey);
    return res.json({ status: "success", serviceStatus: status ? "disconnected" : "failed to disconnect" });
});


export default router;