import express from "express";
import whatsappRoutes from "./routes/whatsappRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { loggingMiddleware } from "./middleware/logging.js";
import { logger } from "./lib/logger.js";
import { swaggerDocs } from "./lib/swagger.js";
import { apiReference } from "@scalar/express-api-reference";

const app = express();
app.use(loggingMiddleware);
app.use(express.urlencoded({extended: false}))
app.use(express.json());
app.use('/docs', apiReference({
    content: swaggerDocs
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
app.get('/health', (req, res) => {
    logger.info("Health route hit!");
    res.json({ ok: true });
});


app.use('/api/auth', authRoutes);
app.use('/api', whatsappRoutes);

app.listen(3000, async () => {
    logger.info("Server is running on port 3000");
});