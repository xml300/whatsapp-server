import express from "express";
import { whatsappService } from "./lib/whatsappService.js";
import whatsappRoutes from "./routes/whatsappRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { logger } from "./middleware/logger.js";

const app = express();
app.use(logger);
app.use(express.json());

// Debug: health check directly on app
app.get('/health', (req, res) => {
    console.log("Health route hit!");
    res.json({ ok: true });
});


app.use('/api/auth', authRoutes);
app.use('/api', whatsappRoutes);

app.listen(3000, async () => {
    console.log("Server is running on port 3000");
});