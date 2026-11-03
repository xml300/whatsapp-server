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
import { SsrfBlockedUrlError, UnsupportedMediaTypeError } from "../../errors/whatsapp-errors.js";
import type { ContactCardInput, QuotedMessageRef } from "../../types/models.js";

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

function parseQuoted(quoted?: any, quotedMessageId?: any): QuotedMessageRef | undefined {
    if (quoted && typeof quoted === "object" && !Array.isArray(quoted)) {
        return quoted as QuotedMessageRef;
    }
    const id = typeof quoted === "string" && quoted.trim()
        ? quoted.trim()
        : (typeof quotedMessageId === "string" && quotedMessageId.trim() ? quotedMessageId.trim() : undefined);
    if (id) {
        return { messageId: id };
    }
    return undefined;
}

function parseMentions(mentions?: any): string[] | "all" | undefined {
    if (mentions === "all") return "all";
    if (Array.isArray(mentions)) {
        return mentions.map((m) => (typeof m === "string" ? m.trim() : String(m))).filter(Boolean);
    }
    if (typeof mentions === "string" && mentions.trim()) {
        if (mentions.includes(",")) {
            return mentions.split(",").map((m) => m.trim()).filter(Boolean);
        }
        return [mentions.trim()];
    }
    return undefined;
}

function parseBoolean(val: any): boolean | undefined {
    if (val === undefined || val === null) return undefined;
    if (typeof val === "boolean") return val;
    if (val === "true" || val === 1 || val === "1") return true;
    if (val === "false" || val === 0 || val === "0") return false;
    return Boolean(val);
}

const router = express.Router();
router.use(authMiddleware);

// --- Group Management (Non-parameterized / Specific Routes) ---

