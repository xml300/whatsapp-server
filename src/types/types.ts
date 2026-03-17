export type WhatsappEvents = {
    connected: () => void;
    disconnected: (reason: string) => void;
    qr: (dataUrl: string) => void;
    message: (data: { sender: string | null; text: string | null; raw: any }) => void;
};

export enum ConnectionStatus {
    CONNECTED = "connected",
    DISCONNECTED = "disconnected",
}