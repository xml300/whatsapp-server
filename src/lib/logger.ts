import { Log } from "../data/db.js";

type LogLevel = "INFO" | "DEBUG" | "ERROR" | "WARN";

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

    try {
        await Log.create({
            id: id,
            message: message,
            level: level,
            timestamp: new Date(),
            source: source || "system"
        });
    } catch (dbErr) {
        console.error(`${colors.red}[LOGGER ERROR] Failed to save log to DB:${colors.reset}`, dbErr);
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

export function nameLogger(loggerInstance: any, name: string) {
    return {
        info: (message: any) => loggerInstance.info(message, name),
        debug: (message: any) => loggerInstance.debug(message, name),
        error: (message: any) => loggerInstance.error(message, name),
        warn: (message: any) => loggerInstance.warn(message, name),
    };
}

export const logger = {
    info: (message: any, source?: string) => log(message, "INFO", source),
    debug: (message: any, source?: string) => log(message, "DEBUG", source),
    error: (message: any, source?: string) => log(message, "ERROR", source),
    warn: (message: any, source?: string) => log(message, "WARN", source),
};