
export const logger = {
    info: (message: string | Record<string, any>) => console.log(`[INFO] ${typeof message === "string" ? message : JSON.stringify(message)}`),
    debug: (message: string | Record<string, any>) => console.log(`[DEBUG] ${typeof message === "string" ? message : JSON.stringify(message)}`),
    error: (message: string | Record<string, any>) => console.log(`[ERROR] ${typeof message === "string" ? message : JSON.stringify(message)}`),
    warn: (message: string | Record<string, any>) => console.log(`[WARN] ${typeof message === "string" ? message : JSON.stringify(message)}`),
}