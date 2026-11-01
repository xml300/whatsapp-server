import express from "express";
import { Log } from "../../data/db.js";
import userAuthMiddleware from "../../middleware/user-auth.js";
import { logger } from "../../lib/logger.js";
import { whatsappService } from "../../lib/whatsapp-manager.js";

import authRoutes from "./authRoutes.js";
import apiKeyRoutes from "./apiKeyRoutes.js";
import sessionRoutes from "./sessionRoutes.js";

const router = express.Router();

router.get('/health', (req, res) => {
    logger.info("Health route hit!");
    res.json({
        success: true,
        data: {
            ok: true,
            activeSessions: whatsappService.getActiveSessions()
        }
    });
});

router.get('/logs', userAuthMiddleware, async (req, res) => {
    const { page, limit } = req.query;
    const parsedLimit = limit ? parseInt(limit as string, 10) : 100;
    const parsedPage = page ? parseInt(page as string, 10) : 1;
    const numLimit = isNaN(parsedLimit) || parsedLimit <= 0 ? 100 : Math.min(parsedLimit, 500);
    const numPage = isNaN(parsedPage) || parsedPage <= 0 ? 1 : parsedPage;
    const offset = (numPage - 1) * numLimit;

    const logs = await Log.find({}, { __v: 0, _id: 0 })
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(numLimit);
    const logCount = await Log.countDocuments();
    const totalPages = Math.ceil(logCount / numLimit);
    return res.json({
        success: true,
        data: logs,
        meta: {
            totalPages,
            currentPage: numPage,
            logsPerPage: numLimit,
            totalLogs: logCount
        }
    });
});

router.use('/auth', authRoutes);
router.use('/api-keys', apiKeyRoutes);
router.use('/sessions', sessionRoutes);

export default router;