router.get('/', validate({
    query: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    const groups = await (whatsappService as any).groupFetchAllParticipating(sessionId);
    return res.json({
        success: true,
        data: groups
    });
});

router.post('/', validate({
    body: {
        sessionId: "required|string",
        subject: "required|string",
        participants: "required|nonEmptyArray"
    }
}), async (req, res) => {
    const { sessionId, subject, participants } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    const group = await (whatsappService as any).groupCreate(sessionId, subject, participants);
    return res.json({
        success: true,
        data: group
    });
});

router.post('/accept-invite', validate({
    body: {
        sessionId: "required|string",
        code: "required|string"
    }
}), async (req, res) => {
    const { sessionId, code } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    const groupJid = await (whatsappService as any).groupAcceptInvite(sessionId, code);
    return res.json({
        success: true,
        data: { groupJid }
    });
});

router.get('/invite-info/:code', validate({
    params: {
        code: "required|string"
    },
    query: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const code = req.params.code as string;
    const sessionId = req.query.sessionId as string;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    const info = await (whatsappService as any).groupGetInviteInfo(sessionId, code);
    return res.json({
        success: true,
        data: info
    });
});

// --- Group Messaging (Outbox 202 Accepted) ---

router.post('/:groupJid/send/text', validate({
    params: {
        groupJid: "required|groupJid"
    },
    body: {
        sessionId: "required|string",
        message: "required|message",
        simulateTyping: "boolean"
    }
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
    const { sessionId, message } = req.body;
    const userId = res.locals.userId;
    const idempotencyKey = (req.header("Idempotency-Key") || req.header("idempotency-key"))?.trim();

    await whatsappService.isEligibleForOutbox(sessionId, userId);

    const quoted = parseQuoted(req.body.quoted, req.body.quotedMessageId);
    const mentions = parseMentions(req.body.mentions);

    const { doc, deduplicated } = await outboxEngine.enqueue({
        userId,
        sessionId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        recipientJid: groupJid,
        actionType: "text",
        payload: {
            recipientJid: groupJid,
            message,
            ...(quoted ? { quoted } : {}),
            ...(mentions ? { mentions } : {})
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
            message: deduplicated ? "Duplicate request; returning existing outbox item" : "Group message queued for delivery"
        }
    });
});

router.post('/:groupJid/send/media', validate({
    params: {
        groupJid: "required|groupJid"
    },
    body: {
        sessionId: "required|string",
        mediaType: "required|string",
        mediaUrl: "required|string",
        caption: "string",
        simulateTyping: "boolean"
    }
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
    const { sessionId, mediaType, mediaUrl, caption } = req.body;
    const userId = res.locals.userId;
    const idempotencyKey = (req.header("Idempotency-Key") || req.header("idempotency-key"))?.trim();

    await whatsappService.isEligibleForOutbox(sessionId, userId);

    const validated = await validateMediaUrl(mediaUrl);
    if (!validated) {
        throw new SsrfBlockedUrlError(sessionId);
    }

    const quoted = parseQuoted(req.body.quoted, req.body.quotedMessageId);
    const mentions = parseMentions(req.body.mentions);
    const viewOnce = parseBoolean(req.body.viewOnce);

    const { doc, deduplicated } = await outboxEngine.enqueue({
        userId,
        sessionId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        recipientJid: groupJid,
        actionType: "media_url",
        payload: {
            recipientJid: groupJid,
            mediaType,
            mediaUrl,
            ...(caption ? { caption } : {}),
            ...(viewOnce !== undefined ? { viewOnce } : {}),
            ...(quoted ? { quoted } : {}),
            ...(mentions ? { mentions } : {})
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
            message: deduplicated ? "Duplicate request; returning existing outbox item" : "Group media queued for delivery"
        }
    });
});

router.post('/:groupJid/send/file', upload.single('file'), validate({
    params: {
        groupJid: "required|groupJid"
    },
    body: {
        sessionId: "required|string",
        caption: "string",
        simulateTyping: "boolean"
    },
    file: "required|file"
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
    const { sessionId, caption } = req.body;
    const userId = res.locals.userId;
    const idempotencyKey = (req.header("Idempotency-Key") || req.header("idempotency-key"))?.trim();
    const file = req.file!;

    try {
        await whatsappService.isEligibleForOutbox(sessionId, userId);

        const quoted = parseQuoted(req.body.quoted, req.body.quotedMessageId);
        const mentions = parseMentions(req.body.mentions);
        const viewOnce = parseBoolean(req.body.viewOnce);

        const { doc, deduplicated } = await outboxEngine.enqueue({
            userId,
            sessionId,
            ...(idempotencyKey ? { idempotencyKey } : {}),
            recipientJid: groupJid,
            actionType: "media_file",
            payload: {
                recipientJid: groupJid,
                ...(caption ? { caption } : {}),
                filePath: file.path,
                originalName: file.originalname,
                mimeType: file.mimetype,
                ...(viewOnce !== undefined ? { viewOnce } : {}),
                ...(quoted ? { quoted } : {}),
                ...(mentions ? { mentions } : {})
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
                message: deduplicated ? "Duplicate request; returning existing outbox item" : "Group file queued for delivery"
            }
        });
    } catch (err) {
        if (req.file?.path) {
            await unlink(req.file.path).catch(() => {});
        }
        throw err;
    }
});

router.post('/:groupJid/send/voice', upload.single('file'), validate({
    params: {
        groupJid: "required|groupJid"
    },
    body: {
        sessionId: "required|string",
        simulateTyping: "boolean"
    },
    file: "required|file"
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
    const { sessionId } = req.body;
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

        const quoted = parseQuoted(req.body.quoted, req.body.quotedMessageId);
        const mentions = parseMentions(req.body.mentions);
        const viewOnce = parseBoolean(req.body.viewOnce);

        const { doc, deduplicated } = await outboxEngine.enqueue({
            userId,
            sessionId,
            ...(idempotencyKey ? { idempotencyKey } : {}),
            recipientJid: groupJid,
            actionType: "voice",
            payload: {
                recipientJid: groupJid,
                filePath: file.path,
                originalName: file.originalname,
                mimeType: file.mimetype,
                ...(viewOnce !== undefined ? { viewOnce } : {}),
                ...(quoted ? { quoted } : {}),
                ...(mentions ? { mentions } : {})
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
                message: deduplicated ? "Duplicate request; returning existing outbox item" : "Group voice note queued for delivery"
            }
        });
    } catch (err) {
        if (req.file?.path) {
            await unlink(req.file.path).catch(() => {});
        }
        throw err;
    }
});

router.post('/:groupJid/send/sticker', upload.single('file'), validate({
    params: {
        groupJid: "required|groupJid"
    },
    body: {
        sessionId: "required|string",
        mediaUrl: "string"
    }
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
    const { sessionId, mediaUrl } = req.body;
    const userId = res.locals.userId;
    const idempotencyKey = (req.header("Idempotency-Key") || req.header("idempotency-key"))?.trim();
    const file = req.file;

    if (!file && (!mediaUrl || typeof mediaUrl !== "string" || !mediaUrl.trim())) {
        return res.status(400).json({
            success: false,
            error: {
                code: 400,
                message: "Either a file upload or mediaUrl is required"
            }
        });
    }

    try {
        await whatsappService.isEligibleForOutbox(sessionId, userId);

        if (!file && mediaUrl) {
            const validated = await validateMediaUrl(mediaUrl);
            if (!validated) {
                throw new SsrfBlockedUrlError(sessionId);
            }
        }

        const quoted = parseQuoted(req.body.quoted, req.body.quotedMessageId);
        const mentions = parseMentions(req.body.mentions);
        const isAnimated = parseBoolean(req.body.isAnimated);

        const { doc, deduplicated } = await outboxEngine.enqueue({
            userId,
            sessionId,
            ...(idempotencyKey ? { idempotencyKey } : {}),
            recipientJid: groupJid,
            actionType: "sticker",
            payload: {
                recipientJid: groupJid,
                ...(file ? {
                    filePath: file.path,
                    originalName: file.originalname,
                    mimeType: file.mimetype || "image/webp"
                } : {}),
                ...(!file && mediaUrl ? { mediaUrl: mediaUrl.trim() } : {}),
                ...(isAnimated !== undefined ? { isAnimated } : {}),
                ...(quoted ? { quoted } : {}),
                ...(mentions ? { mentions } : {})
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
                message: deduplicated ? "Duplicate request; returning existing outbox item" : "Group sticker queued for delivery"
            }
        });
    } catch (err) {
        if (req.file?.path) {
            await unlink(req.file.path).catch(() => {});
        }
        throw err;
    }
});

router.post('/:groupJid/send/poll', validate({
    params: {
        groupJid: "required|groupJid"
    },
    body: {
        sessionId: "required|string",
        name: "required|string",
        values: "required|nonEmptyArray",
        selectableCount: "number"
    }
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
    const { sessionId, name, values, selectableCount } = req.body;
    const userId = res.locals.userId;
    const idempotencyKey = (req.header("Idempotency-Key") || req.header("idempotency-key"))?.trim();

    await whatsappService.isEligibleForOutbox(sessionId, userId);

    const quoted = parseQuoted(req.body.quoted, req.body.quotedMessageId);
    const mentions = parseMentions(req.body.mentions);
    const toAnnouncementGroup = parseBoolean(req.body.toAnnouncementGroup);

    const { doc, deduplicated } = await outboxEngine.enqueue({
        userId,
        sessionId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        recipientJid: groupJid,
        actionType: "poll",
        payload: {
            recipientJid: groupJid,
            poll: {
                name: String(name),
                values: Array.isArray(values) ? values.map((v: any) => String(v)) : [],
                selectableCount: selectableCount !== undefined ? Math.max(1, Number(selectableCount)) : 1,
                ...(toAnnouncementGroup !== undefined ? { toAnnouncementGroup } : {})
            },
            ...(quoted ? { quoted } : {}),
            ...(mentions ? { mentions } : {})
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
            message: deduplicated ? "Duplicate request; returning existing outbox item" : "Group poll queued for delivery"
        }
    });
});

router.post('/:groupJid/send/location', validate({
    params: {
        groupJid: "required|groupJid"
    },
    body: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
    const { sessionId, name, address, url } = req.body;
    const userId = res.locals.userId;
    const idempotencyKey = (req.header("Idempotency-Key") || req.header("idempotency-key"))?.trim();

    const rawLat = req.body.latitude ?? req.body.degreesLatitude;
    const rawLng = req.body.longitude ?? req.body.degreesLongitude;
    const lat = Number(rawLat);
    const lng = Number(rawLng);

    if (rawLat === undefined || rawLng === undefined || isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({
            success: false,
            error: {
                code: 400,
                message: "Valid latitude and longitude are required"
            }
        });
    }

    await whatsappService.isEligibleForOutbox(sessionId, userId);

    const quoted = parseQuoted(req.body.quoted, req.body.quotedMessageId);

    const { doc, deduplicated } = await outboxEngine.enqueue({
        userId,
        sessionId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        recipientJid: groupJid,
        actionType: "location",
        payload: {
            recipientJid: groupJid,
            location: {
                degreesLatitude: lat,
                degreesLongitude: lng,
                ...(name ? { name: String(name) } : {}),
                ...(address ? { address: String(address) } : {}),
                ...(url ? { url: String(url) } : {})
            },
            ...(quoted ? { quoted } : {})
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
            message: deduplicated ? "Duplicate request; returning existing outbox item" : "Group location queued for delivery"
        }
    });
});

router.post('/:groupJid/send/contact', validate({
    params: {
        groupJid: "required|groupJid"
    },
    body: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
    const { sessionId } = req.body;
    const userId = res.locals.userId;
    const idempotencyKey = (req.header("Idempotency-Key") || req.header("idempotency-key"))?.trim();

    let contactList: ContactCardInput[] = [];
    if (Array.isArray(req.body.contacts) && req.body.contacts.length > 0) {
        contactList = req.body.contacts.map((c: any) => ({
            displayName: String(c.displayName || c.name || "Contact"),
            ...(c.phoneNumber || c.phoneNumberCard || c.contactPhoneNumber ? { phoneNumber: String(c.phoneNumber || c.phoneNumberCard || c.contactPhoneNumber) } : {}),
            ...(c.vcard ? { vcard: String(c.vcard) } : {})
        }));
    } else if (req.body.displayName || req.body.phoneNumberCard || req.body.contactPhoneNumber || req.body.vcard) {
        contactList = [{
            displayName: String(req.body.displayName || "Contact"),
            ...(req.body.contactPhoneNumber || req.body.phoneNumberCard ? { phoneNumber: String(req.body.contactPhoneNumber || req.body.phoneNumberCard) } : {}),
            ...(req.body.vcard ? { vcard: String(req.body.vcard) } : {})
        }];
    }

    if (contactList.length === 0) {
        return res.status(400).json({
            success: false,
            error: {
                code: 400,
                message: "At least one contact or contact details required"
            }
        });
    }

    await whatsappService.isEligibleForOutbox(sessionId, userId);

    const quoted = parseQuoted(req.body.quoted, req.body.quotedMessageId);

    const { doc, deduplicated } = await outboxEngine.enqueue({
        userId,
        sessionId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        recipientJid: groupJid,
        actionType: "contact",
        payload: {
            recipientJid: groupJid,
            contacts: {
                displayName: req.body.displayName || contactList[0]?.displayName || "Contact",
                contacts: contactList
            },
            ...(quoted ? { quoted } : {})
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
            message: deduplicated ? "Duplicate request; returning existing outbox item" : "Group contact queued for delivery"
        }
    });
});

// --- Group Management (Parameterized Routes) ---

router.get('/:groupJid', validate({
    params: {
        groupJid: "required|groupJid"
    },
    query: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
    const sessionId = req.query.sessionId as string;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    const metadata = await (whatsappService as any).groupMetadata(sessionId, groupJid);
    return res.json({
        success: true,
        data: metadata
    });
});

router.post('/:groupJid/leave', validate({
    params: {
        groupJid: "required|groupJid"
    },
    body: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
    const { sessionId } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    await (whatsappService as any).groupLeave(sessionId, groupJid);
    return res.json({
        success: true,
        data: { message: "Left group successfully" }
    });
});

router.patch('/:groupJid/subject', validate({
    params: {
        groupJid: "required|groupJid"
    },
    body: {
        sessionId: "required|string",
        subject: "required|string"
    }
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
    const { sessionId, subject } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    await (whatsappService as any).groupUpdateSubject(sessionId, groupJid, subject);
    return res.json({
        success: true,
        data: { message: "Group subject updated" }
    });
});

router.patch('/:groupJid/description', validate({
    params: {
        groupJid: "required|groupJid"
    },
    body: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
    const { sessionId, description } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    await (whatsappService as any).groupUpdateDescription(sessionId, groupJid, description || "");
    return res.json({
        success: true,
        data: { message: "Group description updated" }
    });
});

router.patch('/:groupJid/settings', validate({
    params: {
        groupJid: "required|groupJid"
    },
    body: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
    const { sessionId, setting, memberAddMode, joinApprovalMode, ephemeralExpiration } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    if (setting !== undefined) {
        await (whatsappService as any).groupSettingUpdate(sessionId, groupJid, setting);
    }
    if (memberAddMode !== undefined) {
        await (whatsappService as any).groupMemberAddMode(sessionId, groupJid, memberAddMode);
    }
    if (joinApprovalMode !== undefined) {
        await (whatsappService as any).groupJoinApprovalMode(sessionId, groupJid, joinApprovalMode);
    }
    if (ephemeralExpiration !== undefined) {
        await (whatsappService as any).groupToggleEphemeral(sessionId, groupJid, Number(ephemeralExpiration));
    }

    return res.json({
        success: true,
        data: { message: "Group settings updated" }
    });
});

router.put('/:groupJid/picture', upload.single('file'), validate({
    params: {
        groupJid: "required|groupJid"
    }
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
    const sessionId = (req.body?.sessionId || req.query?.sessionId) as string;
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
        if (req.file) {
            await (whatsappService as any).updateGroupPicture(sessionId, groupJid, { path: req.file.path });
        } else if (req.body?.imageUrl) {
            const validated = await validateMediaUrl(req.body.imageUrl);
            if (!validated) {
                throw new SsrfBlockedUrlError(sessionId);
            }
            await (whatsappService as any).updateGroupPicture(sessionId, groupJid, { url: req.body.imageUrl });
        } else {
            return res.status(400).json({
                success: false,
                error: { code: 400, message: "Either a file upload or imageUrl is required" }
            });
        }

        return res.json({
            success: true,
            data: { message: "Group picture updated" }
        });
    } finally {
        if (req.file?.path) {
            await unlink(req.file.path).catch(() => {});
        }
    }
});

router.delete('/:groupJid/picture', validate({
    params: {
        groupJid: "required|groupJid"
    }
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
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

    await (whatsappService as any).removeGroupPicture(sessionId, groupJid);
    return res.json({
        success: true,
        data: { message: "Group picture removed" }
    });
});

router.post('/:groupJid/participants', validate({
    params: {
        groupJid: "required|groupJid"
    },
    body: {
        sessionId: "required|string",
        participants: "required|nonEmptyArray",
        action: "required|string"
    }
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
    const { sessionId, participants, action } = req.body;
    const userId = res.locals.userId;

    if (!["add", "remove", "promote", "demote"].includes(action)) {
        return res.status(400).json({
            success: false,
            error: { code: 400, message: "action must be 'add', 'remove', 'promote', or 'demote'" }
        });
    }

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    const result = await (whatsappService as any).groupParticipantsUpdate(sessionId, groupJid, participants, action);
    return res.json({
        success: true,
        data: result
    });
});

router.get('/:groupJid/invite-code', validate({
    params: {
        groupJid: "required|groupJid"
    },
    query: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
    const sessionId = req.query.sessionId as string;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    const code = await (whatsappService as any).groupInviteCode(sessionId, groupJid);
    return res.json({
        success: true,
        data: { code }
    });
});

router.post('/:groupJid/revoke-invite', validate({
    params: {
        groupJid: "required|groupJid"
    },
    body: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
    const { sessionId } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    const code = await (whatsappService as any).groupRevokeInvite(sessionId, groupJid);
    return res.json({
        success: true,
        data: { code, message: "Group invite revoked" }
    });
});

router.get('/:groupJid/join-requests', validate({
    params: {
        groupJid: "required|groupJid"
    },
    query: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
    const sessionId = req.query.sessionId as string;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    const requests = await (whatsappService as any).groupRequestParticipantsList(sessionId, groupJid);
    return res.json({
        success: true,
        data: { requests }
    });
});

router.post('/:groupJid/join-requests', validate({
    params: {
        groupJid: "required|groupJid"
    },
    body: {
        sessionId: "required|string",
        participants: "required|nonEmptyArray",
        action: "required|string"
    }
}), async (req, res) => {
    const groupJid = req.params.groupJid as string;
    const { sessionId, participants, action } = req.body;
    const userId = res.locals.userId;

    if (action !== "approve" && action !== "reject") {
        return res.status(400).json({
            success: false,
            error: { code: 400, message: "action must be 'approve' or 'reject'" }
        });
    }

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    const result = await (whatsappService as any).groupRequestParticipantsUpdate(sessionId, groupJid, participants, action);
    return res.json({
        success: true,
        data: result
    });
});

export default router;
