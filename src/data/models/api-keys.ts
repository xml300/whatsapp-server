import type { IApiKey } from "../../types/models.js";
import { ApiKey } from "../db.js";

const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 5_000;
const apiKeyCache = new Map<string, { data: IApiKey; expiresAt: number }>();

function setCachedKey(apiKeyValue: string, data: IApiKey) {
    if (apiKeyCache.size >= MAX_CACHE_ENTRIES && !apiKeyCache.has(apiKeyValue)) {
        const oldestKey = apiKeyCache.keys().next().value;
        if (oldestKey !== undefined) {
            apiKeyCache.delete(oldestKey);
        }
    }
    apiKeyCache.set(apiKeyValue, {
        data,
        expiresAt: Date.now() + CACHE_TTL_MS
    });
}

export const ApiKeys = {
    create: async (data: Omit<IApiKey, "_id" | "createdAt" | "updatedAt">) => {
        const apiKey = await ApiKey.create(data);
        setCachedKey(apiKey.apiKey, apiKey.toObject());
        return apiKey;
    },
    get: async (apiKeyValue: string) => {
        const now = Date.now();
        const cached = apiKeyCache.get(apiKeyValue);
        if (cached) {
            if (cached.expiresAt > now) {
                return cached.data;
            }
            apiKeyCache.delete(apiKeyValue);
        }

        const apiKey = await ApiKey.findOne({ apiKey: apiKeyValue }).lean();
        if (!apiKey) return null;
        setCachedKey(apiKeyValue, apiKey);
        return apiKey;
    },
    getByUserId: async (userId: string) => {
        const apiKeys = await ApiKey.find({ userId }).lean();
        if (!apiKeys) return [];
        return apiKeys;
    },
    invalidateCache: (apiKeyValue?: string) => {
        if (apiKeyValue) {
            apiKeyCache.delete(apiKeyValue);
        } else {
            apiKeyCache.clear();
        }
    }
}