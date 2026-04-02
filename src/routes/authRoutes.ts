import { Router } from "express";
import { createHash } from "crypto";
import { dataStore } from "../lib/dataStore.js";
import { whatsappService } from "../lib/whatsappService.js";
import authMiddleware from "../middleware/auth.js";
import { normalizePhoneNumber } from "../utils/helpers.js";
import { logger } from "../lib/logger.js";

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
router.post('/register', async (req, res) => {
    const { phoneNumber: phoneNum } = req.body;
    if (!phoneNum) {
        return res.json({ status: "error", message: "Phone number is required" })
    }
    const phoneNumber = normalizePhoneNumber(phoneNum);
    if (!phoneNumber) {
        return res.json({ status: "error", message: "Invalid phone number" })
    }

    try {
        const userId = createHash('sha256').update(phoneNumber).digest('hex');
        const apiKey = crypto.randomUUID();
        const user = await dataStore.createUser({ id: userId, apiKey, phoneNumber });
        return res.json({ status: "success", apiKey });
    } catch (error) {
        logger.error("Failed to create user " + error)
        return res.json({ status: "error", message: "Failed to create user" })
    }
});

router.post("/api-key/regenerate", async (req, res) => {
    const { phoneNumber: phoneNum, apiKey } = req.body;
    if (!phoneNum) {
        return res.json({ status: "error", message: "Phone number is required" })
    }
    const phoneNumber = normalizePhoneNumber(phoneNum);
    if (!phoneNumber) {
        return res.json({ status: "error", message: "Invalid phone number" })
    }

    const user = await dataStore.getUser(apiKey);
    if (!user || user.phoneNumber !== phoneNumber) {
        return res.json({ status: "error", message: "Invalid API Key" })
    }

    try {
        const status = await whatsappService.disconnect(apiKey);
        const newApiKey = crypto.randomUUID();
        await dataStore.updateUser(phoneNumber, { apiKey: newApiKey });
        return res.json({ status: "success", apiKey: newApiKey, serviceStatus: status });
    } catch (error) {
        logger.error("Failed to regenerate API key " + error)
        return res.json({ status: "error", message: "Failed to regenerate API key" })
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
    const user = await dataStore.getUser(apiKey);
    if (!user || !user.phoneNumber) {
        return res.json({ status: "error", message: "Invalid API Key" })
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
    const apiKey = req.apiKey;
    const user = await dataStore.getUser(apiKey);
    if (!user || !user.phoneNumber) {
        return res.json({ status: "error", message: "Invalid API Key" })
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
    const apiKey = req.apiKey;
    const user = await dataStore.getUser(apiKey);
    if (!user || !user.phoneNumber) {
        return res.json({ status: "error", message: "Invalid API Key" })
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
    const apiKey = req.apiKey;
    const user = await dataStore.getUser(apiKey);
    if (!user || !user.phoneNumber) {
        return res.json({ status: "error", message: "Invalid API Key" })
    }
    const pairingCode = await whatsappService.getPairingCode(apiKey, user.phoneNumber);
    return res.json({ status: "success", pairingCode });
});

router.post('/disconnect', authMiddleware, async (req, res) => {
    const apiKey = req.apiKey;
    const user = await dataStore.getUser(apiKey);
    if (!user || !user.phoneNumber) {
        return res.json({ status: "error", message: "Invalid API Key" });
    }
    const status = await whatsappService.disconnect(apiKey);
    return res.json({ status: "success", serviceStatus: status ? "disconnected" : "failed to disconnect" });
});


export default router;