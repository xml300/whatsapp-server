import { Log } from "../data/db.js";

type LogLevel = "INFO" | "DEBUG" | "ERROR" | "WARN";

export const logBuffer: any[] = [];
const MAX_BUFFER_SIZE = 500;
const BATCH_SIZE = 50;
let isFlushing = false;

const colors = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
} as const;

function colorForLevel(level: LogLevel): string {
    switch (level) {
        case "INFO": return colors.green;
        case "WARN": return colors.yellow;
        case "ERROR": return colors.red;
        case "DEBUG": return colors.dim;
    }
}

async function flushBuffer() {
    if (isFlushing || logBuffer.length === 0) return;
    isFlushing = true;
    const batch = logBuffer.splice(0, BATCH_SIZE);
    try {
        await Log.insertMany(batch);
    } catch (dbErr) {
        console.error(`${colors.red}[LOGGER ERROR] Failed to save log to DB:${colors.reset}`, dbErr);
        // Re-queue at the front only if buffer is within bounds
        if (logBuffer.length + batch.length <= MAX_BUFFER_SIZE) {
            logBuffer.unshift(...batch);
        } else {
            console.error(`${colors.yellow}[LOGGER WARN] Dropping ${batch.length} logs to prevent memory overflow${colors.reset}`);
        }
    } finally {
        isFlushing = false;
    }
}

async function log(msg: any, level: LogLevel, source?: string) {
    const id = globalThis.crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const message = typeof msg === "string" ? msg : JSON.stringify(msg);
    const cleanMessage = message.replace(/\x1b\[[0-9;]*m/g, "");

    logBuffer.push({
        id: id,
        message: cleanMessage,
        level: level,
        timestamp: new Date(),
        source: source || "system"
    });

    if (logBuffer.length > MAX_BUFFER_SIZE) {
        // Drop oldest entries beyond maximum buffer limit
        logBuffer.splice(0, logBuffer.length - MAX_BUFFER_SIZE);
    }

    if (logBuffer.length >= BATCH_SIZE && !isFlushing) {
        flushBuffer().catch(() => {});
    }

    const levelColor = colorForLevel(level);
    const sourceTag = `${colors.dim}[${source || "system"}]${colors.reset} `;
    const consoleMessage = `${colors.dim}[${timestamp}]${colors.reset} ${levelColor}[${level}]${colors.reset} ${sourceTag}${message}`;

    if (level === "ERROR") {
        console.error(consoleMessage);
    } else {
        console.log(consoleMessage);
    }
}

export const logger = {
    info: (message: any, source?: string) => log(message, "INFO", source),
    debug: (message: any, source?: string) => log(message, "DEBUG", source),
    error: (message: any, source?: string) => log(message, "ERROR", source),
    warn: (message: any, source?: string) => log(message, "WARN", source),
};

export function nameLogger(name: string) {
    return {
        info: (message: any) => logger.info(message, name),
        debug: (message: any) => logger.debug(message, name),
        error: (message: any) => logger.error(message, name),
        warn: (message: any) => logger.warn(message, name),
    };
}