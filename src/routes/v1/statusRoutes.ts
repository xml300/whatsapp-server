import express from "express";
import { mkdirSync } from "fs";
import { unlink } from "fs/promises";
import { extname } from "path";
import { randomUUID } from "crypto";
import multer from "multer";
import authMiddleware from "../../middleware/auth.js";
import validate from "../../middleware/validate.js";
import { whatsappService } from "../../lib/whatsapp-manager.js";
import { outboxEngine } from "../../lib/outbox.js";
import { validateMediaUrl } from "../../utils/url.js";
import { SsrfBlockedUrlError, UnsupportedMediaTypeError } from "../../errors/whatsapp-errors.js";

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

function parseStatusJidList(val: any): string[] {
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === "string" && val.trim()) {
        try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed)) return parsed.map(String);
        } catch {
            if (val.includes(",")) return val.split(",").map((s) => s.trim()).filter(Boolean);
            return [val.trim()];
        }
    }
    return [];
}

const normalizeStatusJidList = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (req.body && req.body.statusJidList !== undefined) {
        req.body.statusJidList = parseStatusJidList(req.body.statusJidList);
    }
    next();
};

const router = express.Router();
router.use(authMiddleware);

router.post('/text', validate({
    body: {
        sessionId: "required|string",
        message: "required|message",
        statusJidList: "required|nonEmptyArray"
    }
}), async (req, res) => {
    const { sessionId, message, statusJidList, backgroundColor, font } = req.body;
    const userId = res.locals.userId;
    const idempotencyKey = (req.header("Idempotency-Key") || req.header("idempotency-key"))?.trim();

    await whatsappService.isEligibleForOutbox(sessionId, userId);

    const { doc, deduplicated } = await outboxEngine.enqueue({
        userId,
        sessionId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        recipientJid: "status@broadcast",
        actionType: "status_text",
        payload: {
            message,
            statusOptions: {
                statusJidList: Array.isArray(statusJidList) ? statusJidList.map(String) : [],
                ...(backgroundColor ? { backgroundColor: String(backgroundColor) } : {}),
                ...(font !== undefined ? { font: Number(font) } : {})
            }
        }
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
            message: deduplicated ? "Duplicate request; returning existing outbox item" : "Status text queued for delivery"
        }
    });
});

router.post('/media', validate({
    body: {
        sessionId: "required|string",
        mediaType: "required|string",
        mediaUrl: "required|string",
        statusJidList: "required|nonEmptyArray",
        caption: "string"
    }
}), async (req, res) => {
    const { sessionId, mediaType, mediaUrl, caption, statusJidList } = req.body;
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
        recipientJid: "status@broadcast",
        actionType: "status_media_url",
        payload: {
            mediaType,
            mediaUrl,
            ...(caption ? { caption } : {}),
            statusOptions: {
                statusJidList: Array.isArray(statusJidList) ? statusJidList.map(String) : []
            }
        }
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
            message: deduplicated ? "Duplicate request; returning existing outbox item" : "Status media queued for delivery"
        }
    });
});

router.post('/file', upload.single('file'), normalizeStatusJidList, validate({
    body: {
        sessionId: "required|string",
        statusJidList: "required|nonEmptyArray",
        caption: "string"
    },
    file: "required|file"
}), async (req, res) => {
    const { sessionId, caption, statusJidList } = req.body;
    const userId = res.locals.userId;
    const idempotencyKey = (req.header("Idempotency-Key") || req.header("idempotency-key"))?.trim();
    const file = req.file!;

    try {
        await whatsappService.isEligibleForOutbox(sessionId, userId);

        const { doc, deduplicated } = await outboxEngine.enqueue({
            userId,
            sessionId,
            ...(idempotencyKey ? { idempotencyKey } : {}),
            recipientJid: "status@broadcast",
            actionType: "status_media_file",
            payload: {
                filePath: file.path,
                originalName: file.originalname,
                mimeType: file.mimetype,
                ...(caption ? { caption } : {}),
                statusOptions: {
                    statusJidList: Array.isArray(statusJidList) ? statusJidList.map(String) : []
                }
            }
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
                message: deduplicated ? "Duplicate request; returning existing outbox item" : "Status file queued for delivery"
            }
        });
    } catch (err) {
        if (req.file?.path) {
            await unlink(req.file.path).catch(() => {});
        }
        throw err;
    }
});

router.post('/voice', upload.single('file'), normalizeStatusJidList, validate({
    body: {
        sessionId: "required|string",
        statusJidList: "required|nonEmptyArray"
    },
    file: "required|file"
}), async (req, res) => {
    const { sessionId, statusJidList, backgroundColor } = req.body;
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
            recipientJid: "status@broadcast",
            actionType: "status_voice",
            payload: {
                filePath: file.path,
                originalName: file.originalname,
                mimeType: file.mimetype,
                statusOptions: {
                    statusJidList: Array.isArray(statusJidList) ? statusJidList.map(String) : [],
                    ...(backgroundColor ? { backgroundColor: String(backgroundColor) } : {})
                }
            }
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
                message: deduplicated ? "Duplicate request; returning existing outbox item" : "Status voice note queued for delivery"
            }
        });
    } catch (err) {
        if (req.file?.path) {
            await unlink(req.file.path).catch(() => {});
        }
        throw err;
    }
});

router.delete('/:messageId', validate({
    params: {
        messageId: "required|string"
    },
    body: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const messageId = req.params.messageId as string;
    const { sessionId, statusJidList } = req.body;
    const userId = res.locals.userId;
    const idempotencyKey = (req.header("Idempotency-Key") || req.header("idempotency-key"))?.trim();

    await whatsappService.isEligibleForOutbox(sessionId, userId);

    const parsedList = statusJidList ? parseStatusJidList(statusJidList) : undefined;

    const { doc, deduplicated } = await outboxEngine.enqueue({
        userId,
        sessionId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        recipientJid: "status@broadcast",
        actionType: "status_delete",
        payload: {
            messageKey: {
                remoteJid: "status@broadcast",
                id: messageId,
                fromMe: true
            },
            ...(parsedList && parsedList.length > 0 ? { statusOptions: { statusJidList: parsedList } } : {})
        }
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
            message: deduplicated ? "Duplicate request; returning existing outbox item" : "Status delete action queued for delivery"
        }
    });
});

export default router;
