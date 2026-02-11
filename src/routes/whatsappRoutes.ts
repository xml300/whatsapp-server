import express from "express";
import { whatsappService } from "../lib/whatsappService.js";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

function dataURLtoBlobURL(dataURL: string) {
    // 1. Split the Data URL to get the mime type and the base64 data
    const [header, base64Data] = dataURL.split(',');
    const mimeMatch = header?.match(/:(.*?);/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'text/plain';

    // 2. Decode the base64 string
    const byteString = atob(base64Data!);
    const arrayBuffer = new ArrayBuffer(byteString.length);
    const uint8Array = new Uint8Array(arrayBuffer);

    for (let i = 0; i < byteString.length; i++) {
        uint8Array[i] = byteString.charCodeAt(i);
    }

    // 3. Create the Blob and the URL
    const blob = new Blob([uint8Array], { type: mimeType! });
    return URL.createObjectURL(blob);
}


router.get('/status', (req, res) => {
    const connected = whatsappService.isConnected();
    res.json({ status: connected ? "connected" : "disconnected", connected });
})

router.get('/qr', (req, res) => {
    const qr = whatsappService.getQrCode();
    if (qr) {
        res.json({ status: "success", qr });
    } else {
        res.status(404).json({ status: "error", message: "No QR code available" });
    }
});

router.post('/sendTyping', (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
        return res.status(400).json({ status: "error", message: "Phone number is required" });
    }
    whatsappService.sendTyping(phoneNumber);
    res.json({ status: "success", message: "Typing sent successfully" });
});

router.post('/sendText', async (req, res) => {
    const { phoneNumber, message } = req.body;
    if (!phoneNumber || !message) {
        return res.status(400).json({ status: "error", message: "Phone number and message are required" });
    }
    await whatsappService.sendMessage(phoneNumber, message);
    res.json({ status: "success", message: "Message sent successfully" });
});

router.post('/sendFile', upload.single('file'), async (req, res) => {
    console.log(123, req.body, req.file);
    const { phoneNumber, caption } = req.body;
    const file = req.file;
    console.log(req.body, req.file)
    if (!phoneNumber || !file) {
        return res.status(400).json({ status: "error", message: "Phone number and file are required" });
    }
    const newFile = new File([Buffer.from(file.buffer)], file.originalname, { type: file.mimetype, lastModified: Date.now() });
    await whatsappService.sendMediaFile(phoneNumber, newFile, caption);
    res.json({ status: "success", message: "File sent successfully" });
});

export default router;