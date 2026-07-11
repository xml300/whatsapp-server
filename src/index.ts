import express from "express";
import cors from "cors"; 
import v1Routes from "./routes/v1/_indexRoutes.js";
import { loggingMiddleware } from "./middleware/logging.js";
import { logger } from "./lib/logger.js"; 
import errorMiddleware from "./middleware/error.js";
import cookieParser from "cookie-parser";

const app = express();
const PORT = 3000;

app.use(loggingMiddleware);
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }))
app.use(express.json());
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    credentials: true
}));


app.get('/api/health', (req, res) => {
    logger.info("Health route hit!");
    res.json({
        success: true,
        data: { ok: true }
    });
});

app.use('/api/v1', v1Routes);

app.use(errorMiddleware);

app.listen(PORT, "0.0.0.0", async () => {
    logger.info("Server is running on port 3000");
});