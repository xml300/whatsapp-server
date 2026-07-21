import "dotenv/config";

import express from "express";
import cors from "cors"; 
import v1Routes from "./routes/v1/_indexRoutes.js";
import { loggingMiddleware } from "./middleware/logging.js";
import { logger } from "./lib/logger.js"; 
import errorMiddleware from "./middleware/error.js";
import cookieParser from "cookie-parser";
import { whatsappService } from "./lib/whatsapp-manager.js";
import { handleShutdown, handleStartup } from "./utils/server.js"; 

const app = express();
const PORT = parseInt(process.env.PORT || "3000");

app.use(loggingMiddleware);
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }))
app.use(express.json());
app.use(cors({
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    credentials: true
}));


app.get('/api/health', (req, res) => {
    logger.info("Health route hit!");
    res.json({
        success: true,
        data: { 
            ok: true,
            activeSessions: whatsappService.getActiveSessions()
        }
    });
});

app.use('/api/v1', v1Routes);

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