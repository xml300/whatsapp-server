import mongoose from "mongoose";
import "dotenv/config";
import { logger } from "../lib/logger.js";
import type { IApiKey, IEvent, IOutbox, IPhoneNumber, ISession, IUser } from "../types/models.js";

const DATABASE_URL = process.env.MONGODB_URL;

if(!DATABASE_URL){
    throw new Error("Please provide a MongoDB URL");
}

mongoose.connect(DATABASE_URL)
.then(() => logger.info("Connected to MongoDB"))
.catch((err) => logger.error("Failed to connect to MongoDB " + err));

const userSchema = new mongoose.Schema<IUser>({
    _id: {
        type: String,
        required: true
    },
    username: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    password: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

const apiKeySchema = new mongoose.Schema<IApiKey>({
    userId: String,
    apiKey: String,
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

apiKeySchema.index({ apiKey: 1 }, { unique: true });
apiKeySchema.index({ userId: 1 });

const phoneNumbersSchema = new mongoose.Schema<IPhoneNumber>({
    userId: {
        type: String,
        required: true
    },
    phoneNumber: {
        type: String,
        required: true
    }
});

const credentialSchema = new mongoose.Schema({
    phoneNumber: String,
    credential: String,
});

credentialSchema.index({ phoneNumber: 1 }, { unique: true });

const keyStoreSchema = new mongoose.Schema({
    id: String,
    key: String,
    value: String,
    phoneNumber: String,
    type: String,
});

keyStoreSchema.index({ phoneNumber: 1, key: 1 }, { unique: true });

const logSchema = new mongoose.Schema({
    id: String,
    source: String,
    message: String,
    level: String,
    timestamp: Date,
});

const sessionSchema = new mongoose.Schema<ISession>({
    id: {
        type: String,
        required: true
    },
    userId: {
        type: String,
        required: true
    },
    phoneNumber: {
        type: String,
        required: true
    },
    desiredState: {
        type: String,
        enum: ["CONNECTED", "DISCONNECTED"],
        default: "DISCONNECTED"
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

sessionSchema.index({ id: 1 }, { unique: true });
sessionSchema.index({ desiredState: 1 });

const eventSchema = new mongoose.Schema<IEvent>({
    userId: {
        type: String,
        required: true,
        index: true
    },
    sessionId: {
        type: String,
        required: true,
        index: true
    },
    eventType: {
        type: String,
        required: true,
        index: true
    },
    payload: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

eventSchema.index({ userId: 1, _id: 1 });
eventSchema.index({ userId: 1, sessionId: 1, _id: 1 });
eventSchema.index({ userId: 1, sessionId: 1, "payload.key.id": 1 });
eventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 259200 }); // 3 days TTL

const outboxSchema = new mongoose.Schema<IOutbox>({
    userId: { type: String, required: true, index: true },
    sessionId: { type: String, required: true, index: true },
    idempotencyKey: { type: String, required: true },
    waMessageId: { type: String, required: true, index: true },
    recipientJid: { type: String, required: true },
    actionType: {
        type: String,
        enum: [
            "text",
            "media_url",
            "media_file",
            "voice",
            "sticker",
            "poll",
            "location",
            "contact",
            "react",
            "edit",
            "delete",
            "read",
            "pin",
            "star",
            "forward",
            "status_text",
            "status_media_url",
            "status_media_file",
            "status_voice",
            "status_delete"
        ],
        required: true
    },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    simulateTyping: { type: Boolean, default: false },
    status: { type: String, enum: ["QUEUED", "PROCESSING", "DISPATCHED", "DELIVERED_TO_SERVER", "FAILED_TERMINAL", "CANCELLED"], default: "QUEUED", index: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 6 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    dispatchedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

outboxSchema.index({ sessionId: 1, idempotencyKey: 1 }, { unique: true });
outboxSchema.index({ sessionId: 1, recipientJid: 1, status: 1, nextAttemptAt: 1, _id: 1 });
outboxSchema.index({ sessionId: 1, status: 1, nextAttemptAt: 1, _id: 1 });
outboxSchema.index({ status: 1, dispatchedAt: 1 });
outboxSchema.index({ status: 1, nextAttemptAt: 1 });
outboxSchema.index({ sessionId: 1, waMessageId: 1 });
outboxSchema.index({ userId: 1, _id: 1 });
outboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: 259200 }); // 3 days TTL

export const User = mongoose.model<IUser>("User", userSchema);
export const ApiKey = mongoose.model<IApiKey>("ApiKey", apiKeySchema);
export const PhoneNumber = mongoose.model<IPhoneNumber>("PhoneNumber", phoneNumbersSchema);
export const Credential = mongoose.model("Credential", credentialSchema);
export const KeyStore = mongoose.model("KeyStore", keyStoreSchema);
export const Log = mongoose.model("Log", logSchema);
export const Session = mongoose.model<ISession>("Session", sessionSchema);
export const Event = mongoose.model<IEvent>("Event", eventSchema);
export const Outbox = mongoose.model<IOutbox>("Outbox", outboxSchema);
