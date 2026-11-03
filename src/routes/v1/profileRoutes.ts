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

router.patch('/name', validate({
    body: {
        sessionId: "required|string",
        name: "required|string"
    }
}), async (req, res) => {
    const { sessionId, name } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    await (whatsappService as any).updateProfileName(sessionId, name);
    return res.json({
        success: true,
        data: { message: "Profile name updated" }
    });
});

router.patch('/status', validate({
    body: {
        sessionId: "required|string",
        status: "required|string"
    }
}), async (req, res) => {
    const { sessionId, status } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    await (whatsappService as any).updateProfileStatus(sessionId, status);
    return res.json({
        success: true,
        data: { message: "Profile status updated" }
    });
});

router.put('/picture', upload.single('file'), async (req, res) => {
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
            await (whatsappService as any).updateProfilePicture(sessionId, { path: req.file.path });
        } else if (req.body?.imageUrl) {
            const validated = await validateMediaUrl(req.body.imageUrl);
            if (!validated) {
                throw new SsrfBlockedUrlError(sessionId);
            }
            await (whatsappService as any).updateProfilePicture(sessionId, { url: req.body.imageUrl });
        } else {
            return res.status(400).json({
                success: false,
                error: { code: 400, message: "Either a file upload or imageUrl is required" }
            });
        }

        return res.json({
            success: true,
            data: { message: "Profile picture updated" }
        });
    } finally {
        if (req.file?.path) {
            await unlink(req.file.path).catch(() => {});
        }
    }
});

router.delete('/picture', async (req, res) => {
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

    await (whatsappService as any).removeProfilePicture(sessionId);
    return res.json({
        success: true,
        data: { message: "Profile picture removed" }
    });
});

router.get('/privacy', validate({
    query: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const force = req.query.force === "true";
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    const privacy = await (whatsappService as any).fetchPrivacySettings(sessionId, force);
    return res.json({
        success: true,
        data: privacy
    });
});

router.patch('/privacy', validate({
    body: {
        sessionId: "required|string",
        setting: "required|string",
        value: "required|string"
    }
}), async (req, res) => {
    const { sessionId, setting, value } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    const updated = await (whatsappService as any).updatePrivacySetting(sessionId, setting, value);
    return res.json({
        success: true,
        data: updated || { message: "Privacy setting updated" }
    });
});

export default router;
