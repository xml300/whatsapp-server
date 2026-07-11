
import makeWASocket, { DisconnectReason, isLidUser, isPnUser } from "baileys";
import { Boom } from "@hapi/boom";
import { EventEmitter } from "events";
import pino from "pino";
import { ConnectionStatus, type ClientStateInfo, type WhatsappEvents } from "../types/whatsapp.js";
import { formatJid } from "../utils/format.js";
import { nameLogger } from "./logger.js";
import { useNoSQLAuthState } from "./auth.js";
import { Credential, KeyStore } from "../data/db.js";
import { Users } from "../data/models/users.js";
import { ApiKeys } from "../data/models/api-keys.js";

const logger = nameLogger("WhatsappService");


class WhatsappService {
    private sockets: Map<string, ClientStateInfo>;
    private emitter: EventEmitter;

    constructor() {
        this.sockets = new Map();
        this.emitter = new EventEmitter();
    }

    private async clearSession(apiKey: string) {
        const apiKeyData = await ApiKeys.get(apiKey);
        if (!apiKeyData) {
            logger.info("No API key record found");
            return false;
        }
        const user = await Users.getById(apiKeyData.userId);
        if (!user || !user.phoneNumber) {
            logger.info("No user found for API key");
            return false;
        }
        await Credential.deleteOne({ phoneNumber: user.phoneNumber });
        await KeyStore.deleteMany({ phoneNumber: user.phoneNumber });
        return true;
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

    private registerConnectionHandler(stateInfo: ClientStateInfo, apiKey: string, phoneNumber: string) {
        const { socket } = stateInfo;
        socket?.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            logger.info("[131] " + JSON.stringify(update, null, 2))
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
                    setTimeout(() => this.connect(apiKey, phoneNumber), 5000);
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
        socket?.ev.on('messages.upsert', async ({ type, messages }) => {
            if (type === "append") {
                return;
            }

            for (const message of messages) {
                this.emit('message', apiKey, message);
                const text = message.message?.conversation;
                const time = parseInt(`${message.messageTimestamp}`);
                const sender = message.key.remoteJid;
                // logger.info(`[165] New message received: ${sender} ${text} ${new Date(time * 1000)}`);
            }
        });
    }

    on<K extends keyof WhatsappEvents>(event: K, listener: WhatsappEvents[K]) {
        this.emitter.on(event, listener);
    }

    off<K extends keyof WhatsappEvents>(event: K, listener: WhatsappEvents[K]) {
        this.emitter.off(event, listener);
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
        const socket = this.getSocket(apiKey);
        if (!socket) {
            logger.info("No socket found for API key");
            return null;
        }
        return await socket.requestPairingCode(phoneNumber);
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
        return stateInfo.status;
    }

    async disconnect(apiKey: string) {
        const socket = this.getSocket(apiKey);
        if (!socket) {
            logger.info("No socket found for API key");
            return false;
        }
        socket.end(undefined);
        this.sockets.delete(apiKey);
        const status = await this.clearSession(apiKey);
        return status;
    }

    async sendTyping(apiKey: string, phoneNumber: string) {
        const status = this.getStatus(apiKey);
        if (status !== ConnectionStatus.CONNECTED) {
            logger.info("WhatsApp is not connected");
            return false;
        }
        const socket = this.getSocket(apiKey);
        if(!socket) {
            logger.info("No socket found for API key");
            return false;
        } 
        await socket.sendPresenceUpdate('composing', formatJid(phoneNumber));
        return true;
    }

    async sendMessage(apiKey: string, phoneNumber: string, msgText: string) {
        const status = this.getStatus(apiKey);
        if (status !== ConnectionStatus.CONNECTED) {
            logger.info("WhatsApp is not connected");
            return null;
        }
        const socket = this.getSocket(apiKey);
        if(!socket) {
            logger.info("No socket found for API key");
            return null;
        } 
        const message = await socket.sendMessage(formatJid(phoneNumber), {
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
        if(!socket) {
            logger.info("No socket found for API key");
            return null;
        } 
        const message = await socket.sendMessage(formatJid(phoneNumber), {
            document: file.buffer,
            mimetype: file.mimetype,
            fileName: file.originalname,
            caption: caption || ""
        })
        return message;
    }

    async isOnWhatsapp(apiKey: string, phoneNumber: string) {
        const socket = this.getSocket(apiKey);
        if(!socket){
            logger.info("No socket found for API key");
            return false;
        }
        const isWhatsappAvailable = await socket.onWhatsApp(formatJid(phoneNumber));
        return isWhatsappAvailable?.[0]?.exists;
    }

    async test(apiKey: string){
        const socket = this.getSocket(apiKey);
        if(!socket){
            logger.info("No socket found for API key");
            return false;
        }

        const isWhatsappAvailable = await socket.onWhatsApp(formatJid("2348054022551"));
        console.log("[249] onWhatsapp", isWhatsappAvailable);

        const isLid = isPnUser(formatJid("2348054022551"));
        console.log("[251] isLid", isLid);
        return true;
    }
}

export const whatsappService = new WhatsappService();