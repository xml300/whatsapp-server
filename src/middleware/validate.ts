import type { NextFunction, Request, Response } from "express";
import { ruleRegistry } from "../utils/validators.js";

export interface ValidationConfig {
    body?: Record<string, string>;
    query?: Record<string, string>;
    params?: Record<string, string>;
    file?: string;
}

async function validateField(
    value: any,
    ruleString: string,
    fieldKey: string,
    location: string
): Promise<{ error: string | null; transformedValue?: any }> {
    const rules = ruleString.split("|");
    
    // Check 'required' rule first if present
    const isRequired = rules.includes("required");
    const isEmpty = value === undefined || value === null || value === "";

    if (isEmpty) {
        if (isRequired) {
            const ruleObj = ruleRegistry["required"];
            return { error: `${fieldKey} ${ruleObj?.message || "is required"}` };
        }
        // If not required and empty, skip other validations
        return { error: null };
    }

    let currentValue = value;

    for (const rule of rules) {
        if (rule === "required") continue; // Already checked

        const ruleObj = ruleRegistry[rule];
        if (!ruleObj) {
            return { error: `Unknown validation rule slug: ${rule}` };
        }

        const isValid = await ruleObj.validate(currentValue);
        if (!isValid) {
            return { error: ruleObj.message };
        }

        if (ruleObj.transform) {
            currentValue = ruleObj.transform(currentValue);
        }
    }

    return { error: null, transformedValue: currentValue };
}

export default function validate(config: ValidationConfig) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const errors: Record<string, string>[] = [];

        // 1. Validate Body
        if (config.body) {
            req.body = req.body || {};
            for (const [key, ruleString] of Object.entries(config.body)) {
                const { error, transformedValue } = await validateField(req.body[key], ruleString, key, "body");
                if (error) {
                    errors.push({ field: key, message: error, location: "body" });
                } else if (transformedValue !== undefined) {
                    req.body[key] = transformedValue;
                }
            }
        }

        // 2. Validate Query
        if (config.query) {
            req.query = req.query || {};
            for (const [key, ruleString] of Object.entries(config.query)) {
                const { error, transformedValue } = await validateField(req.query[key], ruleString, key, "query");
                if (error) {
                    errors.push({ field: key, message: error, location: "query" });
                } else if (transformedValue !== undefined) {
                    req.query[key] = transformedValue as any;
                }
            }
        }

        // 3. Validate Params
        if (config.params) {
            req.params = req.params || {};
            for (const [key, ruleString] of Object.entries(config.params)) {
                const { error, transformedValue } = await validateField(req.params[key], ruleString, key, "params");
                if (error) {
                    errors.push({ field: key, message: error, location: "params" });
                } else if (transformedValue !== undefined) {
                    req.params[key] = transformedValue as any;
                }
            }
        }

        // 4. Validate File
        if (config.file) {
            const { error } = await validateField(req.file, config.file, "file", "file");
            if (error) {
                errors.push({ field: "file", message: error, location: "file" });
            }
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 400,
                    message: "Validation failed",
                    details: errors
                }
            });
        }

        next();
    };
}