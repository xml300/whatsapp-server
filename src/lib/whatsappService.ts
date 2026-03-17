
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "baileys";
import { Boom } from "@hapi/boom";
import { EventEmitter } from "events";
import pino from "pino";
import { ConnectionStatus } from "../types/types.js";
import type { WhatsappEvents } from "../types/types.js";
import { formatJid } from "../utils/helpers.js";

interface ClientStateInfo {
    socket: ReturnType<typeof makeWASocket> | null;
    status: ConnectionStatus;
    isPairingReady: boolean;
    qr: string | null
}


class WhatsappService {
    private sockets: Map<string, ClientStateInfo>;

    constructor() {
        this.sockets = new Map();
    }

    // on<K extends keyof WhatsappEvents>(event: K, listener: WhatsappEvents[K]) {
    //     this.emitter.on(event, listener);
    // }

    isConnected(apiKey: string) {
        const stateInfo = this.sockets.get(apiKey);
        if (!stateInfo) {
            return false;
        }
        return stateInfo.status === ConnectionStatus.CONNECTED;
    }

    isConnectionReady(apiKey: string) {
        const stateInfo = this.sockets.get(apiKey);
        if (!stateInfo) {
            return false;
        }
        return stateInfo.isPairingReady;
    }

    getQrCode(apiKey: string) {
        const stateInfo = this.sockets.get(apiKey);
        if (!stateInfo) {
            throw new Error("No socket found for API key");
        }
        return stateInfo.qr;
    }

    getPairingCode(apiKey: string, phoneNumber: string) {
        const stateInfo = this.sockets.get(apiKey);
        if (!stateInfo) {
            throw new Error("No socket found for API key");
        }
        return stateInfo.socket?.requestPairingCode(phoneNumber);
    }

    async connect(apiKey: string, username: string) {
        const { state, saveCreds } = await useMultiFileAuthState(username);

        const socket = makeWASocket({
            version: [2, 3000, 1034195523],
            auth: state,
            logger: pino(
                pino.destination('./server.log')
            ),
            browser: ["Ubuntu", "Chrome", "20.0.04"]
        });

        const stateInfo: ClientStateInfo = {
            socket,
            status: ConnectionStatus.DISCONNECTED,
            isPairingReady: false,
            qr: null
        }

        this.registerConnectionHandler(stateInfo, apiKey, username);
        socket.ev.on('creds.update', saveCreds);
        this.registerMessageHandler(stateInfo);


        this.sockets.set(apiKey, stateInfo);
    }

    async disconnect(apiKey: string) {
        const stateInfo = this.sockets.get(apiKey);
        if (!stateInfo) {
            throw new Error("No socket found for API key");
        }
        stateInfo.socket?.end(undefined);
        this.sockets.delete(apiKey);
    }

    private getSocket(apiKey: string) {
        const stateInfo = this.sockets.get(apiKey);
        if (!stateInfo) {
            throw new Error("No socket found for API key");
        }
        return stateInfo.socket;
    }

    private getStatus(apiKey: string) {
        const stateInfo = this.sockets.get(apiKey);
        if (!stateInfo) {
            throw new Error("No socket found for API key");
        }
        return stateInfo.status;
    }

    private registerConnectionHandler(stateInfo: ClientStateInfo, apiKey: string, username: string) {
        const { socket } = stateInfo;
        socket?.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            console.log(JSON.stringify(update, null, 2))
            if (qr) {
                stateInfo.isPairingReady = true;
                stateInfo.qr = qr;
            }
            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                stateInfo.status = ConnectionStatus.DISCONNECTED;
                if (shouldReconnect) {
                    console.log("Connection closed. Reconnecting...");
                    setTimeout(() => this.connect(apiKey, username), 5000);
                } else {
                    console.log("Connection closed. Not reconnecting...");
                }
            } else if (connection === 'open') {
                console.log("✅ WhatsApp is connected!");
                stateInfo.status = ConnectionStatus.CONNECTED;
                // this.emitter.emit('connected');
            }
        });
    }

    private registerMessageHandler(stateInfo: ClientStateInfo) {
        const { socket } = stateInfo;
        socket?.ev.on('messages.upsert', async m => {
            for (const message of m.messages) {
                const text = message.message?.conversation;
                const sender = message.key.remoteJid;
                console.log('New message received:', sender, text);
            }
        });
    }

    async sendTyping(apiKey: string, phoneNumber: string) {
        const status = this.getStatus(apiKey);
        if (status !== ConnectionStatus.CONNECTED) {
            throw new Error("WhatsApp is not connected");
        }
        const socket = this.getSocket(apiKey);
        await socket?.sendPresenceUpdate('composing', formatJid(phoneNumber));
        return true;
    }

    async sendMessage(apiKey: string, phoneNumber: string, msgText: string) {
        const status = this.getStatus(apiKey);
        if (status !== ConnectionStatus.CONNECTED) {
            throw new Error("WhatsApp is not connected");
        }
        const socket = this.getSocket(apiKey);
        const message = await socket?.sendMessage(formatJid(phoneNumber), {
            text: msgText
        });
        return message;
    }

    async sendMediaFile(apiKey: string, phoneNumber: string, file: File, caption?: string) {
        const status = this.getStatus(apiKey);
        if (status !== ConnectionStatus.CONNECTED) {
            throw new Error("WhatsApp is not connected");
        }
        const socket = this.getSocket(apiKey);
        const message = await socket?.sendMessage(formatJid(phoneNumber), {
            document: Buffer.from(await file.arrayBuffer()),
            mimetype: file.type,
            fileName: file.name,
            caption: caption || ""
        })
        return message;
    }
}

export const whatsappService = new WhatsappService();