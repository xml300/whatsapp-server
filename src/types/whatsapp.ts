import { makeWASocket, type WAMessage } from "baileys";

export type WhatsappEvents = {
    connected: (apiKey: string) => void;
    disconnected: (apiKey: string, reason: string) => void;
    qr: (apiKey: string, dataUrl: string) => void;
    message: (apiKey: string, data: WAMessage) => void;
};

export enum ConnectionStatus {
    CONNECTED = "connected",
    DISCONNECTED = "disconnected",
}

export interface ClientStateInfo {
    socket: ReturnType<typeof makeWASocket> | null;
    status: ConnectionStatus;
    isPairingReady: boolean;
    qr: string | null;
}
