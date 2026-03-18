import { Router } from "express";
import { dataStore } from "../lib/dataStore.js";
import { whatsappService } from "../lib/whatsappService.js";
import authMiddleware from "../middleware/auth.js";

const router = Router();

router.post('/register', (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
        return res.json({ status: "error", message: "Phone number is required" })
    }
    const apiKey = crypto.randomUUID();
    dataStore.writeData({ apiKey, phoneNumber });
    return res.json({ status: "success", apiKey });
});

router.post('/connect', authMiddleware, async (req, res) => {
    const apiKey = req.apiKey;
    const user = dataStore.readData(apiKey);
    if (!user || !user.phoneNumber) {
        return res.json({ status: "error", message: "Invalid API Key" })
    }
    const stateInfo = await whatsappService.connect(apiKey, user.phoneNumber);
    return res.json({ status: "success", t:stateInfo.qr });
});

router.get('/connect/status', authMiddleware, (req, res) => {
    const apiKey = req.apiKey;
    const user = dataStore.readData(apiKey);
    if (!user || !user.phoneNumber) {
        return res.json({ status: "error", message: "Invalid API Key" })
    }
    const isConnectionReady = whatsappService.isConnectionReady(apiKey);
    return res.json({ status: "success", isConnectionReady });
});

router.get('/connect/qr', authMiddleware, (req, res) => {
    const apiKey = req.apiKey;
    const user = dataStore.readData(apiKey);
    if (!user || !user.phoneNumber) {
        return res.json({ status: "error", message: "Invalid API Key" })
    }
    const qr = whatsappService.getQrCode(apiKey);
    return res.json({ status: "success", qr });
});

router.get('/connect/pairing-code', authMiddleware, async (req, res) => {
    const apiKey = req.apiKey;
    const user = dataStore.readData(apiKey);
    if (!user || !user.phoneNumber) {
        return res.json({ status: "error", message: "Invalid API Key" })
    }
    const pairingCode = await whatsappService.getPairingCode(apiKey, user.phoneNumber);
    return res.json({ status: "success", pairingCode });
});

export default router;