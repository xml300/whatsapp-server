import { writeFile, readFile, unlink } from "fs/promises";
import { whatsappService } from "../lib/whatsapp.js";

const OUTPUT_PATH = "data/sessions.json"

export async function handleStartup(){
    const cachedSessions = await readFile(OUTPUT_PATH);
    const sessions = JSON.parse(cachedSessions.toString());
    for(const session of sessions) {
        await whatsappService.connect(session.apiKey, session.phoneNumber);
    }
    await unlink(OUTPUT_PATH);
}


export async function handleShutdown(){
    const sessions = whatsappService.activeSessions;
    await writeFile(OUTPUT_PATH, JSON.stringify(sessions));
}