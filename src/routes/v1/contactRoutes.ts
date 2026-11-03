import express from "express";
import authMiddleware from "../../middleware/auth.js";
import validate from "../../middleware/validate.js";
import { Session } from "../../data/db.js";
import { whatsappService } from "../../lib/whatsapp-manager.js";

const router = express.Router();
router.use(authMiddleware);

router.get('/blocklist', validate({
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

    const blocklist = await (whatsappService as any).fetchBlocklist(sessionId);
    return res.json({
        success: true,
        data: { blocklist }
    });
});

router.get('/:phoneNumber/on-whatsapp', validate({
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
            error: { code: 404, message: "Session not found" }
        });
    }

    const exists = await (whatsappService as any).isOnWhatsapp(sessionId, phoneNumber);
    return res.json({
        success: true,
        data: {
            phoneNumber,
            exists: !!exists
        }
    });
});

router.get('/:jid/profile', validate({
    params: {
        jid: "required|string"
    },
    query: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const { jid } = req.params;
    const sessionId = req.query.sessionId as string;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    const profile = await (whatsappService as any).getContactProfile(sessionId, jid);
    return res.json({
        success: true,
        data: profile
    });
});

router.post('/:jid/block', validate({
    params: {
        jid: "required|string"
    },
    body: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const { jid } = req.params;
    const { sessionId } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    await (whatsappService as any).updateBlockStatus(sessionId, jid, "block");
    return res.json({
        success: true,
        data: { message: "Contact blocked successfully" }
    });
});

router.post('/:jid/unblock', validate({
    params: {
        jid: "required|string"
    },
    body: {
        sessionId: "required|string"
    }
}), async (req, res) => {
    const { jid } = req.params;
    const { sessionId } = req.body;
    const userId = res.locals.userId;

    const session = await Session.findOne({ id: sessionId, userId });
    if (!session) {
        return res.status(404).json({
            success: false,
            error: { code: 404, message: "Session not found" }
        });
    }

    await (whatsappService as any).updateBlockStatus(sessionId, jid, "unblock");
    return res.json({
        success: true,
        data: { message: "Contact unblocked successfully" }
    });
});

export default router;
