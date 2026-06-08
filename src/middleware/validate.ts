import type { NextFunction, Request, Response } from "express";
import type { ValidationRule } from "../utils/validators.js";

export default function validate(rules: ValidationRule[]) {
    return (req: Request, res: Response, next: NextFunction): void | Response => {
        for (const rule of rules) {
            let value: any;
            if (rule.location === "file") {
                value = req.file;
            } else {
                const container = req[rule.location] as Record<string, any> | undefined;
                value = container?.[rule.field];
            }

            if (rule.required && (value === undefined || value === null || value === "")) {
                return res.status(400).json({
                    status: "error",
                    message: rule.message || `${rule.field} is required`
                });
            }

            if (value !== undefined && value !== null && value !== "") {
                if (rule.validate) {
                    const result = rule.validate(value);
                    if (result === false || result === null) {
                        return res.status(400).json({
                            status: "error",
                            message: rule.message || `Invalid ${rule.field}`
                        });
                    }
                    if (typeof result === "string") {
                        if (rule.location !== "file") {
                            const container = req[rule.location] as Record<string, any>;
                            container[rule.field] = result;
                        }
                    }
                }
            }
        }
        next();
    };
}