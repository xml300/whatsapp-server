import type { Response } from "express";

export function formatJid(phoneNumber: string): string {
    return `${phoneNumber}@s.whatsapp.net`;
}

export function normalizePhoneNumber(phoneNumber: string){
    phoneNumber = phoneNumber.replace(/\D/g, "");

    if(phoneNumber.length === 13 && phoneNumber.startsWith("234")){
        return phoneNumber;
    }

    if(phoneNumber.length === 11 && phoneNumber.startsWith("0")){
        return "234" + phoneNumber.slice(1);
    }

    if(phoneNumber.length === 10 && /^(7|8|9)/.test(phoneNumber)){
        return "234" + phoneNumber;
    }
 
    return null;
}

export function sendSuccess(res: Response, data: any = null, meta: any = null, statusCode = 200) {
    return res.status(statusCode).json({
        success: true,
        data,
        meta: meta ? meta : undefined
    });
}

export function sendError(res: Response, message: string, statusCode = 400, details?: any[]) {
    return res.status(statusCode).json({
        success: false,
        error: {
            message,
            ...(details ? { details } : {})
        }
    });
}