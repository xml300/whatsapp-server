
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, type AnyMediaMessageContent, type WAMessageKey } from "baileys";
import { Boom } from "@hapi/boom";
import { EventEmitter } from "events";
import pino from "pino";
import { ConnectionStatus, type ClientStateInfo, type WhatsappEvents } from "../types/whatsapp.js";
import { formatJid } from "../utils/format.js";
import { nameLogger } from "./logger.js";
import { useNoSQLAuthState } from "./auth.js";
import { InvalidMessageKeyError, NotConnectedError, RecipientNotOnWhatsappError, SessionNotFoundError, SsrfBlockedUrlError, UnsupportedMediaTypeError } from "../errors/whatsapp-errors.js";
import { clearUserKeys } from "../data/queries.js";
import { validateMediaUrl } from "../utils/url.js";
import { Session } from "../data/db.js";

const logger = nameLogger("WhatsappService");
const waLogger = pino(pino.destination("./server.log"));
const latestVersion = await fetchLatestBaileysVersion().then(v => v.version).catch(() => [2, 3000, 1034195523] as [number, number, number]);

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
    private isConnecting: Map<string, Promise<void>>;
    private emitter: EventEmitter;

    constructor() {
        this.sockets = new Map();
        this.isConnecting = new Map();
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

    private async clearSession(sessionId: string) {
        const session = await Session.findOne({ id: sessionId });
        if (!session) {
            logger.info("No session record found");
            return false;
        }
        const status = await clearUserKeys(session.userId);
        return status;
    }

    private getSocket(sessionId: string) {
        const stateInfo = this.sockets.get(sessionId);
        if (!stateInfo) {
            return null;
        }
        return stateInfo.socket;
    }

    private registerConnectionHandler(stateInfo: ClientStateInfo, sessionId: string) {
        const { socket } = stateInfo;
        socket?.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            logger.debug(JSON.stringify(update, null, 2))
            if (qr) {
                stateInfo.isPairingReady = true;
                stateInfo.qr = qr;
            }
            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                stateInfo.status = ConnectionStatus.DISCONNECTED;
                if (shouldReconnect && stateInfo.retries < 5) {
                    logger.info("Connection closed. Reconnecting...");
                    stateInfo.retries = stateInfo.retries + 1;
                    const timeout = setTimeout(() => this.connect(sessionId), 5000 * stateInfo.retries);
                    if (stateInfo.timeout) clearTimeout(stateInfo.timeout);
                    stateInfo.timeout = timeout;
                } else {
                    logger.info("Connection closed. Not reconnecting...");
                }
            } else if (connection === 'open') {
                logger.info("✅ WhatsApp is connected!");
                stateInfo.status = ConnectionStatus.CONNECTED;
                this.emit('connected', sessionId);
                stateInfo.retries = 0;
            }
        });
    }

    private registerMessageHandler(stateInfo: ClientStateInfo, sessionId: string) {
        const { socket } = stateInfo;
        socket?.ev.on('messages.upsert', async ({ type, messages }) => {
            if (type === "append") {
                return;
            }

            for (const message of messages) {
                this.emit('message', sessionId, message);
            }
        });
    }

    private registerMessageUpdateHandler(stateInfo: ClientStateInfo, sessionId: string) {
        const { socket } = stateInfo;

        socket?.ev.on('message-receipt.update', (updates) => {
            for (const update of updates) {
                this.emit('message.update', sessionId, update);
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
        return this.activeSessions;
    }

    isConnected(sessionId: string) {
        const stateInfo = this.sockets.get(sessionId);
        if (!stateInfo) {
            return false;
        }
        return stateInfo.status === ConnectionStatus.CONNECTED;
    }

    isConnectionReady(sessionId: string) {
        const stateInfo = this.sockets.get(sessionId);
        if (!stateInfo) {
            return false;
        }
        return stateInfo.isPairingReady;
    }

    getQrCode(sessionId: string) {
        const stateInfo = this.sockets.get(sessionId);
        if (!stateInfo) {
            return null;
        }
        return stateInfo.qr;
    }

    async getPairingCode(sessionId: string) {
        const stateInfo = this.sockets.get(sessionId);
        const socket = this.getSocket(sessionId);
        if (!(socket && stateInfo)) {
            return null;
        }
        return await socket.requestPairingCode(stateInfo.phoneNumber);
    }

    async connect(sessionId: string) {
        const inflightGuard = this.isConnecting.get(sessionId);
        if (inflightGuard) {
            await inflightGuard;
            return this.sockets.get(sessionId)?.status;
        }
        const existing = this.sockets.get(sessionId);
        let promiseResolve = () => { };
        const promise = new Promise<void>((resolve) => promiseResolve = resolve);
        this.isConnecting.set(sessionId, promise);
        try {
            // Already connected — idempotent, no-op
            if (existing?.status === ConnectionStatus.CONNECTED) {
                logger.info("Already connected for this API key");
                return existing.status;
            }


            if (existing && existing.socket) {
                this.cleanupEventListeners(existing.socket);
                if (existing.timeout) clearTimeout(existing.timeout);
                await existing.socket.logout();
            }

            const retries = existing ? existing.retries : 0;
            const session = await Session.findOne({ id: sessionId });
            if (!session) {
                return null;
            }

            const { state, saveCreds } = await useNoSQLAuthState(session.phoneNumber);
            const socket = makeWASocket({
                version: latestVersion,
                auth: state,
                logger: waLogger
            });

            const stateInfo: ClientStateInfo = {
                socket,
                phoneNumber: session.phoneNumber,
                status: ConnectionStatus.DISCONNECTED,
                isPairingReady: false,
                qr: null,
                retries
            }

            this.registerConnectionHandler(stateInfo, sessionId);
            socket.ev.on('creds.update', saveCreds);
            this.registerMessageHandler(stateInfo, sessionId);
            this.registerMessageUpdateHandler(stateInfo, sessionId);
            this.sockets.set(sessionId, stateInfo);
            return stateInfo.status;
        } finally {
            promiseResolve();
            this.isConnecting.delete(sessionId);
        }
    }

    private cleanupEventListeners(socket: ReturnType<typeof makeWASocket>) {
        socket?.ev.removeAllListeners('connection.update');
        socket?.ev.removeAllListeners('messages.upsert');
        socket?.ev.removeAllListeners('message-receipt.update');
        socket?.ev.removeAllListeners('creds.update');
    }

    async disconnect(sessionId: string) {
        try {
            const stateInfo = this.sockets.get(sessionId);
            if (!stateInfo) throw new SessionNotFoundError(sessionId);
            if (stateInfo.timeout) {
                clearTimeout(stateInfo.timeout);
            }
            if (stateInfo.socket) {
                this.cleanupEventListeners(stateInfo.socket);
                await stateInfo.socket.logout().catch((err) => logger.error(err));
            }
            const status = await this.clearSession(sessionId);
            return status;
        } finally {
            this.sockets.delete(sessionId);
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

    private async ensureSendable(sessionId: string) {
        const stateInfo = this.sockets.get(sessionId);
        if (!stateInfo) throw new SessionNotFoundError(sessionId);

        const { status, socket } = stateInfo;
        if (status !== ConnectionStatus.CONNECTED) throw new NotConnectedError(sessionId, status);
        if (!socket) throw new NotConnectedError(sessionId, status);

        // const onWhatsapp = await this.isOnWhatsapp(apiKey, phoneNumber);
        // if (!onWhatsapp) throw new RecipientNotOnWhatsappError(apiKey, phoneNumber);

        return socket;
    }

    private ensureMessageKeyExists(sessionId: string, messageKey: WAMessageKey) {
        const socket = this.getSocket(sessionId);
        if (!socket) throw new SessionNotFoundError(sessionId);
        if (!messageKey.remoteJid) throw new InvalidMessageKeyError(sessionId);
        return { socket, messageKey };
    }

    async sendTyping(sessionId: string, phoneNumber: string) {
        const socket = await this.ensureSendable(sessionId);
        await socket.sendPresenceUpdate('composing', formatJid(phoneNumber));
        return true;
    }

    async sendMessage(sessionId: string, phoneNumber: string, msgText: string) {
        const socket = await this.ensureSendable(sessionId);
        const message = await socket.sendMessage(formatJid(phoneNumber), {
            text: msgText
        });
        return message;
    }

    private buildMediaOptions(mediaType: string, contentType: 'file' | 'url', content: string | Buffer, caption?: string, filename?: string): AnyMediaMessageContent {
        const media = contentType === 'url'
            ? { url: content as string }
            : content as Buffer;

        if (mediaType === "image") {
            return {
                image: media,
                caption: caption || ""
            };
        } else if (mediaType === "video") {
            return {
                video: media,
                caption: caption || ""
            };
        } else if (mediaType === "audio") {
            return {
                audio: media
            };
        } else {
            return {
                document: media,
                mimetype: "application/octet-stream",
                fileName: filename || "document",
                caption: caption || ""
            };
        }
    }


    async sendMediaMessage(sessionId: string, phoneNumber: string, mediaType: string, mediaUrl: string, caption?: string) {
        const socket = await this.ensureSendable(sessionId);

        // SSRF guard: validate the URL before Baileys fetches it server-side
        const validated = await validateMediaUrl(mediaUrl);
        if (!validated) {
            throw new SsrfBlockedUrlError(sessionId);
        }

        const messageOptions: AnyMediaMessageContent = this.buildMediaOptions(mediaType, 'url', mediaUrl, caption);
        const message = await socket.sendMessage(formatJid(phoneNumber), messageOptions);
        return message;
    }

    async sendMediaFile(sessionId: string, phoneNumber: string, file: Express.Multer.File, caption?: string) {
        const socket = await this.ensureSendable(sessionId);
        const type = getMimeTypeGroup(file.mimetype);
        const messageOptions: AnyMediaMessageContent = this.buildMediaOptions(type, 'file', file.buffer, caption, file.originalname);
        const message = await socket.sendMessage(formatJid(phoneNumber), messageOptions);
        return message;
    }

    async sendVoiceNote(sessionId: string, phoneNumber: string, file: Express.Multer.File) {
        const socket = await this.ensureSendable(sessionId);
        const type = getMimeTypeGroup(file.mimetype);
        if (type !== "audio") throw new UnsupportedMediaTypeError(sessionId, file.mimetype);

        const messageOptions: AnyMediaMessageContent = {
            audio: file.buffer,
            mimetype: file.mimetype,
            ptt: true
        }

        const message = await socket.sendMessage(formatJid(phoneNumber), messageOptions);
        return message;
    }



    async isOnWhatsapp(sessionId: string, phoneNumber: string) {
        const socket = this.getSocket(sessionId);
        if (!socket) throw new SessionNotFoundError(sessionId);

        const isWhatsappAvailable = await socket.onWhatsApp(phoneNumber);
        return isWhatsappAvailable?.[0]?.exists;
    }

    async deleteMessage(sessionId: string, msgKey: WAMessageKey) {
        const { socket, messageKey } = this.ensureMessageKeyExists(sessionId, msgKey);
        await socket.sendMessage(messageKey.remoteJid!, {
            delete: messageKey
        });
        return true;
    }

    async readMessage(sessionId: string, msgKey: WAMessageKey) {
        const { socket, messageKey } = this.ensureMessageKeyExists(sessionId, msgKey);
        await socket.readMessages([messageKey]);
        return true;
    }

    async reactMessage(sessionId: string, msgKey: WAMessageKey, emoji: string) {
        const { socket, messageKey } = this.ensureMessageKeyExists(sessionId, msgKey);
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