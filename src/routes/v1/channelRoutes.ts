import express from "express";
import { mkdirSync } from "fs";
import { unlink } from "fs/promises";
import { extname } from "path";
import { randomUUID } from "crypto";
import multer from "multer";
import authMiddleware from "../../middleware/auth.js";
import validate from "../../middleware/validate.js";
import { Session } from "../../data/db.js";
import { whatsappService } from "../../lib/whatsapp-manager.js";
import { outboxEngine } from "../../lib/outbox.js";
import { validateMediaUrl } from "../../utils/url.js";
import { SsrfBlockedUrlError } from "../../errors/whatsapp-errors.js";

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

// --- Channel Creation ---

router.post('/', validate({
    body: {
        sessionId: "required|string",
        name: "required|string"
    }
}), async (req, res) => {
    const { sessionId, name, description } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    const channel = await (whatsappService as any).newsletterCreate(sessionId, name, description || "");
    return res.json({
        success: true,
        data: channel
    });
});

// --- Channel Publishing (Outbox 202 Accepted) ---

router.post('/:channelJid/send/text', validate({
    params: {
        channelJid: "required|channelJid"
    },
    body: {
        sessionId: "required|string",
        message: "required|message"
    }
}), async (req, res) => {
    const channelJid = req.params.channelJid as string;
    const { sessionId, message } = req.body;
    const userId = res.locals.userId;
    const idempotencyKey = (req.header("Idempotency-Key") || req.header("idempotency-key"))?.trim();

    await whatsappService.isEligibleForOutbox(sessionId, userId);

    const { doc, deduplicated } = await outboxEngine.enqueue({
        userId,
        sessionId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        recipientJid: channelJid,
        actionType: "text",
        payload: {
            recipientJid: channelJid,
            message
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
            message: deduplicated ? "Duplicate request; returning existing outbox item" : "Channel message queued for delivery"
        }
    });
});

router.post('/:channelJid/send/media', validate({
    params: {
        channelJid: "required|channelJid"
    },
    body: {
        sessionId: "required|string",
        mediaType: "required|string",
        mediaUrl: "required|string",
        caption: "string"
    }
}), async (req, res) => {
    const channelJid = req.params.channelJid as string;
    const { sessionId, mediaType, mediaUrl, caption } = req.body;
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
        recipientJid: channelJid,
        actionType: "media_url",
        payload: {
            recipientJid: channelJid,
            mediaType,
            mediaUrl,
            ...(caption ? { caption } : {})
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
            message: deduplicated ? "Duplicate request; returning existing outbox item" : "Channel media queued for delivery"
        }
    });
});

router.post('/:channelJid/send/file', upload.single('file'), validate({
    params: {
        channelJid: "required|channelJid"
    },
    body: {
        sessionId: "required|string",
        caption: "string"
    },
    file: "required|file"
}), async (req, res) => {
    const channelJid = req.params.channelJid as string;
    const { sessionId, caption } = req.body;
    const userId = res.locals.userId;
    const idempotencyKey = (req.header("Idempotency-Key") || req.header("idempotency-key"))?.trim();
    const file = req.file!;

    try {
        await whatsappService.isEligibleForOutbox(sessionId, userId);

        const { doc, deduplicated } = await outboxEngine.enqueue({
            userId,
            sessionId,
            ...(idempotencyKey ? { idempotencyKey } : {}),
            recipientJid: channelJid,
            actionType: "media_file",
            payload: {
                recipientJid: channelJid,
                ...(caption ? { caption } : {}),
                filePath: file.path,
                originalName: file.originalname,
                mimeType: file.mimetype
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
                message: deduplicated ? "Duplicate request; returning existing outbox item" : "Channel file queued for delivery"
            }
        });
    } catch (err) {
        if (req.file?.path) {
            await unlink(req.file.path).catch(() => {});
        }
        throw err;
    }
});

// --- Channel Management & Interactions ---

