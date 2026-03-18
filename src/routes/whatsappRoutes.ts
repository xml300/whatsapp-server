import express from "express";
import { whatsappService } from "../lib/whatsappService.js";
import multer from "multer";
import authMiddleware from "../middleware/auth.js";
import { logger } from "../lib/logger.js";

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();
router.use(authMiddleware);

router.get('/stream', (req, res) => {
    res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive'
    });

    res.write(`data: {"status": "connected"}\n\n`);

    whatsappService.on('message', (apiKey, message) => {
        if (apiKey === req.apiKey) {
            return;
        }
        res.write(`event:message\ndata: ${JSON.stringify(message)}\n\n`);
    });

    req.on('close', () => {
        console.log('Client disconnected');
        res.end();
    })
});

router.get('/status', (req, res) => {
    const apiKey = req.apiKey;
    const connected = whatsappService.isConnected(apiKey);
    const connectionReady = whatsappService.isConnectionReady(apiKey);
    res.json({ status: connected ? "connected" : "disconnected", connected, connectionReady });
})

router.get('/qr', (req, res) => {
    const apiKey = req.apiKey;
    const qr = whatsappService.getQrCode(apiKey);
    if (qr) {
        res.json({ status: "success", qr });
    } else {
        res.status(404).json({ status: "error", message: "No QR code available" });
    }
});

router.get('/pair-code', async (req, res) => {
    const apiKey = req.apiKey;
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
        return res.status(400).json({ status: "error", message: "Phone number is required" });
    }
    const code = await whatsappService.getPairingCode(apiKey, phoneNumber);
    if (code) {
        res.json({ status: "success", code });
    } else {
        res.json({ status: "error", message: "No pairing code available" })
    }
})

router.post('/send/typing', (req, res) => {
    const apiKey = req.apiKey;
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
        return res.status(400).json({ status: "error", message: "Phone number is required" });
    }
    whatsappService.sendTyping(apiKey, phoneNumber);
    res.json({ status: "success", message: "Typing sent successfully" });
});

router.post('/send/text', async (req, res) => {
    const apiKey = req.apiKey;
    const { phoneNumber, message } = req.body;
    if (!phoneNumber || !message) {
        return res.status(400).json({ status: "error", message: "Phone number and message are required" });
    }
    await whatsappService.sendMessage(apiKey, phoneNumber, message);
    res.json({ status: "success", message: "Message sent successfully" });
});

router.post('/send/file', upload.single('file'), async (req, res) => {
    const apiKey = req.apiKey;
    const { phoneNumber, caption } = req.body;
    const file = req.file;
    logger.info({ body: req.body, file: req.file })
    if (!phoneNumber || !file) {
        return res.status(400).json({ status: "error", message: "Phone number and file are required" });
    }
    const newFile = new File([Buffer.from(file.buffer)], file.originalname, { type: file.mimetype, lastModified: Date.now() });
    await whatsappService.sendMediaFile(apiKey, phoneNumber, newFile, caption);
    res.json({ status: "success", message: "File sent successfully" });
});

export default router;