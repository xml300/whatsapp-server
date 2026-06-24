import express from "express";
import { sendSuccess } from "../../utils/request.js";
import { Log } from "../../data/db.js";

import authRoutes from "./authRoutes.js";
import whatsappRoutes from "./whatsappRoutes.js";

const router = express.Router();

router.get('/logs', async (req, res) => {
    const { page, limit } = req.query;
    const numLimit = limit ? parseInt(limit as string) : 100;
    const numPage = page ? parseInt(page as string) : 1;
    const offset = (numPage - 1) * numLimit;

    const logs = await Log.find({}, { __v: 0, _id: 0 })
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(numLimit);
    const logCount = await Log.countDocuments();
    const totalPages = Math.ceil(logCount / numLimit);
    sendSuccess(res, logs, {
        totalPages,
        currentPage: numPage,
        logsPerPage: numLimit,
        totalLogs: logCount
    });
});


router.use('/auth', authRoutes);
router.use('/', whatsappRoutes);



export default router;