
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, type AnyMediaMessageContent, type WAMessageKey } from "baileys";
import { Boom } from "@hapi/boom";
import { EventEmitter } from "events";
import pino from "pino";
import { ConnectionStatus, type ClientStateInfo, type WhatsappEvents } from "../types/whatsapp.js";
import { formatJid } from "../utils/format.js";
import { nameLogger } from "./logger.js";
import { useNoSQLAuthState } from "./auth.js";
import { ApiKeys } from "../data/models/api-keys.js";
import { InvalidMessageKeyError, NotConnectedError, RecipientNotOnWhatsappError, SessionNotFoundError, UnsupportedMediaTypeError } from "../errors/whatsapp-errors.js";
import { clearUserKeys } from "../data/queries.js";

const logger = nameLogger("WhatsappService");
const waLogger = pino(pino.destination("./server.log"));
const latestVersion = (await fetchLatestBaileysVersion()).version;

function getMimeTypeGroup(mimeType: string) {
    if (!mimeType) {
        return 'document';
    }

    const type = mimeType.toLowerCase().split(';')[0]?.trim();

    if (type?.startsWith('image/')) return 'image';
    if (type?.startsWith('video/')) return 'video';
    if (type?.startsWith('audio/')) return 'audio';

    return 'document';
}


class WhatsappService {
    private sockets: Map<string, ClientStateInfo>;
    private inflightConnects: Map<string, Promise<void>>;
    private emitter: EventEmitter;

    constructor() {
        this.sockets = new Map();
        this.inflightConnects = new Map();
        this.emitter = new EventEmitter();
    }

    get activeSessions() {
        const sessions = [];
        for (const [key, value] of this.sockets.entries()) {
            sessions.push({
                apiKey: key,
                status: value.status,
                isPairingReady: value.isPairingReady,
                phoneNumber: value.phoneNumber
            })
        }
        return sessions;
    }

    private async clearSession(apiKey: string) {
        const apiKeyData = await ApiKeys.get(apiKey);
        if (!apiKeyData) {
            logger.info("No API key record found");
            return false;
        }
        const status = await clearUserKeys(apiKeyData.userId);
        return status;
    }

    private getSocket(apiKey: string) {
        const stateInfo = this.sockets.get(apiKey);
        if (!stateInfo) {
            return null;
        }
        return stateInfo.socket;
    }

