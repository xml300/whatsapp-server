
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, type AnyMediaMessageContent, type WAMessageKey } from "baileys";
import { Boom } from "@hapi/boom";
import { EventEmitter } from "events";
import { readFile } from "fs/promises";
import pino from "pino";
import { ConnectionStatus, type ClientStateInfo, type WhatsappEvents } from "../types/whatsapp.js";
import { formatJid } from "../utils/format.js";
import { nameLogger } from "./logger.js";
import { useNoSQLAuthState } from "./auth.js";
import { InvalidMessageKeyError, NotConnectedError, RecipientNotOnWhatsappError, SessionNotFoundError, SsrfBlockedUrlError, UnsupportedMediaTypeError } from "../errors/whatsapp-errors.js";
import { clearUserKeys } from "../data/queries.js";
import { validateMediaUrl } from "../utils/url.js";
import { Session } from "../data/db.js";
import { Events } from "../data/models/events.js";

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


export class WhatsappService {
    private emitter: EventEmitter;

    private socket: ReturnType<typeof makeWASocket> | null;
    private phoneNumber: string;
    private sessionId: string;
    private userId: string;
    private status: ConnectionStatus;
    private isPairingReady: boolean;
    private qr: string | null;
    private retries: number;
    private timeout?: NodeJS.Timeout;

    constructor(phoneNumber: string, sessionId: string = "", userId: string = "") {
        this.emitter = new EventEmitter();

        this.socket = null;
        this.phoneNumber = phoneNumber;
        this.sessionId = sessionId;
        this.userId = userId;
        this.status = ConnectionStatus.DISCONNECTED;
        this.isPairingReady = false;
        this.qr = null;
        this.retries = 0;
    }

