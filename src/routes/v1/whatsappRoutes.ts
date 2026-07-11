import express from "express";
import { whatsappService } from "../../lib/whatsapp.js";
import multer from "multer";
import authMiddleware from "../../middleware/auth.js";
import { logger } from "../../lib/logger.js";
import validate from "../../middleware/validate.js";
import { rules } from "../../utils/validators.js";

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

/**
 * @openapi
 * /api/stream:
 *   get:
 *     summary: Connect to message stream (SSE)
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Event source stream
 */
router.get('/stream', authMiddleware, (req, res) => {
    res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive'
    });

    res.write(`data: {"status": "connected"}\n\n`);

    const listener = (apiKey: string, message: any) => {
        if (apiKey !== res.locals.apiKey) {
            return;
        }
        res.write(`event:message\ndata: ${JSON.stringify(message)}\n\n`);
    }

    whatsappService.on('message', listener);

    req.on('close', () => {
        logger.info('Client disconnected');
        whatsappService.off('message', listener);
        res.end();
    })
});

/**
 * @openapi
 * /api/send/typing:
 *   post:
 *     summary: Send typing indicator
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phoneNumber:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Phone number required
 */
router.post('/send/typing', authMiddleware, validate([rules.phoneNumber()]), async (req, res) => {
    const apiKey = res.locals.apiKey;
    const { phoneNumber } = req.body;
    const success = await whatsappService.sendTyping(apiKey, phoneNumber);

    if (!success) {
        return res.status(400).json({ status: "error", message: "Failed to send typing indicator" });
    }

    return res.json({ status: "success", message: "Typing sent successfully" });
});

/**
 * @openapi
 * /api/send/text:
 *   post:
 *     summary: Send text message
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phoneNumber:
 *                 type: string
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Phone number and message required
 */
router.post('/send/text', authMiddleware, validate([rules.phoneNumber(), rules.message]), async (req, res) => {
    const apiKey = res.locals.apiKey;
    const { phoneNumber, message } = req.body;
    const success = await whatsappService.sendMessage(apiKey, phoneNumber, message);
    if (!success) {
        return res.status(400).json({ status: "error", message: "Failed to send message" });
    }
    return res.json({ status: "success", message: "Message sent successfully" });
});

/**
 * @openapi
 * /api/send/file:
 *   post:
 *     summary: Send media file
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               phoneNumber:
 *                 type: string
 *               caption:
 *                 type: string
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Phone number and file required
 */
router.post('/send/file', authMiddleware, upload.single('file'), validate([rules.phoneNumber(), rules.file]), async (req, res) => {
    const apiKey = res.locals.apiKey;
    const { phoneNumber, caption } = req.body;
    const file = req.file!;
    logger.info({ body: req.body, file: req.file?.originalname });
    const success = await whatsappService.sendMediaFile(apiKey, phoneNumber, file, caption);
    if (!success) {
        return res.status(400).json({ status: "error", message: "Failed to send file" });
    }
    return res.json({ status: "success", message: "File sent successfully" });
});

export default router;