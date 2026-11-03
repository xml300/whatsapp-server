import {
    normalizePhoneNumber,
    formatGroupJid,
    isValidGroupJid,
    formatNewsletterJid,
    isValidNewsletterJid,
    normalizeParticipantJid
} from "./format.js";

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
        validate: (val) => !!(val && ((val.buffer && val.buffer.length > 0) || (val.path && typeof val.size === "number" && val.size > 0))),
        message: "File is required and cannot be empty"
    },
    boolean: {
        validate: (val) => typeof val === "boolean" || val === "true" || val === "false",
        transform: (val) => val === true || val === "true",
        message: "must be a boolean"
    },
    groupJid: {
        validate: (val) => typeof val === "string" && formatGroupJid(val) !== null,
        transform: (val) => formatGroupJid(val)!,
        message: "Invalid or missing group JID (@g.us)"
    },
    channelJid: {
        validate: (val) => typeof val === "string" && formatNewsletterJid(val) !== null,
        transform: (val) => formatNewsletterJid(val)!,
        message: "Invalid or missing channel JID (@newsletter)"
    },
    jid: {
        validate: (val) =>
            typeof val === "string" &&
            (normalizeParticipantJid(val) !== null ||
                isValidGroupJid(val) ||
                isValidNewsletterJid(val) ||
                val.trim() === "status@broadcast"),
        transform: (val) => {
            const normalized = normalizeParticipantJid(val);
            if (normalized !== null) {
                return normalized;
            }
            return typeof val === "string" ? val.trim() : val;
        },
        message: "Invalid WhatsApp JID or phone number"
    },
    number: {
        validate: (val) =>
            (typeof val === "number" && !Number.isNaN(val)) ||
            (typeof val === "string" && val.trim() !== "" && !Number.isNaN(Number(val))),
        transform: (val) => Number(val),
        message: "must be a valid number"
    },
    array: {
        validate: (val) => Array.isArray(val),
        message: "must be an array"
    },
    nonEmptyArray: {
        validate: (val) => Array.isArray(val) && val.length > 0,
        message: "must be a non-empty array"
    },
    object: {
        validate: (val) => typeof val === "object" && val !== null && !Array.isArray(val),
        message: "must be an object"
    }
};
