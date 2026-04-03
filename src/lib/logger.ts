import { Log } from "../data/db.js";

async function log(message: string, level: string, source?: string) {
    const id = crypto.randomUUID();
    await Log.insertOne({
        id: id,
        message: message,
        level: level,
        timestamp: Date.now(),
        source: source || "system"
    })
    console.log(message);
}


export function nameLogger(logger: any, name: string) {
    return {
        info: (message: string | Record<string, any>) => logger.info(`[${name}] ${typeof message === "string" ? message : JSON.stringify(message)}`, name),
        debug: (message: string | Record<string, any>) => logger.debug(`[${name}] ${typeof message === "string" ? message : JSON.stringify(message)}`, name),
        error: (message: string | Record<string, any>) => logger.error(`[${name}] ${typeof message === "string" ? message : JSON.stringify(message)}`, name),
        warn: (message: string | Record<string, any>) => logger.warn(`[${name}] ${typeof message === "string" ? message : JSON.stringify(message)}`, name),
    }
}


export const logger = {
    info: (message: string | Record<string, any>, source?: string) => log(`[INFO] ${typeof message === "string" ? message : JSON.stringify(message)}`, "INFO", source),
    debug: (message: string | Record<string, any>, source?: string) => log(`[DEBUG] ${typeof message === "string" ? message : JSON.stringify(message)}`, "DEBUG", source),
    error: (message: string | Record<string, any>, source?: string) => log(`[ERROR] ${typeof message === "string" ? message : JSON.stringify(message)}`, "ERROR", source),
    warn: (message: string | Record<string, any>, source?: string) => log(`[WARN] ${typeof message === "string" ? message : JSON.stringify(message)}`, "WARN", source),
}