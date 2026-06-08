import { normalizePhoneNumber } from "./helpers.js";

export type ValidationRule = {
    field: string;
    location: "body" | "query" | "params" | "file";
    required?: boolean;
    validate?: (value: any) => boolean | string | null;
    message?: string;
};

export const rules = {
    phoneNumber: (location: "body" | "query" | "params" = "body"): ValidationRule => ({
        field: "phoneNumber",
        location,
        required: true,
        validate: (val: any) => {
            if (typeof val !== "string") return false;
            const normalized = normalizePhoneNumber(val);
            return normalized ? normalized : false;
        },
        message: "Invalid or missing phone number"
    }),

    message: {
        field: "message",
        location: "body",
        required: true,
        validate: (val: any) => typeof val === "string" && val.trim().length > 0,
        message: "Message content is required"
    } as ValidationRule,

    file: {
        field: "file",
        location: "file",
        required: true,
        validate: (val: any) => !!(val && val.buffer && val.buffer.length > 0),
        message: "File is required and cannot be empty"
    } as ValidationRule
} as const;
