import { readFile, unlink } from "fs/promises";
import { whatsappService } from "../lib/whatsapp-manager.js";
import { outboxEngine } from "../lib/outbox.js";
import { logBuffer, logger } from "../lib/logger.js";
import { Log, Session } from "../data/db.js";

const OUTPUT_PATH = "data/sessions.json";

export async function handleStartup() {
    await outboxEngine.start();

    // Check if legacy data/sessions.json exists
    try {
        const cachedSessions = await readFile(OUTPUT_PATH);
        const sessions = JSON.parse(cachedSessions.toString());
        if (Array.isArray(sessions) && sessions.length > 0) {
            logger.info(`Migrating ${sessions.length} legacy cached session(s) to MongoDB desiredState...`);
            await Session.updateMany(
                { id: { $in: sessions } },
                { $set: { desiredState: "CONNECTED", updatedAt: new Date() } }
            );
        }
        await unlink(OUTPUT_PATH).catch(() => {});
    } catch (err: any) {
        if (err?.code !== "ENOENT") {
            logger.warn(`Failed reading legacy cached sessions file: ${err}`);
        }
    }

    try {
        const activeSessions = await Session.find({ desiredState: "CONNECTED" });
        logger.info(`Restoring ${activeSessions.length} active session(s) from MongoDB...`);

        for (const session of activeSessions) {
            whatsappService.connect(session.id)
                .then(() => {
                    outboxEngine.kickSession(session.id);
                })
                .catch((sessionErr) => {
                    logger.error(`Failed to reconnect session ${session.id} during startup: ${sessionErr}`);
                });
        }
        logger.info("Cold-start session recovery initiated.");
    } catch (error) {
        logger.error(`Error querying or restoring sessions in handleStartup: ${error}`);
    }
}

export async function handleShutdown() {
    outboxEngine.stop();

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
