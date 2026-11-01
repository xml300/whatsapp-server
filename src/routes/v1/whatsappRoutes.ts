import express from "express";
import { whatsappService } from "../../lib/whatsapp-manager.js";
import multer from "multer";
import authMiddleware from "../../middleware/auth.js";
import { logger } from "../../lib/logger.js";
import validate from "../../middleware/validate.js";
import { Session } from "../../data/db.js";
import { Events } from "../../data/models/events.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const router = express.Router();
router.use(authMiddleware);

router.get('/events', async (req, res) => {
    const userId = res.locals.userId;
    const { sessionId, eventType, after, limit } = req.query;

    if (sessionId) {
        const session = await Session.findOne({ id: sessionId as string, userId });
        if (!session) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 404,
                    message: "Session not found"
                }
            });
        }
    }

    const parsedLimit = limit ? parseInt(limit as string, 10) : 50;

    const result = await Events.getEvents({
        userId,
        sessionId: sessionId as string | undefined,
        eventType: eventType as string | undefined,
        after: after as string | undefined,
        limit: isNaN(parsedLimit) ? 50 : parsedLimit
    });

    return res.json({
        success: true,
        data: result
    });
});

router.delete('/events', async (req, res) => {
    const userId = res.locals.userId;
    const sessionId = req.query.sessionId as string;

    if (!sessionId) {
        return res.status(400).json({
            success: false,
            error: {
                code: 400,
                message: "sessionId query parameter is required"
            }
        });
    }

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: {
                code: 404,
                message: "Session not found"
            }
        });
    }

    const result = await Events.clearEventsForSession(userId, sessionId);
    return res.json({
        success: true,
        data: {
            deletedCount: result.deletedCount
        }
    });
});

router.get('/stream', (req, res) => {
    return res.status(410).json({
        success: false,
        error: {
            code: 410,
            message: "SSE stream has been retired. Please use event polling at GET /api/v1/events"
        }
    });
});

router.post('/send/typing', validate({
    body: {
        sessionId: "required|string",
        phoneNumber: "required|phoneNumber"
    }
}), async (req, res) => {
    const { sessionId, phoneNumber } = req.body;
    const userId = res.locals.userId;
    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: {
                code: 404,
                message: "Session not found"
            }
        });
    }

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
    const userId = res.locals.userId;
    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: {
                code: 404,
                message: "Session not found"
            }
        });
    }

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
    const userId = res.locals.userId;
    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: {
                code: 404,
                message: "Session not found"
            }
        });
    }

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