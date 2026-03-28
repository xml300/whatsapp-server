
import makeWASocket, { DisconnectReason } from "baileys";
import { Boom } from "@hapi/boom";
import { EventEmitter } from "events";
import pino from "pino";
import { ConnectionStatus } from "../types/types.js";
import type { WhatsappEvents } from "../types/types.js";
import { formatJid } from "../utils/helpers.js";
import { logger } from "./logger.js";
import { useNoSQLAuthState } from "./auth.js";


interface ClientStateInfo {
    socket: ReturnType<typeof makeWASocket> | null;
    status: ConnectionStatus;
    isPairingReady: boolean;
    qr: string | null;
}

class WhatsappService {
    private sockets: Map<string, ClientStateInfo>;
    private emitter: EventEmitter;

    constructor() {
        this.sockets = new Map();
        this.emitter = new EventEmitter();
    }

    on<K extends keyof WhatsappEvents>(event: K, listener: WhatsappEvents[K]) {
        this.emitter.on(event, listener);
    }

    emit<K extends keyof WhatsappEvents>(event: K, ...args: Parameters<WhatsappEvents[K]>) {
        this.emitter.emit(event, ...args);
    }

    isConnected(apiKey: string) {
        const stateInfo = this.sockets.get(apiKey);
        if (!stateInfo) {
            logger.info("No socket found for API key")
            return false;
        }
        return stateInfo.status === ConnectionStatus.CONNECTED;
    }

    isConnectionReady(apiKey: string) {
        const stateInfo = this.sockets.get(apiKey);
        if (!stateInfo) {
            logger.info("No socket found for API key")
            return false;
        }
        return stateInfo.isPairingReady;
    }

    getQrCode(apiKey: string) {
        const stateInfo = this.sockets.get(apiKey);
        if (!stateInfo) {
            logger.info("No socket found for API key")
            return null;
        }
        return stateInfo.qr;
    }

    async getPairingCode(apiKey: string, phoneNumber: string) {
        const stateInfo = this.sockets.get(apiKey);
        if (!stateInfo) {
            logger.info("No socket found for API key");
            return null;
        }
        return await stateInfo.socket?.requestPairingCode(phoneNumber);
    }

    async connect(apiKey: string, phoneNumber: string) {
        const { state, saveCreds } = await useNoSQLAuthState(phoneNumber);
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

        this.registerConnectionHandler(stateInfo, apiKey, phoneNumber);
        socket.ev.on('creds.update', saveCreds);
        this.registerMessageHandler(stateInfo, apiKey);
        this.sockets.set(apiKey, stateInfo);
        return stateInfo;
    }

    async disconnect(apiKey: string) {
        const stateInfo = this.sockets.get(apiKey);
        if (!stateInfo) {
            logger.info("No socket found for API key");
            return;
        }
        stateInfo.socket?.end(undefined);
        this.sockets.delete(apiKey);
    }

    private getSocket(apiKey: string) {
        const stateInfo = this.sockets.get(apiKey);
        if (!stateInfo) {
            logger.info("No socket found for API key");
            return null;
        }
        return stateInfo.socket;
    }

    private getStatus(apiKey: string) {
        const stateInfo = this.sockets.get(apiKey);
        if (!stateInfo) {
            logger.info("No socket found for API key");
            return null;
        }
        return stateInfo.status;
    }

    private registerConnectionHandler(stateInfo: ClientStateInfo, apiKey: string, username: string) {
        const { socket } = stateInfo;
        socket?.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            logger.info(JSON.stringify(update, null, 2))
            if (qr) {
                stateInfo.isPairingReady = true;
                stateInfo.qr = qr;
            }
            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                stateInfo.status = ConnectionStatus.DISCONNECTED;
                if (shouldReconnect) {
                    logger.info("Connection closed. Reconnecting...");
                    setTimeout(() => this.connect(apiKey, username), 5000);
                } else {
                    logger.info("Connection closed. Not reconnecting...");
                }
            } else if (connection === 'open') {
                logger.info("✅ WhatsApp is connected!");
                stateInfo.status = ConnectionStatus.CONNECTED;
                this.emit('connected', apiKey);
            }
        });
    }

    private registerMessageHandler(stateInfo: ClientStateInfo, apiKey: string) {
        const { socket } = stateInfo;
        socket?.ev.on('messages.upsert', async m => {
            for (const message of m.messages) {
                this.emit('message', apiKey, message)
                const text = message.message?.conversation;
                const time = parseInt(`${message.messageTimestamp}`);
                const sender = message.key.remoteJid;
                logger.info(JSON.stringify(message, null, 2))
                logger.info(`New message received: ${sender} ${text} ${new Date(time * 1000)}`);
            }
        });
    }

    async sendTyping(apiKey: string, phoneNumber: string) {
        const status = this.getStatus(apiKey);
        if (status !== ConnectionStatus.CONNECTED) {
            logger.info("WhatsApp is not connected");
            return false;
        }
        const socket = this.getSocket(apiKey);
        await socket?.sendPresenceUpdate('composing', formatJid(phoneNumber));
        return true;
    }

    async sendMessage(apiKey: string, phoneNumber: string, msgText: string) {
        const status = this.getStatus(apiKey);
        if (status !== ConnectionStatus.CONNECTED) {
            logger.info("WhatsApp is not connected");
            return null;
        }
        const socket = this.getSocket(apiKey);
        const message = await socket?.sendMessage(formatJid(phoneNumber), {
            text: msgText
        });
        return message;
    }

    async sendMediaFile(apiKey: string, phoneNumber: string, file: Express.Multer.File, caption?: string) {
        const status = this.getStatus(apiKey);
        if (status !== ConnectionStatus.CONNECTED) {
            logger.info("WhatsApp is not connected");
            return null;
        }
        const socket = this.getSocket(apiKey);
        const message = await socket?.sendMessage(formatJid(phoneNumber), {
            document: file.buffer,
            mimetype: file.mimetype,
            fileName: file.originalname,
            caption: caption || ""
        })
        return message;
    }
}

export const whatsappService = new WhatsappService();