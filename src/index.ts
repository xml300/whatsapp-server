import "dotenv/config";

import express from "express";
import cors from "cors"; 
import platformRoutes from "./routes/platform/_indexRoutes.js";
import v1Routes from "./routes/v1/_indexRoutes.js";
import oauthRoutes, { handleOAuthMetadata } from "./routes/oauthRoutes.js";
import { loggingMiddleware } from "./middleware/logging.js";
import { logger } from "./lib/logger.js"; 
import errorMiddleware from "./middleware/error.js";
import cookieParser from "cookie-parser";
import { platformOriginGuard, getAllowedOrigins, normalizeOrigin } from "./middleware/origin-guard.js";
import { handleShutdown, handleStartup } from "./utils/server.js"; 

const app = express();
const PORT = parseInt(process.env.PORT || "3000");

// Trust first proxy (Cloud Run, Render, ALB, Nginx) so req.secure and Set-Cookie Secure work properly
app.set("trust proxy", 1);

app.use(loggingMiddleware);

// 1. Strict CORS for Platform APIs (supports cookie credentials)
const platformCors = cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const allowedOrigins = getAllowedOrigins();
        const normalized = normalizeOrigin(origin);
        if (allowedOrigins.includes("*") || allowedOrigins.includes(normalized)) {
            return callback(null, true);
        }
        return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key', 'Idempotency-Key', 'idempotency-key'],
    credentials: true
});

// 2. Open CORS for Gateway v1 APIs (authenticated via Bearer token or x-api-key header)
const gatewayCors = cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'authorization', 'x-api-key', 'X-Api-Key', 'Idempotency-Key', 'idempotency-key'],
    credentials: false
});

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// OAuth 2.0 Discovery & Token Endpoints (open to external callers, MCP clients, curl)
app.get('/.well-known/oauth-authorization-server', gatewayCors, handleOAuthMetadata);
app.use('/oauth', gatewayCors, oauthRoutes);

// Gateway v1 routes open to any origin (secured by Bearer token or x-api-key) — mounted before /api so /api middleware doesn't intercept /api/v1
app.use('/api/v1', gatewayCors, v1Routes);

// Platform routes guarded by strict CORS + origin guard (cookie auth)
app.use('/api', platformCors, platformOriginGuard, platformRoutes);

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