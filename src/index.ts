import express from "express";
import { whatsappService } from "./lib/whatsappService.js";
import whatsappRoutes from "./routes/whatsappRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { loggingMiddleware } from "./middleware/logger.js";
import { logger } from "./lib/logger.js";

const app = express();
app.use(loggingMiddleware);
app.use(express.json());

// Debug: health check directly on app
app.get('/health', (req, res) => {
    logger.info("Health route hit!");
    res.json({ ok: true });
});


app.use('/api/auth', authRoutes);
app.use('/api', whatsappRoutes);

app.listen(3000, async () => {
    logger.info("Server is running on port 3000");
});