    private registerConnectionHandler() {
        this.socket?.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            logger.debug(JSON.stringify(update, null, 2))
            if (qr) {
                this.isPairingReady = true;
                this.qr = qr;
                if (this.userId && this.sessionId) {
                    Events.create({
                        userId: this.userId,
                        sessionId: this.sessionId,
                        eventType: "qr",
                        payload: { qr }
                    }).catch((err) => logger.error(`Failed to store qr event: ${err}`));
                }
                this.emit('qr', this.sessionId || '0', qr);
            }
            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                if (statusCode === DisconnectReason.loggedOut) {
                    this.status = ConnectionStatus.DISCONNECTED;
                    this.isPairingReady = false;
                    this.qr = null;
                    Session.updateOne({ id: this.sessionId }, { $set: { desiredState: "DISCONNECTED", updatedAt: new Date() } }).catch((err) => logger.error(`Failed to update session desiredState: ${err}`));
                    await clearUserKeys(this.phoneNumber);
                    if (this.userId && this.sessionId) {
                        Events.create({
                            userId: this.userId,
                            sessionId: this.sessionId,
                            eventType: "connection",
                            payload: {
                                status: ConnectionStatus.DISCONNECTED,
                                statusCode,
                                reason: (lastDisconnect?.error as Boom)?.message || "Logged out"
                            }
                        }).catch((err) => logger.error(`Failed to store disconnected event: ${err}`));
                    }
                    this.emit('disconnected', this.sessionId || '0', (lastDisconnect?.error as Boom)?.message || "Logged out");
                    this.emit('logged.out', this.sessionId || '0', "Session logged out by WhatsApp");
                } else if (shouldReconnect) {
                    this.retries = this.retries + 1;
                    if (this.timeout) clearTimeout(this.timeout);

                    if (this.retries <= 5) {
                        this.status = ConnectionStatus.RECONNECTING;
                        const baseDelay = Math.min(30000, 2000 * Math.pow(2, this.retries - 1));
                        const jitter = Math.floor(Math.random() * 1000);
                        const delay = baseDelay + jitter;
                        logger.info(`Connection closed. Reconnecting in ${delay}ms (attempt ${this.retries}/5)...`);
                        this.timeout = setTimeout(() => this.connect().catch((err) => logger.error(`Reconnection error: ${err}`)), delay);
                    } else {
                        this.status = ConnectionStatus.DEGRADED;
                        const probeDelay = 60000 + Math.floor(Math.random() * 5000);
                        logger.warn(`Session ${this.sessionId} in DEGRADED state (attempt ${this.retries}). Probing reconnection in ${probeDelay}ms...`);
                        this.timeout = setTimeout(() => this.connect().catch((err) => logger.error(`Degraded probe error: ${err}`)), probeDelay);
                    }

                    if (this.userId && this.sessionId) {
                        Events.create({
                            userId: this.userId,
                            sessionId: this.sessionId,
                            eventType: "connection",
                            payload: {
                                status: this.status,
                                statusCode,
                                reason: (lastDisconnect?.error as Boom)?.message || "Connection closed"
                            }
                        }).catch((err) => logger.error(`Failed to store disconnected event: ${err}`));
                    }
                    this.emit('disconnected', this.sessionId || '0', (lastDisconnect?.error as Boom)?.message || "Connection closed");
                } else {
                    this.status = ConnectionStatus.DISCONNECTED;
                    this.isPairingReady = false;
                    this.qr = null;
                    if (this.userId && this.sessionId) {
                        Events.create({
                            userId: this.userId,
                            sessionId: this.sessionId,
                            eventType: "connection",
                            payload: {
                                status: ConnectionStatus.DISCONNECTED,
                                statusCode,
                                reason: (lastDisconnect?.error as Boom)?.message || "Connection closed"
                            }
                        }).catch((err) => logger.error(`Failed to store disconnected event: ${err}`));
                    }
                    this.emit('disconnected', this.sessionId || '0', (lastDisconnect?.error as Boom)?.message || "Connection closed");
                }
            } else if (connection === 'open') {
                logger.info("✅ WhatsApp is connected!");
                this.status = ConnectionStatus.CONNECTED;
                this.isPairingReady = false;
                this.qr = null;
                this.retries = 0;
                Session.updateOne({ id: this.sessionId }, { $set: { desiredState: "CONNECTED", updatedAt: new Date() } }).catch((err) => logger.error(`Failed to update session desiredState: ${err}`));
                if (this.userId && this.sessionId) {
                    Events.create({
                        userId: this.userId,
                        sessionId: this.sessionId,
                        eventType: "connection",
                        payload: {
                            status: ConnectionStatus.CONNECTED,
                            phoneNumber: this.phoneNumber
                        }
                    }).catch((err) => logger.error(`Failed to store connected event: ${err}`));
                }
                this.emit('connected', this.sessionId || '0');
            }
        });
    }

    private registerMessageHandler() {
        this.socket?.ev.on('messages.upsert', async ({ type, messages }) => {
            if (type === "append") {
                return;
            }

            for (const message of messages) {
                if (this.userId && this.sessionId) {
                    try {
                        await Events.create({
                            userId: this.userId,
                            sessionId: this.sessionId,
                            eventType: "message",
                            payload: message
                        });
                    } catch (err) {
                        logger.error(`Failed to store message event: ${err}`);
                    }
                }
                this.emit('message', this.sessionId || '0', message);
            }
        });
    }

    private registerMessageUpdateHandler() {
        this.socket?.ev.on('message-receipt.update', async (updates) => {
            for (const update of updates) {
                if (this.userId && this.sessionId) {
                    try {
                        await Events.create({
                            userId: this.userId,
                            sessionId: this.sessionId,
                            eventType: "message.update",
                            payload: update
                        });
                    } catch (err) {
                        logger.error(`Failed to store message.update event: ${err}`);
                    }
                }
                this.emit('message.update', this.sessionId || '0', update);
            }
        });

        this.socket?.ev.on('messages.update', async (updates) => {
            this.emit('messages.update', this.sessionId || '0', updates);
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

    getStatus(): ConnectionStatus {
        return this.status;
    }

    getUserId(): string {
        return this.userId;
    }

    isConnected() {
        return this.status === ConnectionStatus.CONNECTED;
    }

    isConnectionReady() {
        return this.isPairingReady;
    }

    getQrCode() {
        if (!this.isPairingReady) {
            return null;
        }
        return this.qr;
    }

    async getPairingCode(sessionId: string) {
        const socket = this.socket;
        if (!socket) {
            return null;
        }
        return await socket.requestPairingCode(this.phoneNumber);
    }

    async connect(): Promise<ConnectionStatus> {
        // Already connected — idempotent, no-op
        if (this.status === ConnectionStatus.CONNECTED) {
            logger.info("Already connected for this session");
            return this.status;
        }

        this.status = this.retries > 0
            ? (this.retries > 5 ? ConnectionStatus.DEGRADED : ConnectionStatus.RECONNECTING)
            : ConnectionStatus.CONNECTING;

        if (this.socket) {
            this.cleanupEventListeners();
            if (this.timeout) clearTimeout(this.timeout);
            this.socket.end(undefined);
            this.socket = null;
        }

        const { state, saveCreds } = await useNoSQLAuthState(this.phoneNumber);
        const socket = makeWASocket({
            version: latestVersion,
            auth: state,
            logger: waLogger
        });
        this.socket = socket;

        this.registerConnectionHandler();
        socket.ev.on('creds.update', saveCreds);
        this.registerMessageHandler();
        this.registerMessageUpdateHandler();

        // Wait for initial connection resolution (open, qr, close, or timeout)
        return new Promise<ConnectionStatus>((resolve) => {
            let resolved = false;
            const finish = (status: ConnectionStatus) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    resolve(status);
                }
            };

            const timer = setTimeout(() => {
                finish(this.status);
            }, 15000);

            const initialHandler = (update: any) => {
                if (update.qr) {
                    finish(ConnectionStatus.DISCONNECTED);
                } else if (update.connection === 'open') {
                    finish(ConnectionStatus.CONNECTED);
                } else if (update.connection === 'close') {
                    finish(ConnectionStatus.DISCONNECTED);
                }
            };

            socket.ev.on('connection.update', initialHandler);
        });
    }

    private cleanupEventListeners() {
        this.socket?.ev.removeAllListeners('connection.update');
        this.socket?.ev.removeAllListeners('messages.upsert');
        this.socket?.ev.removeAllListeners('message-receipt.update');
        this.socket?.ev.removeAllListeners('messages.update');
        this.socket?.ev.removeAllListeners('creds.update');
    }

    async disconnect() {
        const socket = this.socket;
        if (!socket) throw new SessionNotFoundError(this.sessionId);
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
        this.cleanupEventListeners();
        socket.end(undefined);
        this.socket = null;
        this.status = ConnectionStatus.DISCONNECTED;
        this.isPairingReady = false;
        this.qr = null;
        return true;
    }

    clear() {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
        if (this.socket) {
            this.cleanupEventListeners();
            this.socket.end(undefined);
        }

    }


    private async recordOutgoingMessage(message: any) {
        if (this.userId && this.sessionId && message) {
            try {
                await Events.create({
                    userId: this.userId,
                    sessionId: this.sessionId,
                    eventType: "message",
                    payload: message
                });
            } catch (err) {
                logger.error(`Failed to store outgoing message event: ${err}`);
            }
            this.emit('message', this.sessionId || '0', message);
        }
    }

    private async ensureSendable() {
        const { status, socket } = this;
        if (status !== ConnectionStatus.CONNECTED) throw new NotConnectedError(this.sessionId, status);
        if (!socket) throw new NotConnectedError(this.sessionId, status);

        // const onWhatsapp = await this.isOnWhatsapp(phoneNumber);
        // if (!onWhatsapp) throw new RecipientNotOnWhatsappError(this.sessionId, phoneNumber);

        return socket;
    }

    private ensureMessageKeyExists(messageKey: WAMessageKey) {
        const socket = this.socket;
        if (!socket) throw new SessionNotFoundError(this.sessionId);
        if (!messageKey.remoteJid) throw new InvalidMessageKeyError(this.sessionId);
        return { socket, messageKey };
    }

    async sendTyping(phoneNumber: string) {
        const socket = await this.ensureSendable();
        await socket.sendPresenceUpdate('composing', formatJid(phoneNumber));
        return true;
    }

    async sendTypingPaused(phoneNumber: string) {
        const socket = await this.ensureSendable();
        await socket.sendPresenceUpdate('paused', formatJid(phoneNumber));
        return true;
    }

    async sendMessage(phoneNumber: string, msgText: string, customMessageId?: string) {
        const socket = await this.ensureSendable();
        const message = await socket.sendMessage(
            formatJid(phoneNumber),
            { text: msgText },
            customMessageId ? { messageId: customMessageId } : undefined
        );
        await this.recordOutgoingMessage(message);
        return message;
    }

    private buildMediaOptions(
        mediaType: string,
        contentType: 'file' | 'url',
        content: string | Buffer,
        caption?: string,
        filename?: string,
        mimetype?: string
    ): AnyMediaMessageContent {
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
                audio: media,
                mimetype: mimetype || "audio/mp4"
            };
        } else {
            return {
                document: media,
                mimetype: mimetype || "application/octet-stream",
                fileName: filename || "document",
                caption: caption || ""
            };
        }
    }

    async sendMediaMessage(phoneNumber: string, mediaType: string, mediaUrl: string, caption?: string, customMessageId?: string) {
        const socket = await this.ensureSendable();

        // SSRF guard: validate the URL before Baileys fetches it server-side
        const validated = await validateMediaUrl(mediaUrl);
        if (!validated) {
            throw new SsrfBlockedUrlError(this.sessionId);
        }

        const messageOptions: AnyMediaMessageContent = this.buildMediaOptions(mediaType, 'url', mediaUrl, caption);
        const message = await socket.sendMessage(
            formatJid(phoneNumber),
            messageOptions,
            customMessageId ? { messageId: customMessageId } : undefined
        );
        await this.recordOutgoingMessage(message);
        return message;
    }

    async sendMediaFile(
        phoneNumber: string,
        file: Express.Multer.File | { buffer?: Buffer; path?: string; mimetype: string; originalname: string },
        caption?: string,
        customMessageId?: string
    ) {
        const socket = await this.ensureSendable();
        const buffer = file.buffer ?? (file.path ? await readFile(file.path) : undefined);
        if (!buffer) {
            throw new Error("No file buffer or path provided for media file");
        }
        const type = getMimeTypeGroup(file.mimetype);
        const messageOptions: AnyMediaMessageContent = this.buildMediaOptions(
            type,
            'file',
            buffer,
            caption,
            file.originalname,
            file.mimetype
        );
        const message = await socket.sendMessage(
            formatJid(phoneNumber),
            messageOptions,
            customMessageId ? { messageId: customMessageId } : undefined
        );
        await this.recordOutgoingMessage(message);
        return message;
    }

    async sendVoiceNote(
        phoneNumber: string,
        file: Express.Multer.File | { buffer?: Buffer; path?: string; mimetype: string; originalname?: string },
        customMessageId?: string
    ) {
        const socket = await this.ensureSendable();
        const type = getMimeTypeGroup(file.mimetype);
        if (type !== "audio") throw new UnsupportedMediaTypeError(this.sessionId, file.mimetype);

        const buffer = file.buffer ?? (file.path ? await readFile(file.path) : undefined);
        if (!buffer) {
            throw new Error("No file buffer or path provided for voice note");
        }

        const messageOptions: AnyMediaMessageContent = {
            audio: buffer,
            mimetype: file.mimetype,
            ptt: true
        };

        const message = await socket.sendMessage(
            formatJid(phoneNumber),
            messageOptions,
            customMessageId ? { messageId: customMessageId } : undefined
        );
        await this.recordOutgoingMessage(message);
        return message;
    }

    async isOnWhatsapp(phoneNumber: string) {
        const socket = this.socket;
        if (!socket) throw new SessionNotFoundError(this.sessionId);

        const isWhatsappAvailable = await socket.onWhatsApp(phoneNumber);
        return isWhatsappAvailable?.[0]?.exists;
    }

    async deleteMessage(msgKey: WAMessageKey, customMessageId?: string) {
        const { socket, messageKey } = this.ensureMessageKeyExists(msgKey);
        await socket.sendMessage(
            messageKey.remoteJid!,
            { delete: messageKey },
            customMessageId ? { messageId: customMessageId } : undefined
        );
        return true;
    }

    async readMessage(msgKey: WAMessageKey) {
        const { socket, messageKey } = this.ensureMessageKeyExists(msgKey);
        await socket.readMessages([messageKey]);
        return true;
    }

    async reactMessage(msgKey: WAMessageKey, emoji: string, customMessageId?: string) {
        const { socket, messageKey } = this.ensureMessageKeyExists(msgKey);
        await socket.sendMessage(
            messageKey.remoteJid!,
            {
                react: {
                    text: emoji,
                    key: messageKey
                }
            },
            customMessageId ? { messageId: customMessageId } : undefined
        );
        return true;
    }
}