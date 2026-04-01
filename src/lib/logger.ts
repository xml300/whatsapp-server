export function nameLogger(logger: any, name: string){
    return {
        info: (message: string | Record<string, any>) => logger.info(`[${name}] ${typeof message === "string" ? message : JSON.stringify(message)}`),
        debug: (message: string | Record<string, any>) => logger.debug(`[${name}] ${typeof message === "string" ? message : JSON.stringify(message)}`),
        error: (message: string | Record<string, any>) => logger.error(`[${name}] ${typeof message === "string" ? message : JSON.stringify(message)}`),
        warn: (message: string | Record<string, any>) => logger.warn(`[${name}] ${typeof message === "string" ? message : JSON.stringify(message)}`),
    }
}


export const logger = {
    info: (message: string | Record<string, any>) => console.log(`[INFO] ${typeof message === "string" ? message : JSON.stringify(message)}`),
    debug: (message: string | Record<string, any>) => console.log(`[DEBUG] ${typeof message === "string" ? message : JSON.stringify(message)}`),
    error: (message: string | Record<string, any>) => console.log(`[ERROR] ${typeof message === "string" ? message : JSON.stringify(message)}`),
    warn: (message: string | Record<string, any>) => console.log(`[WARN] ${typeof message === "string" ? message : JSON.stringify(message)}`),
}