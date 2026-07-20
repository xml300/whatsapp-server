import express from "express";
import { whatsappService } from "../../lib/whatsapp.js";
import multer from "multer";
import authMiddleware from "../../middleware/auth.js";
import { logger } from "../../lib/logger.js";
import validate from "../../middleware/validate.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const router = express.Router();
router.use(authMiddleware);

router.get('/stream', (req, res) => {
    res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive'
    });

    res.write(`data: {"status": "connected"}\n\n`);

    const messageListener = (apiKey: string, message: any) => {
        if (apiKey !== res.locals.apiKey) {
            return;
        }
        res.write(`event:message\ndata: ${JSON.stringify(message)}\n\n`);
    }

    const updateListener = (apiKey: string, update: any) => {
        if (apiKey !== res.locals.apiKey) {
            return;
        }
        // res.write(`event:message-update\ndata: ${JSON.stringify(update)}\n\n`);
    }

    whatsappService.on('message', messageListener);
    whatsappService.on('message.update', updateListener);

    req.on('close', () => {
        logger.info('Client disconnected');
        whatsappService.off('message', messageListener);
        whatsappService.off('message.update', updateListener);
        res.end();
    })
});

router.post('/send/typing', validate({
    body: {
        sessionId: "required|string",
        phoneNumber: "required|phoneNumber"
    }
}), async (req, res) => {
    const { sessionId, phoneNumber } = req.body;
    const success = await whatsappService.sendTyping(sessionId, phoneNumber);

    if (!success) {
        return res.status(400).json({
            success: false,
            error: {
                code: 400,
                message: "Failed to send typing indicator"
            }
        });
    }

    return res.json({
        success: true,
        data: { message: "Typing sent successfully" }
    });
});

router.post('/send/text', validate({
    body: {
        sessionId: "required|string",
        phoneNumber: "required|phoneNumber",
        message: "required|message"
    }
}), async (req, res) => {
    const { sessionId, phoneNumber, message } = req.body;
    const success = await whatsappService.sendMessage(sessionId, phoneNumber, message);
    if (!success) {
        return res.status(400).json({
            success: false,
            error: {
                code: 400,
                message: "Failed to send message"
            }
        });
    }
    return res.json({
        success: true,
        data: { message: "Message sent successfully" }
    });
});

router.post('/send/file', upload.single('file'), validate({
    body: {
        sessionId: "required|string",
        phoneNumber: "required|phoneNumber",
        caption: "string"
    },
    file: "required|file"
}), async (req, res) => {
    const { sessionId, phoneNumber, caption } = req.body;
    const file = req.file!;
    logger.info({ body: req.body, file: req.file?.originalname });
    const success = await whatsappService.sendMediaFile(sessionId, phoneNumber, file, caption);
    if (!success) {
        return res.status(400).json({
            success: false,
            error: {
                code: 400,
                message: "Failed to send file"
            }
        });
    }
    return res.json({
        success: true,
        data: { message: "File sent successfully" }
    });
});


 

export default router;