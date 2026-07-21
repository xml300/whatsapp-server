import express from "express";
import { Users } from "../../data/models/users.js";
import { whatsappService } from "../../lib/whatsapp-manager.js";
import authMiddleware from "../../middleware/auth.js";
import { Session } from "../../data/db.js";
import { createHash } from "crypto";
import validate from "../../middleware/validate.js";

const router = express.Router();

router.post('/', authMiddleware, validate({
    body: {
        sessionId: 'required|string',
        phoneNumber: 'required|phoneNumber'
    }
}), async (req, res) => {
    const { sessionId, phoneNumber } = req.body;
    const userId = res.locals.userId;
    const hasNumber = await Users.hasPhoneNumber(userId, phoneNumber);
    if (!hasNumber) {
        return res.status(401).json({
            code: 401,
            message: 'Number not registered'
        });
    }
    if (whatsappService.isConnected(sessionId)) {
        return res.status(400).json({
            code: 400,
            message: 'Service already connected'
        });
    }
    const session = await Session.findOne({id: sessionId});
    if(!session){
        return res.status(404).json({
            success: false,
            error: {
                code: 400,
                message: "Session not found."
            }
        })
    }


    const status = await whatsappService.connect(sessionId);
    

    return res.json({
        success: true,
        data: {
            serviceStatus: status,
            sessionId: session.id
        }
    });
});

router.get('/:sessionId/status', authMiddleware, async (req, res) => {
    const sessionId = req.params.sessionId as string;
    const session = await Session.findOne({ id: sessionId });
    if (!session) {
        return res.status(404).json({
            code: 404,
            message: 'Session not found'
        });
    }
    const isConnected = whatsappService.isConnected(sessionId);
    const isPairingReady = whatsappService.isConnectionReady(sessionId);
    return res.json({
        success: true,
        data: { isConnected, isPairingReady }
    });
});

router.get('/:sessionId/qr', authMiddleware, async (req, res) => {
    const sessionId = req.params.sessionId as string;
    const session = await Session.findOne({ id: sessionId });
    if (!session) {
        return res.status(404).json({
            code: 404,
            message: 'Session not found'
        });
    }
    const qr = whatsappService.getQrCode(sessionId);
    return res.json({
        success: true,
        data: { qr }
    });
});

router.get('/:sessionId/pairing-code', authMiddleware, async (req, res) => {
    const sessionId = req.params.sessionId as string;
    const session = await Session.findOne({ id: sessionId });
    if (!session) {
        return res.status(404).json({
            code: 404,
            message: 'Session not found'
        });
    }
    const pairingCode = await whatsappService.getPairingCode(sessionId);
    return res.json({
        success: true,
        data: { pairingCode }
    });
});

router.post('/:sessionId/end', authMiddleware, async (req, res) => {
    const sessionId = req.params.sessionId as string;
    const session = await Session.findOne({ id: sessionId });
    if (!session) {
        return res.status(404).json({
            code: 404,
            message: 'Session not found'
        });
    }
    const status = await whatsappService.disconnect(sessionId);
    return res.json({
        success: true,
        data: { serviceStatus: status ? "disconnected" : "failed to disconnect" }
    });
});


export default router;