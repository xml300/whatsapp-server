export interface IUser {
    _id: string,
    username: string,
    password: string,
    createdAt: Date,
    updatedAt: Date
}

export interface IApiKey {
    _id: string,
    userId: string,
    apiKey: string,
    createdAt: Date,
    updatedAt: Date
}

export interface IPhoneNumber {
    userId: string,
    phoneNumber: string
};

export interface ISession {
    id: string,
    userId: string,
    phoneNumber: string,
    desiredState?: "CONNECTED" | "DISCONNECTED",
    updatedAt?: Date
};

export type OutboxActionType = "text" | "media_url" | "media_file" | "voice" | "react" | "delete" | "read";

export type OutboxStatus =
    | "QUEUED"
    | "PROCESSING"
    | "DISPATCHED"
    | "DELIVERED_TO_SERVER"
    | "FAILED_TERMINAL"
    | "CANCELLED";

export interface IOutbox {
    _id?: string | undefined;
    userId: string;
    sessionId: string;
    idempotencyKey: string;
    waMessageId: string;
    recipientJid: string;
    actionType: OutboxActionType;
    payload: {
        phoneNumber?: string;
        message?: string;
        mediaType?: string;
        mediaUrl?: string;
        caption?: string;
        filePath?: string;
        originalName?: string;
        mimeType?: string;
        messageKey?: {
            remoteJid?: string | null;
            id?: string | null;
            fromMe?: boolean | null;
        };
        emoji?: string;
    };
    simulateTyping?: boolean;
    status: OutboxStatus;
    attempts: number;
    maxAttempts: number;
    nextAttemptAt: Date;
    dispatchedAt?: Date | null;
    completedAt?: Date | null;
    lastError?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IEvent {
    _id?: string | undefined;
    userId: string;
    sessionId: string;
    eventType: string;
    payload: any;
    createdAt?: Date | undefined;
}
