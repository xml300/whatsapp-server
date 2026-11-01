import express from "express";
import { existsSync, mkdirSync } from "fs";
import { unlink } from "fs/promises";
import { join, extname } from "path";
import { randomUUID } from "crypto";
import mongoose from "mongoose";
import type { WAMessageKey } from "baileys";
import { whatsappService } from "../../lib/whatsapp-manager.js";
import multer from "multer";
import authMiddleware from "../../middleware/auth.js";
import { logger } from "../../lib/logger.js";
import validate from "../../middleware/validate.js";
import { Outbox, Session } from "../../data/db.js";
import { Events } from "../../data/models/events.js";
import { outboxEngine } from "../../lib/outbox.js";
import { validateMediaUrl } from "../../utils/url.js";
import { SsrfBlockedUrlError, UnsupportedMediaTypeError } from "../../errors/whatsapp-errors.js";
import { formatJid } from "../../utils/format.js";

const OUTBOX_MEDIA_DIR = "data/outbox-media";
mkdirSync(OUTBOX_MEDIA_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        mkdirSync(OUTBOX_MEDIA_DIR, { recursive: true });
        cb(null, OUTBOX_MEDIA_DIR);
    },
    filename: (_req, file, cb) => {
        const ext = extname(file.originalname || "") || "";
        cb(null, `${randomUUID()}${ext}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

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

    await whatsappService.sendTyping(sessionId, phoneNumber);

    return res.json({
        success: true,
        data: { message: "Typing sent successfully" }
    });
});

router.post('/send/text', validate({
    body: {
        sessionId: "required|string",
        phoneNumber: "required|phoneNumber",
        message: "required|message",
        simulateTyping: "boolean"
    }
}), async (req, res) => {
    const { sessionId, phoneNumber, message } = req.body;
    const userId = res.locals.userId;
    const idempotencyKey = (req.header("Idempotency-Key") || req.header("idempotency-key"))?.trim();

    await whatsappService.isEligibleForOutbox(sessionId, userId);

    const { doc, deduplicated } = await outboxEngine.enqueue({
        userId,
        sessionId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        recipientJid: formatJid(phoneNumber),
        actionType: "text",
        payload: { phoneNumber, message },
        simulateTyping: Boolean(req.body.simulateTyping)
    });

    return res.status(202).json({
        success: true,
        data: {
            outboxId: String(doc._id),
            messageId: doc.waMessageId,
            remoteJid: doc.recipientJid,
            status: doc.status.toLowerCase(),
            idempotencyKey: doc.idempotencyKey,
            deduplicated,
            message: deduplicated ? "Duplicate request; returning existing outbox item" : "Message queued for delivery"
        }
    });
});

router.post('/send/file', upload.single('file'), validate({
    body: {
        sessionId: "required|string",
        phoneNumber: "required|phoneNumber",
        caption: "string",
        simulateTyping: "boolean"
    },
    file: "required|file"
}), async (req, res) => {
    const { sessionId, phoneNumber, caption } = req.body;
    const userId = res.locals.userId;
    const idempotencyKey = (req.header("Idempotency-Key") || req.header("idempotency-key"))?.trim();
    const file = req.file!;

    try {
        await whatsappService.isEligibleForOutbox(sessionId, userId);

        const { doc, deduplicated } = await outboxEngine.enqueue({
            userId,
            sessionId,
            ...(idempotencyKey ? { idempotencyKey } : {}),
            recipientJid: formatJid(phoneNumber),
            actionType: "media_file",
            payload: {
                phoneNumber,
                ...(caption ? { caption } : {}),
                filePath: file.path,
                originalName: file.originalname,
                mimeType: file.mimetype
            },
            simulateTyping: Boolean(req.body.simulateTyping)
        });

        return res.status(202).json({
            success: true,
            data: {
                outboxId: String(doc._id),
                messageId: doc.waMessageId,
                remoteJid: doc.recipientJid,
                status: doc.status.toLowerCase(),
                idempotencyKey: doc.idempotencyKey,
                deduplicated,
                message: deduplicated ? "Duplicate request; returning existing outbox item" : "File queued for delivery"
            }
        });
    } catch (err) {
        if (req.file?.path) {
            await unlink(req.file.path).catch(() => {});
        }
        throw err;
    }
});

router.post('/send/media', validate({
    body: {
        sessionId: "required|string",
        phoneNumber: "required|phoneNumber",
        mediaType: "required|string",
        mediaUrl: "required|string",
        caption: "string",
        simulateTyping: "boolean"
    }
}), async (req, res) => {
    const { sessionId, phoneNumber, mediaType, mediaUrl, caption } = req.body;
    const userId = res.locals.userId;
    const idempotencyKey = (req.header("Idempotency-Key") || req.header("idempotency-key"))?.trim();

    await whatsappService.isEligibleForOutbox(sessionId, userId);

    const validated = await validateMediaUrl(mediaUrl);
    if (!validated) {
        throw new SsrfBlockedUrlError(sessionId);
    }

    const { doc, deduplicated } = await outboxEngine.enqueue({
        userId,
        sessionId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        recipientJid: formatJid(phoneNumber),
        actionType: "media_url",
        payload: {
            phoneNumber,
            mediaType,
            mediaUrl,
            ...(caption ? { caption } : {})
        },
        simulateTyping: Boolean(req.body.simulateTyping)
    });

    return res.status(202).json({
        success: true,
        data: {
            outboxId: String(doc._id),
            messageId: doc.waMessageId,
            remoteJid: doc.recipientJid,
            status: doc.status.toLowerCase(),
            idempotencyKey: doc.idempotencyKey,
            deduplicated,
            message: deduplicated ? "Duplicate request; returning existing outbox item" : "Media queued for delivery"
        }
    });
});

router.post('/send/voice', upload.single('file'), validate({
    body: {
        sessionId: "required|string",
        phoneNumber: "required|phoneNumber",
        simulateTyping: "boolean"
    },
    file: "required|file"
}), async (req, res) => {
    const { sessionId, phoneNumber } = req.body;
    const userId = res.locals.userId;
    const idempotencyKey = (req.header("Idempotency-Key") || req.header("idempotency-key"))?.trim();
    const file = req.file!;

    try {
        const mimeGroup = file.mimetype?.toLowerCase().split(';')[0]?.trim() || "";
        if (!mimeGroup.startsWith("audio/")) {
            await unlink(file.path).catch(() => {});
            throw new UnsupportedMediaTypeError(sessionId, file.mimetype);
        }

        await whatsappService.isEligibleForOutbox(sessionId, userId);

        const { doc, deduplicated } = await outboxEngine.enqueue({
            userId,
            sessionId,
            ...(idempotencyKey ? { idempotencyKey } : {}),
            recipientJid: formatJid(phoneNumber),
            actionType: "voice",
            payload: {
                phoneNumber,
                filePath: file.path,
                originalName: file.originalname,
                mimeType: file.mimetype
            },
            simulateTyping: Boolean(req.body.simulateTyping)
        });

        return res.status(202).json({
            success: true,
            data: {
                outboxId: String(doc._id),
                messageId: doc.waMessageId,
                remoteJid: doc.recipientJid,
                status: doc.status.toLowerCase(),
                idempotencyKey: doc.idempotencyKey,
                deduplicated,
                message: deduplicated ? "Duplicate request; returning existing outbox item" : "Voice note queued for delivery"
            }
        });
    } catch (err) {
        if (req.file?.path) {
            await unlink(req.file.path).catch(() => {});
        }
        throw err;
    }
});

router.get('/contacts/:phoneNumber/on-whatsapp', validate({
    params: {
        phoneNumber: "required|phoneNumber"
    },
    query: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const phoneNumber = req.params.phoneNumber as string;
    const sessionId = req.query.sessionId as string;
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

    const exists = await whatsappService.isOnWhatsapp(sessionId, phoneNumber);
    return res.json({
        success: true,
        data: {
            phoneNumber,
            exists: !!exists
        }
    });
});

router.post('/messages/react', validate({
    body: {
        sessionId: "required|string",
        messageId: "required|string",
        remoteJid: "required|string",
        emoji: "required|string"
    }
}), async (req, res) => {
    const { sessionId, messageId, remoteJid, emoji, fromMe } = req.body;
    const userId = res.locals.userId;
    const idempotencyKey = (req.header("Idempotency-Key") || req.header("idempotency-key"))?.trim();

    await whatsappService.isEligibleForOutbox(sessionId, userId);

    const msgKey: WAMessageKey = {
        remoteJid,
        id: messageId,
        fromMe: typeof fromMe === "boolean" ? fromMe : null
    };

    const { doc, deduplicated } = await outboxEngine.enqueue({
        userId,
        sessionId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        recipientJid: remoteJid,
        actionType: "react",
        payload: { messageKey: msgKey, emoji }
    });

    return res.status(202).json({
        success: true,
        data: {
            outboxId: String(doc._id),
            messageId: doc.waMessageId,
            remoteJid: doc.recipientJid,
            status: doc.status.toLowerCase(),
            idempotencyKey: doc.idempotencyKey,
            deduplicated,
            message: deduplicated ? "Duplicate request; returning existing outbox item" : "Reaction queued for delivery"
        }
    });
});

router.post('/messages/delete', validate({
    body: {
        sessionId: "required|string",
        messageId: "required|string",
        remoteJid: "required|string"
    }
}), async (req, res) => {
    const { sessionId, messageId, remoteJid, fromMe } = req.body;
    const userId = res.locals.userId;
    const idempotencyKey = (req.header("Idempotency-Key") || req.header("idempotency-key"))?.trim();

    await whatsappService.isEligibleForOutbox(sessionId, userId);

    const msgKey: WAMessageKey = {
        remoteJid,
        id: messageId,
        fromMe: typeof fromMe === "boolean" ? fromMe : true
    };

    const { doc, deduplicated } = await outboxEngine.enqueue({
        userId,
        sessionId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        recipientJid: remoteJid,
        actionType: "delete",
        payload: { messageKey: msgKey }
    });

    return res.status(202).json({
        success: true,
        data: {
            outboxId: String(doc._id),
            messageId: doc.waMessageId,
            remoteJid: doc.recipientJid,
            status: doc.status.toLowerCase(),
            idempotencyKey: doc.idempotencyKey,
            deduplicated,
            message: deduplicated ? "Duplicate request; returning existing outbox item" : "Delete action queued for delivery"
        }
    });
});

router.post('/messages/read', validate({
    body: {
        sessionId: "required|string",
        messageId: "required|string",
        remoteJid: "required|string"
    }
}), async (req, res) => {
    const { sessionId, messageId, remoteJid, fromMe } = req.body;
    const userId = res.locals.userId;
    const idempotencyKey = (req.header("Idempotency-Key") || req.header("idempotency-key"))?.trim();

    await whatsappService.isEligibleForOutbox(sessionId, userId);

    const msgKey: WAMessageKey = {
        remoteJid,
        id: messageId,
        fromMe: typeof fromMe === "boolean" ? fromMe : false
    };

    const { doc, deduplicated } = await outboxEngine.enqueue({
        userId,
        sessionId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        recipientJid: remoteJid,
        actionType: "read",
        payload: { messageKey: msgKey }
    });

    return res.status(202).json({
        success: true,
        data: {
            outboxId: String(doc._id),
            messageId: doc.waMessageId,
            remoteJid: doc.recipientJid,
            status: doc.status.toLowerCase(),
            idempotencyKey: doc.idempotencyKey,
            deduplicated,
            message: deduplicated ? "Duplicate request; returning existing outbox item" : "Read receipt queued for delivery"
        }
    });
});

router.get('/outbox', async (req, res) => {
    const userId = res.locals.userId;
    const { sessionId, status, after, limit } = req.query;

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

    const query: any = { userId };
    if (sessionId) {
        query.sessionId = sessionId as string;
    }
    if (status) {
        query.status = (status as string).toUpperCase();
    }
    if (after && mongoose.Types.ObjectId.isValid(after as string)) {
        query._id = { $gt: new mongoose.Types.ObjectId(after as string) };
    }

    const parsedLimit = limit ? parseInt(limit as string, 10) : 50;
    const safeLimit = Math.min(Math.max(1, isNaN(parsedLimit) ? 50 : parsedLimit), 200);

    const results = await Outbox.find(query)
        .sort({ _id: 1 })
        .limit(safeLimit + 1)
        .lean();

    const hasMore = results.length > safeLimit;
    const items = hasMore ? results.slice(0, safeLimit) : results;
    const lastItem = items.length > 0 ? items[items.length - 1] : null;
    const nextCursor = hasMore && lastItem ? String(lastItem._id) : null;

    return res.status(200).json({
        success: true,
        data: {
            items,
            nextCursor,
            hasMore
        }
    });
});

router.get('/outbox/:outboxId', async (req, res) => {
    const { outboxId } = req.params;
    const userId = res.locals.userId;

    if (!mongoose.Types.ObjectId.isValid(outboxId as string)) {
        return res.status(404).json({
            success: false,
            error: {
                code: 404,
                message: "Outbox item not found"
            }
        });
    }

    const doc = await Outbox.findOne({ _id: outboxId, userId }).lean();
    if (!doc) {
        return res.status(404).json({
            success: false,
            error: {
                code: 404,
                message: "Outbox item not found"
            }
        });
    }

    return res.status(200).json({
        success: true,
        data: doc
    });
});

router.delete('/outbox/:outboxId', async (req, res) => {
    const { outboxId } = req.params;
    const userId = res.locals.userId;

    if (!mongoose.Types.ObjectId.isValid(outboxId as string)) {
        return res.status(404).json({
            success: false,
            error: {
                code: 404,
                message: "Outbox item not found"
            }
        });
    }

    const doc = await Outbox.findOne({ _id: outboxId, userId });
    if (!doc) {
        return res.status(404).json({
            success: false,
            error: {
                code: 404,
                message: "Outbox item not found"
            }
        });
    }

    if (doc.status !== "QUEUED") {
        return res.status(409).json({
            success: false,
            error: {
                code: 409,
                message: `Cannot cancel outbox item in status ${doc.status}`
            }
        });
    }

    doc.status = "CANCELLED";
    doc.completedAt = new Date();
    doc.updatedAt = new Date();
    await doc.save();

    if (doc.payload?.filePath) {
        unlink(doc.payload.filePath).catch(() => {});
    }

    return res.status(200).json({
        success: true,
        data: {
            outboxId: String(doc._id),
            status: "cancelled",
            message: "Outbox item cancelled"
        }
    });
});

router.post('/outbox/:outboxId/retry', async (req, res) => {
    const { outboxId } = req.params;
    const userId = res.locals.userId;

    if (!mongoose.Types.ObjectId.isValid(outboxId as string)) {
        return res.status(404).json({
            success: false,
            error: {
                code: 404,
                message: "Outbox item not found"
            }
        });
    }

    const doc = await Outbox.findOne({ _id: outboxId, userId });
    if (!doc) {
        return res.status(404).json({
            success: false,
            error: {
                code: 404,
                message: "Outbox item not found"
            }
        });
    }

    if (doc.status !== "FAILED_TERMINAL" && doc.status !== "CANCELLED") {
        return res.status(409).json({
            success: false,
            error: {
                code: 409,
                message: `Only FAILED_TERMINAL or CANCELLED items can be retried (current: ${doc.status})`
            }
        });
    }

    if ((doc.actionType === "media_file" || doc.actionType === "voice") && doc.payload?.filePath && !existsSync(doc.payload.filePath)) {
        return res.status(410).json({
            success: false,
            error: {
                code: 410,
                message: "Staged media file has already been cleaned up; please upload and send the file again"
            }
        });
    }

    await whatsappService.isEligibleForOutbox(doc.sessionId, userId);

    doc.status = "QUEUED";
    doc.attempts = 0;
    doc.nextAttemptAt = new Date();
    doc.lastError = null;
    doc.completedAt = null;
    doc.updatedAt = new Date();
    await doc.save();

    outboxEngine.notify(doc.sessionId, doc.recipientJid);

    return res.status(202).json({
        success: true,
        data: {
            outboxId: String(doc._id),
            messageId: doc.waMessageId,
            status: "queued",
            message: "Outbox item re-queued for delivery"
        }
    });
});

export default router;
