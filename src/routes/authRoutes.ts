import { Router } from "express";
import { dataStore } from "../lib/dataStore.js";
import { whatsappService } from "../lib/whatsappService.js";

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

router.post('/connect', (req, res) => {
    const apiKey = req.headers["x-api-key"] as string;
    if (!apiKey) {
        return res.json({ status: "error", message: "API Key is required" })
    }
    const user = dataStore.readData(apiKey);
    if (!user || !user.phoneNumber) {
        return res.json({ status: "error", message: "Invalid API Key" })
    }
    const client = whatsappService.connect(apiKey, user.phoneNumber);
    return res.json({ status: "success", client });
});

export default router;