import express from "express";
import whatsappRoutes from "./routes/whatsappRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { loggingMiddleware } from "./middleware/logging.js";
import { logger } from "./lib/logger.js"; 
import path from 'path';
import { fileURLToPath } from "url";

const app = express();
const PORT = 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(loggingMiddleware);
app.use(express.urlencoded({extended: false}))
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend/')));
 

/**
 * @openapi
 * /health:
 *   get:
 *     description: Health check endpoint
 *     responses:
 *       200:
 *         description: Returns ok.
 */
app.get('/health', (req, res) => {
    logger.info("Health route hit!");
    res.json({ ok: true });
});


app.use('/api/auth', authRoutes);
app.use('/api', whatsappRoutes);

app.use('/{*any}', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/index.html'));
});

app.listen(PORT, async () => {
    logger.info("Server is running on port 3000");
});