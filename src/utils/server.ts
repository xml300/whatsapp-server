import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import { dirname } from "path";
import { whatsappService } from "../lib/whatsapp-manager.js";
import { logBuffer } from "../lib/logger.js";
import { Log } from "../data/db.js";
import { logger } from "../lib/logger.js";

const OUTPUT_PATH = "data/sessions.json";

export async function handleStartup() {
    let cachedSessions: Buffer;
    try {
        cachedSessions = await readFile(OUTPUT_PATH);
    } catch (err: any) {
        if (err?.code === "ENOENT") {
            logger.info("No cached sessions found on startup.");
            return;
        }
        logger.error(`Failed to read cached sessions file: ${err}`);
        return;
    }

    try {
        const sessions = JSON.parse(cachedSessions.toString());
        if (!Array.isArray(sessions) || sessions.length === 0) {
            logger.info("Cached sessions list is empty.");
            await unlink(OUTPUT_PATH).catch(() => {});
            return;
        }

        logger.info(`Restoring ${sessions.length} active session(s)...`);
        for (const sessionId of sessions) {
            try {
                logger.info(`Reconnecting session: ${sessionId}`);
                await whatsappService.connect(sessionId);
            } catch (sessionErr) {
                logger.error(`Failed to reconnect session ${sessionId} during startup: ${sessionErr}`);
            }
        }
        await unlink(OUTPUT_PATH).catch((unlinkErr) => {
            logger.warn(`Failed to clean up cached sessions file: ${unlinkErr}`);
        });
        logger.info("Cold-start session recovery completed.");
    } catch (error) {
        logger.error(`Error parsing or restoring sessions in handleStartup: ${error}`);
    }
}

export async function handleShutdown() {
    try {
        const sessions = whatsappService.activeSessions;
        await mkdir(dirname(OUTPUT_PATH), { recursive: true });
        await writeFile(OUTPUT_PATH, JSON.stringify(sessions));
        logger.info(`Persisted ${sessions.length} active session(s) to ${OUTPUT_PATH}`);
    } catch (err) {
        logger.error(`Failed to write shutdown sessions cache: ${err}`);
    }

    if (logBuffer.length > 0) {
        try {
            await Log.insertMany(logBuffer);
            logBuffer.length = 0;
        } catch (dbErr) {
            console.error("Failed to flush logBuffer during shutdown:", dbErr);
        }
    }

    await whatsappService.clearAll();
}