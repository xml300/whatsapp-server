import type { IApiKey } from "../../types/models.js";
import { ApiKey } from "../db.js";

export const ApiKeys = {
    create: async (data: Omit<IApiKey, "_id" | "createdAt" | "updatedAt">) => {
        const apiKey = await ApiKey.create(data);
        return apiKey;
    },
    get: async (apiKeyValue: string) => {
        const apiKey = await ApiKey.findOne({ apiKey: apiKeyValue });
        if (!apiKey) return null;
        return apiKey;
    },
    getByUserId: async (userId: string) => {
        const apiKeys = await ApiKey.find({ userId });
        if (!apiKeys) return [];
        return apiKeys;
    }
}