    private registerConnectionHandler(stateInfo: ClientStateInfo, apiKey: string, phoneNumber: string) {
        const { socket } = stateInfo;
        socket?.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            logger.debug("[131] " + JSON.stringify(update, null, 2))
            if (qr) {
                stateInfo.isPairingReady = true;
                stateInfo.qr = qr;
            }
            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as Boom).output.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                stateInfo.status = ConnectionStatus.DISCONNECTED;
                if (shouldReconnect && stateInfo.retries < 5) {
                    logger.info("Connection closed. Reconnecting...");
                    stateInfo.retries = stateInfo.retries + 1;
                    const timeout = setTimeout(() => this.connect(apiKey, phoneNumber), 5000 * stateInfo.retries);
                    stateInfo.timeout = timeout;
                } else {
                    logger.info("Connection closed. Not reconnecting...");
                }
            } else if (connection === 'open') {
                logger.info("✅ WhatsApp is connected!");
                stateInfo.status = ConnectionStatus.CONNECTED;
                this.emit('connected', apiKey);
                stateInfo.retries = 0;
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
            }
        });
    }

    private messageUpdateHandler(stateInfo: ClientStateInfo, apiKey: string) {
        const { socket } = stateInfo;

        socket?.ev.on('message-receipt.update', (updates) => {
            for (const update of updates) {
                this.emit('message.update', apiKey, update);
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

    getActiveSessions() {
        return this.sockets.size;
    }

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
            return null;
        }
        return stateInfo.qr;
    }

    async getPairingCode(apiKey: string, phoneNumber: string) {
        const socket = this.getSocket(apiKey);
        if (!socket) {
            return null;
        }
        return await socket.requestPairingCode(phoneNumber);
    }

    async connect(apiKey: string, phoneNumber: string) {
        const inflightGuard = this.inflightConnects.get(apiKey);
        if (inflightGuard) {
            await inflightGuard;
            return this.sockets.get(apiKey)?.status;
        }
        const existing = this.sockets.get(apiKey);
        let promiseResolve = () => { };
        const promise = new Promise<void>((resolve) => promiseResolve = resolve);
        this.inflightConnects.set(apiKey, promise);
        try {
            // Already connected — idempotent, no-op
            if (existing?.status === ConnectionStatus.CONNECTED) {
                logger.info("Already connected for this API key");
                return existing.status;
            }


            if (existing && existing.socket) {
                this.cleanupEventListeners(existing.socket);
                existing.timeout ? clearTimeout(existing.timeout) : null;
                await existing.socket.logout();
            }

            const retries = existing ? existing.retries : 0;

            const { state, saveCreds } = await useNoSQLAuthState(phoneNumber);
            const socket = makeWASocket({
                version: latestVersion,
                auth: state,
                logger: waLogger
            });

            const stateInfo: ClientStateInfo = {
                socket,
                phoneNumber,
                status: ConnectionStatus.DISCONNECTED,
                isPairingReady: false,
                qr: null,
                retries
            }

            this.registerConnectionHandler(stateInfo, apiKey, phoneNumber);
            socket.ev.on('creds.update', saveCreds);
            this.registerMessageHandler(stateInfo, apiKey);
            this.messageUpdateHandler(stateInfo, apiKey);
            this.sockets.set(apiKey, stateInfo);
            return stateInfo.status;
        } finally {
            promiseResolve();
            this.inflightConnects.delete(apiKey);
        }
    }

    private cleanupEventListeners(socket: ReturnType<typeof makeWASocket>) {
        socket?.ev.removeAllListeners('connection.update');
        socket?.ev.removeAllListeners('messages.upsert');
        socket?.ev.removeAllListeners('message-receipt.update');
        socket?.ev.removeAllListeners('creds.update');    
    }

    async disconnect(apiKey: string) {
        try {
            const stateInfo = this.sockets.get(apiKey);
            if (!stateInfo) throw new SessionNotFoundError(apiKey);
            if (stateInfo.timeout) {
                clearTimeout(stateInfo.timeout);
            }
            if (stateInfo.socket) {
                this.cleanupEventListeners(stateInfo.socket);
                await stateInfo.socket.logout().catch((err) => logger.error(err));
            }
            const status = await this.clearSession(apiKey);
            return status;
        } finally {
            this.sockets.delete(apiKey);
        }
    }

    async clearAll() {
        for (const stateInfo of this.sockets.values()) {
            if (stateInfo.timeout) {
                clearTimeout(stateInfo.timeout);
            }
            if (stateInfo.socket) {
                this.cleanupEventListeners(stateInfo.socket);
                stateInfo.socket.end(undefined);
            }
        }
        this.sockets.clear();
        return true;
    }

    private async ensureSendable(apiKey: string, phoneNumber: string) {
        const stateInfo = this.sockets.get(apiKey);
        if (!stateInfo) throw new SessionNotFoundError(apiKey);

        const { status, socket } = stateInfo;
        if (status !== ConnectionStatus.CONNECTED) throw new NotConnectedError(apiKey, status);
        if (!socket) throw new NotConnectedError(apiKey, status);

        // const onWhatsapp = await this.isOnWhatsapp(apiKey, phoneNumber);
        // if (!onWhatsapp) throw new RecipientNotOnWhatsappError(apiKey, phoneNumber);

        return socket;
    }

    private ensureMessageKeyExists(apiKey: string, messageKey: WAMessageKey) {
        const socket = this.getSocket(apiKey);
        if (!socket) throw new SessionNotFoundError(apiKey);
        if (!messageKey.remoteJid) throw new InvalidMessageKeyError(apiKey);
        return { socket, messageKey };
    }

    async sendTyping(apiKey: string, phoneNumber: string) {
        const socket = await this.ensureSendable(apiKey, phoneNumber);
        await socket.sendPresenceUpdate('composing', formatJid(phoneNumber));
        return true;
    }

    async sendMessage(apiKey: string, phoneNumber: string, msgText: string) {
        const socket = await this.ensureSendable(apiKey, phoneNumber);
        const message = await socket.sendMessage(formatJid(phoneNumber), {
            text: msgText
        });
        return message;
    }


    async sendMediaMessage(apiKey: string, phoneNumber: string, mediaType: string, mediaUrl: string, caption?: string) {
        const socket = await this.ensureSendable(apiKey, phoneNumber);
        let messageOptions: AnyMediaMessageContent;

        if (mediaType === "image") {
            messageOptions = {
                image: { url: mediaUrl },
                caption: caption || ""
            };
        } else if (mediaType === "video") {
            messageOptions = {
                video: { url: mediaUrl },
                caption: caption || ""
            };
        } else if (mediaType === "audio") {
            messageOptions = {
                audio: { url: mediaUrl }
            };
        } else {
            messageOptions = {
                document: { url: mediaUrl },
                mimetype: "application/octet-stream",
                fileName: mediaUrl.split("/").pop() || "document",
                caption: caption || ""
            };
        }

        const message = await socket.sendMessage(formatJid(phoneNumber), messageOptions);
        return message;
    }

    async sendMediaFile(apiKey: string, phoneNumber: string, file: Express.Multer.File, caption?: string) {
        const socket = await this.ensureSendable(apiKey, phoneNumber);
        const type = getMimeTypeGroup(file.mimetype);
        let messageOptions: AnyMediaMessageContent;

        if (type === "image") {
            messageOptions = {
                image: file.buffer,
                caption: caption || ""
            }
        } else if (type === "video") {
            messageOptions = {
                video: file.buffer,
                caption: caption || ""
            }
        } else if (type === "audio") {
            messageOptions = {
                audio: file.buffer
            }
        } else {
            messageOptions = {
                document: file.buffer,
                mimetype: file.mimetype,
                fileName: file.originalname,
                caption: caption || ""
            }
        }

        const message = await socket.sendMessage(formatJid(phoneNumber), messageOptions);
        return message;
    }

    async sendVoiceNote(apiKey: string, phoneNumber: string, file: Express.Multer.File) {
        const socket = await this.ensureSendable(apiKey, phoneNumber);
        const type = getMimeTypeGroup(file.mimetype);
        if (type !== "audio") throw new UnsupportedMediaTypeError(apiKey, file.mimetype);

        const messageOptions: AnyMediaMessageContent = {
            audio: file.buffer,
            mimetype: file.mimetype,
            ptt: true
        }

        const message = await socket.sendMessage(formatJid(phoneNumber), messageOptions);
        return message;
    }



    async isOnWhatsapp(apiKey: string, phoneNumber: string) {
        const socket = this.getSocket(apiKey);
        if (!socket) throw new SessionNotFoundError(apiKey);

        const isWhatsappAvailable = await socket.onWhatsApp(phoneNumber);
        return isWhatsappAvailable?.[0]?.exists;
    }

    async deleteMessage(apiKey: string, messageKey_: WAMessageKey) {
        const { socket, messageKey } = this.ensureMessageKeyExists(apiKey, messageKey_);
        await socket.sendMessage(messageKey.remoteJid!, {
            delete: messageKey
        });
        return true;
    }

    async readMessage(apiKey: string, messageKey_: WAMessageKey) {
        const { socket, messageKey } = this.ensureMessageKeyExists(apiKey, messageKey_);
        await socket.readMessages([messageKey]);
        return true;
    }

    async reactMessage(apiKey: string, messageKey_: WAMessageKey, emoji: string) {
        const { socket, messageKey } = this.ensureMessageKeyExists(apiKey, messageKey_);
        await socket.sendMessage(messageKey.remoteJid!, {
            react: {
                text: emoji,
                key: messageKey
            }
        });
        return true;
    }
}

export const whatsappService = new WhatsappService();