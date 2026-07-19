import { writeFile, readFile, unlink } from "fs/promises";
import { whatsappService } from "../lib/whatsapp.js";
import { mkdirSync } from "fs";
import { logBuffer } from "../lib/logger.js";
import { Log } from "../data/db.js";

const OUTPUT_PATH = "data/sessions.json"

// {
//     mkdirSync("data", { recursive: true });
// }

export async function handleStartup() {
    try {
        const cachedSessions = await readFile(OUTPUT_PATH);
        const sessions = JSON.parse(cachedSessions.toString());
        for (const session of sessions) {
            await whatsappService.connect(session.apiKey, session.phoneNumber);
        }
        await unlink(OUTPUT_PATH);
    } catch (error) {
    }
}


export async function handleShutdown() {
    const sessions = whatsappService.activeSessions;
    await writeFile(OUTPUT_PATH, JSON.stringify(sessions));

    if (logBuffer.length > 0) {
        await Log.insertMany(logBuffer);
        logBuffer.length = 0;
    }

    await whatsappService.clearAll();
}