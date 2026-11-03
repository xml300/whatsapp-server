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

export type OutboxActionType =
    | "text"
    | "media_url"
    | "media_file"
    | "voice"
    | "sticker"
    | "poll"
    | "location"
    | "contact"
    | "react"
    | "edit"
    | "delete"
    | "read"
    | "pin"
    | "star"
    | "forward"
    | "status_text"
    | "status_media_url"
    | "status_media_file"
    | "status_voice"
    | "status_delete";

export interface QuotedMessageRef {
    messageId?: string;
    remoteJid?: string;
    fromMe?: boolean;
    participant?: string;
    text?: string;
    rawMessage?: any;
}

export interface ContactCardInput {
    displayName: string;
    phoneNumber?: string;
    vcard?: string;
}

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
        recipientJid?: string;
        message?: string;
        mediaType?: string;
        mediaUrl?: string;
        caption?: string;
        filePath?: string;
        originalName?: string;
        mimeType?: string;
        emoji?: string;
        viewOnce?: boolean;
        isAnimated?: boolean;
        mentions?: string[] | "all";
        quoted?: QuotedMessageRef;
        messageKey?: {
            remoteJid?: string | null;
            id?: string | null;
            fromMe?: boolean | null;
            participant?: string | null;
        };
        poll?: {
            name: string;
            values: string[];
            selectableCount?: number;
            toAnnouncementGroup?: boolean;
        };
        location?: {
            degreesLatitude: number;
            degreesLongitude: number;
            name?: string;
            address?: string;
            url?: string;
        };
        contacts?: {
            displayName?: string;
            contacts: ContactCardInput[];
        };
        pin?: {
            type: "pin" | "unpin" | number;
            time?: 86400 | 604800 | 2592000;
        };
        star?: {
            star: boolean;
        };
        forward?: {
            messageId?: string;
            messageKey?: {
                remoteJid?: string | null;
                id?: string | null;
                fromMe?: boolean | null;
                participant?: string | null;
            };
            rawMessage?: any;
            force?: boolean;
        };
        statusOptions?: {
            statusJidList?: string[];
            backgroundColor?: string;
            font?: number;
        };
        sentMessage?: any;
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
