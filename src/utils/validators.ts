import { normalizePhoneNumber } from "./format.js";

export interface ValidationRule {
    validate: (value: any) => boolean | Promise<boolean>;
    transform?: (value: any) => any;
    message: string;
}

export const ruleRegistry: Record<string, ValidationRule> = {
    required: {
        validate: (val) => val !== undefined && val !== null && val !== "",
        message: "is required"
    },
    string: {
        validate: (val) => typeof val === "string",
        message: "must be a string"
    },
    phoneNumber: {
        validate: (val) => typeof val === "string" && normalizePhoneNumber(val) !== null,
        transform: (val) => normalizePhoneNumber(val)!,
        message: "Invalid or missing phone number"
    },
    message: {
        validate: (val) => typeof val === "string" && val.trim().length > 0 && val.trim().length <= 65530,
        message: "Message content is required"
    },
    file: {
        validate: (val) => !!(val && val.buffer && val.buffer.length > 0),
        message: "File is required and cannot be empty"
    }
};
