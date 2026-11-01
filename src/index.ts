import "dotenv/config";

import express from "express";
import cors from "cors"; 
import platformRoutes from "./routes/platform/_indexRoutes.js";
import v1Routes from "./routes/v1/_indexRoutes.js";
import { loggingMiddleware } from "./middleware/logging.js";
import { logger } from "./lib/logger.js"; 
import errorMiddleware from "./middleware/error.js";
import cookieParser from "cookie-parser";
import { handleShutdown, handleStartup } from "./utils/server.js"; 

const app = express();
const PORT = parseInt(process.env.PORT || "3000");

app.use(loggingMiddleware);
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'x-api-key'],
    credentials: true
}));
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use('/api', platformRoutes);
app.use('/api/v1', v1Routes);

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: {
            code: 404,
            message: `Route ${req.method} ${req.originalUrl} not found`
        }
    });
});

app.use(errorMiddleware);

const server = app.listen(PORT, "0.0.0.0", async () => {
    logger.info("Server is running on port 3000");
    await handleStartup();
});

const signals = ['SIGTERM', 'SIGINT', 'SIGQUIT', 'SIGUSR2'];

for(const signal of signals) { 
    process.on(signal, async () => {
        logger.info('Handling shutdown signal:', signal);
        await handleShutdown();
        server.close(() => process.exit(0));
    });
}     