router.delete('/:channelJid/picture', validate({
    params: {
        channelJid: "required|channelJid"
    }
}), async (req, res) => {
    const channelJid = req.params.channelJid as string;
    const sessionId = (req.body?.sessionId || req.query?.sessionId) as string;
    const userId = res.locals.userId;

    if (!sessionId) {
        return res.status(400).json({
            success: false,
            error: { code: 400, message: "sessionId is required" }
        });
    }

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    await (whatsappService as any).newsletterRemovePicture(sessionId, channelJid);
    return res.json({
        success: true,
        data: { message: "Channel picture removed" }
    });
});

router.post('/:channelJid/follow', validate({
    params: {
        channelJid: "required|channelJid"
    },
    body: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const channelJid = req.params.channelJid as string;
    const { sessionId } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    await (whatsappService as any).newsletterFollow(sessionId, channelJid);
    return res.json({
        success: true,
        data: { message: "Followed channel successfully" }
    });
});

router.post('/:channelJid/unfollow', validate({
    params: {
        channelJid: "required|channelJid"
    },
    body: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const channelJid = req.params.channelJid as string;
    const { sessionId } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    await (whatsappService as any).newsletterUnfollow(sessionId, channelJid);
    return res.json({
        success: true,
        data: { message: "Unfollowed channel successfully" }
    });
});

router.post('/:channelJid/mute', validate({
    params: {
        channelJid: "required|channelJid"
    },
    body: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const channelJid = req.params.channelJid as string;
    const { sessionId } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    await (whatsappService as any).newsletterMute(sessionId, channelJid);
    return res.json({
        success: true,
        data: { message: "Muted channel successfully" }
    });
});

router.post('/:channelJid/unmute', validate({
    params: {
        channelJid: "required|channelJid"
    },
    body: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const channelJid = req.params.channelJid as string;
    const { sessionId } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    await (whatsappService as any).newsletterUnmute(sessionId, channelJid);
    return res.json({
        success: true,
        data: { message: "Unmuted channel successfully" }
    });
});

router.get('/:channelJid/subscribers', validate({
    params: {
        channelJid: "required|channelJid"
    },
    query: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const channelJid = req.params.channelJid as string;
    const sessionId = req.query.sessionId as string;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    const subscribers = await (whatsappService as any).newsletterSubscribers(sessionId, channelJid);
    return res.json({
        success: true,
        data: { subscribers }
    });
});

router.post('/:channelJid/messages/:serverId/react', validate({
    params: {
        channelJid: "required|channelJid",
        serverId: "required|string"
    },
    body: {
        sessionId: "required|string",
        emoji: "required|string"
    }
}), async (req, res) => {
    const channelJid = req.params.channelJid as string;
    const serverId = req.params.serverId as string;
    const { sessionId, emoji } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    await (whatsappService as any).newsletterReactMessage(sessionId, channelJid, serverId, emoji);
    return res.json({
        success: true,
        data: { message: "Reaction sent successfully" }
    });
});

router.get('/:channelJid/messages', validate({
    params: {
        channelJid: "required|channelJid"
    },
    query: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const channelJid = req.params.channelJid as string;
    const sessionId = req.query.sessionId as string;
    const { count, since, after } = req.query;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    const messages = await (whatsappService as any).newsletterFetchMessages(
        sessionId,
        channelJid,
        count !== undefined ? Number(count) : undefined,
        since !== undefined ? Number(since) : undefined,
        after !== undefined ? Number(after) : undefined
    );
    return res.json({
        success: true,
        data: { messages }
    });
});

router.post('/:channelJid/subscribe-updates', validate({
    params: {
        channelJid: "required|channelJid"
    },
    body: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const channelJid = req.params.channelJid as string;
    const { sessionId } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    await (whatsappService as any).subscribeNewsletterUpdates(sessionId, channelJid);
    return res.json({
        success: true,
        data: { message: "Subscribed to channel updates" }
    });
});

router.get('/:channelJid/admin-count', validate({
    params: {
        channelJid: "required|channelJid"
    },
    query: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const channelJid = req.params.channelJid as string;
    const sessionId = req.query.sessionId as string;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    const count = await (whatsappService as any).newsletterAdminCount(sessionId, channelJid);
    return res.json({
        success: true,
        data: { adminCount: count }
    });
});

router.post('/:channelJid/change-owner', validate({
    params: {
        channelJid: "required|channelJid"
    },
    body: {
        sessionId: "required|string",
        newOwnerJid: "required|string"
    }
}), async (req, res) => {
    const channelJid = req.params.channelJid as string;
    const { sessionId, newOwnerJid } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    await (whatsappService as any).newsletterChangeOwner(sessionId, channelJid, newOwnerJid);
    return res.json({
        success: true,
        data: { message: "Channel owner changed" }
    });
});

router.post('/:channelJid/demote', validate({
    params: {
        channelJid: "required|channelJid"
    },
    body: {
        sessionId: "required|string",
        userJid: "required|string"
    }
}), async (req, res) => {
    const channelJid = req.params.channelJid as string;
    const { sessionId, userJid } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    await (whatsappService as any).newsletterDemote(sessionId, channelJid, userJid);
    return res.json({
        success: true,
        data: { message: "Channel admin demoted" }
    });
});

router.patch('/:channelJid', upload.single('file'), validate({
    params: {
        channelJid: "required|channelJid"
    }
}), async (req, res) => {
    const channelJid = req.params.channelJid as string;
    const sessionId = (req.body?.sessionId || req.query?.sessionId) as string;
    const { name, description, pictureUrl } = req.body || {};
    const userId = res.locals.userId;

    if (!sessionId) {
        if (req.file?.path) await unlink(req.file.path).catch(() => {});
        return res.status(400).json({
            success: false,
            error: { code: 400, message: "sessionId is required" }
        });
    }

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        if (req.file?.path) await unlink(req.file.path).catch(() => {});
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    try {
        const updates: any = {};
        if (name) updates.name = String(name);
        if (description !== undefined) updates.description = String(description);
        if (req.file) {
            updates.picturePath = req.file.path;
        } else if (pictureUrl) {
            const validated = await validateMediaUrl(pictureUrl);
            if (!validated) {
                throw new SsrfBlockedUrlError(sessionId);
            }
            updates.pictureUrl = pictureUrl;
        }

        const result = await (whatsappService as any).newsletterUpdate(sessionId, channelJid, updates);
        return res.json({
            success: true,
            data: result || { message: "Channel updated" }
        });
    } finally {
        if (req.file?.path) {
            await unlink(req.file.path).catch(() => {});
        }
    }
});

router.delete('/:channelJid', validate({
    params: {
        channelJid: "required|channelJid"
    }
}), async (req, res) => {
    const channelJid = req.params.channelJid as string;
    const sessionId = (req.body?.sessionId || req.query?.sessionId) as string;
    const userId = res.locals.userId;

    if (!sessionId) {
        return res.status(400).json({
            success: false,
            error: { code: 400, message: "sessionId is required" }
        });
    }

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    await (whatsappService as any).newsletterDelete(sessionId, channelJid);
    return res.json({
        success: true,
        data: { message: "Channel deleted" }
    });
});

router.get('/:key', validate({
    params: {
        key: "required|string"
    },
    query: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const key = req.params.key as string;
    const sessionId = req.query.sessionId as string;
    const typeParam = req.query.type as string;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    const type: "jid" | "invite" = typeParam === "invite" || typeParam === "jid"
        ? typeParam
        : (key && key.endsWith("@newsletter") ? "jid" : "invite");

    const metadata = await (whatsappService as any).newsletterMetadata(sessionId, type, key);
    return res.json({
        success: true,
        data: metadata
    });
});

export default router;
