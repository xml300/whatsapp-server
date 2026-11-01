import mongoose from "mongoose";
import type { IEvent } from "../../types/models.js";
import { Event } from "../db.js";

export interface GetEventsOptions {
    userId: string;
    sessionId?: string | undefined;
    eventType?: string | undefined;
    after?: string | undefined;
    limit?: number | undefined;
}

export const Events = {
    create: async (data: Omit<IEvent, "_id" | "createdAt">) => {
        const event = await Event.create(data);
        return event;
    },

    getEvents: async ({ userId, sessionId, eventType, after, limit = 50 }: GetEventsOptions) => {
        const query: any = { userId };

        if (sessionId) {
            query.sessionId = sessionId;
        }

        if (eventType) {
            query.eventType = eventType;
        }

        if (after) {
            if (mongoose.Types.ObjectId.isValid(after)) {
                query._id = { $gt: new mongoose.Types.ObjectId(after) };
            }
        }

        const safeLimit = Math.min(Math.max(1, limit), 100);

        const events = await Event.find(query)
            .sort({ _id: 1 })
            .limit(safeLimit)
            .lean();

        const lastItem = events.length > 0 ? events[events.length - 1] : null;
        const lastCursor = lastItem ? String(lastItem._id) : null;

        return {
            events,
            count: events.length,
            lastCursor
        };
    },

    clearEventsForSession: async (userId: string, sessionId: string) => {
        return await Event.deleteMany({ userId, sessionId });
    }
};
