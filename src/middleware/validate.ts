import type { NextFunction, Request, Response } from "express";
import type { ValidationRule } from "../utils/validators.js";

async function validateBody(req: any, rule: ValidationRule): Promise<[boolean, Record<string, string>[] | null]> {
    let value: any;
    const errors: Record<string, string>[] = [];
    if (rule.location === "file") {
        value = req.file;
    } else {
        const container = req[rule.location] as Record<string, any> | undefined;
        value = container?.[rule.field];
    }

    if (rule.required && (value === undefined || value === null || value === "")) {
        errors.push({ field: rule.field, message: rule.message || `${rule.field} is required` });
    }

    if (value !== undefined && value !== null && value !== "") {
        if (rule.validate) {
            const result = rule.validate(value);
            if (result === false || result === null) {
                errors.push({ field: rule.field, message: rule.message || `Invalid ${rule.field}` });
            }
            if (typeof result === "string") {
                if (rule.location !== "file") {
                    const container = req[rule.location] as Record<string, any>;
                    container[rule.field] = result;
                }
            }
        }
    }

    if (errors.length > 0) {
        return [false, errors];
    }

    return [true, null];
}

export default function validate(rules: ValidationRule[]) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const validationErrors: Record<string, string>[] = [];
        for (const rule of rules) {
            const [success, errors] = await validateBody(req, rule);
            if (!success && errors) {
                validationErrors.push(...errors);
            }
        }
        if (validationErrors.length > 0) {
            return res.status(412).json({
                status: "error",
                message: "Validation failed",
                details: validationErrors
            });
        }
        next();
    };
}