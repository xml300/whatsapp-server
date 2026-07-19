import { Log } from "../data/db.js";

type LogLevel = "INFO" | "DEBUG" | "ERROR" | "WARN";

export const logBuffer: any[] = [];

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

async function log(msg: any, level: LogLevel, source?: string) {
    const id = globalThis.crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const message = typeof msg === "string" ? msg : JSON.stringify(msg);

    if (logBuffer.length > 50) {
        try {
            await Log.insertMany(logBuffer);
            logBuffer.length = 0;
        } catch (dbErr) {
            console.error(`${colors.red}[LOGGER ERROR] Failed to save log to DB:${colors.reset}`, dbErr);
        }
    }
    logBuffer.push({
        id: id,
        message: message,
        level: level,
        timestamp: new Date(),
        source: source || "system"
    });


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