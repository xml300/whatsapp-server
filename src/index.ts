import express from "express";
import cors from "cors";
import whatsappRoutes from "./routes/whatsappRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { loggingMiddleware } from "./middleware/logging.js";
import { logger } from "./lib/logger.js";
import { Log } from "./data/db.js";
import errorMiddleware from "./middleware/error.js";
import { sendSuccess } from "./utils/helpers.js";

const app = express();
const PORT = 3000;

app.use(loggingMiddleware);
app.use(express.urlencoded({ extended: false }))
app.use(express.json());
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));



/**
 * @openapi
 * /health:
 *   get:
 *     description: Health check endpoint
 *     responses:
 *       200:
 *         description: Returns ok.
 */
app.get('/api/health', (req, res) => {
    logger.info("Health route hit!");
    sendSuccess(res, { ok: true });
});

app.get('/api/logs', async (req, res) => {
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


app.use('/api/auth', authRoutes);
app.use('/api', whatsappRoutes);

app.use(errorMiddleware);

app.listen(PORT, "0.0.0.0", async () => {
    logger.info("Server is running on port 3000");
});