import { makeWASocket, type WAMessage } from "baileys";
import type { QuotedMessageRef } from "./models.js";

export interface SendMessageExtraOptions {
    customMessageId?: string;
    mentions?: string[] | "all";
    quoted?: QuotedMessageRef;
    viewOnce?: boolean;
    isAnimated?: boolean;
    statusOptions?: {
        statusJidList?: string[];
        backgroundColor?: string;
        font?: number;
    };
}

export type WhatsappEvents = {
    connected: (apiKey: string) => void;
    disconnected: (apiKey: string, reason: string) => void;
    qr: (apiKey: string, dataUrl: string) => void;
    message: (apiKey: string, data: WAMessage) => void;
    "message.update": (apiKey: string, update: any) => void;
    "messages.update": (apiKey: string, updates: any[]) => void;
    "logged.out": (sessionId: string, reason: string) => void;
};

export enum ConnectionStatus {
    CONNECTED = "connected",
    CONNECTING = "connecting",
    RECONNECTING = "reconnecting",
    DEGRADED = "degraded",
    DISCONNECTED = "disconnected",
}

export interface ClientStateInfo {
    socket: ReturnType<typeof makeWASocket> | null;
    phoneNumber: string;
    status: ConnectionStatus;
    isPairingReady: boolean;
    qr: string | null;
    retries: number;
    timeout?: NodeJS.Timeout;
}
