
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


export class WhatsappService {
    private emitter: EventEmitter;

    private socket: ReturnType<typeof makeWASocket> | null;
    private phoneNumber: string;
    private status: ConnectionStatus;
    private isPairingReady: boolean;
    private qr: string | null;
    private retries: number;
    private timeout?: NodeJS.Timeout;

    constructor(phoneNumber: string) {
        this.emitter = new EventEmitter();

        this.socket = null;
        this.phoneNumber = phoneNumber;
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
            }
            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                this.status = ConnectionStatus.DISCONNECTED;
                if (shouldReconnect && this.retries < 5) {
                    logger.info("Connection closed. Reconnecting...");
                    this.retries = this.retries + 1;
                    const timeout = setTimeout(() => this.connect(), 5000 * this.retries);
                    if (this.timeout) clearTimeout(this.timeout);
                    this.timeout = timeout;
                } else {
                    logger.info("Connection closed. Not reconnecting...");
                }
            } else if (connection === 'open') {
                logger.info("✅ WhatsApp is connected!");
                this.status = ConnectionStatus.CONNECTED;
                this.emit('connected', '0');
                this.retries = 0;
            }
        });
    }

    private registerMessageHandler() {
        this.socket?.ev.on('messages.upsert', async ({ type, messages }) => {
            if (type === "append") {
                return;
            }

            for (const message of messages) {
                this.emit('message', '0', message);
            }
        });
    }

    private registerMessageUpdateHandler() {
        this.socket?.ev.on('message-receipt.update', (updates) => {
            for (const update of updates) {
                this.emit('message.update', '0', update);
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

    async connect() {
        // Already connected — idempotent, no-op
        if (this.status === ConnectionStatus.CONNECTED) {
            logger.info("Already connected for this API key");
            return this.status;
        }


        if (this.socket) {
            this.cleanupEventListeners();
            if (this.timeout) clearTimeout(this.timeout);
            await this.socket.logout();
        }

        const { state, saveCreds } = await useNoSQLAuthState(this.phoneNumber);
        this.socket = makeWASocket({
            version: latestVersion,
            auth: state,
            logger: waLogger
        });

        this.registerConnectionHandler();
        this.socket.ev.on('creds.update', saveCreds);
        this.registerMessageHandler();
        this.registerMessageUpdateHandler();
        return ConnectionStatus.DISCONNECTED;

    }

    private cleanupEventListeners() {
        this.socket?.ev.removeAllListeners('connection.update');
        this.socket?.ev.removeAllListeners('messages.upsert');
        this.socket?.ev.removeAllListeners('message-receipt.update');
        this.socket?.ev.removeAllListeners('creds.update');
    }

    async disconnect() {
        const socket = this.socket;
        if (!socket) throw new SessionNotFoundError('0');
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
        if (socket) {
            this.cleanupEventListeners();
            await socket.logout().catch((err) => logger.error(err));
        }
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


    private async ensureSendable() {
        const { status, socket } = this;
        if (status !== ConnectionStatus.CONNECTED) throw new NotConnectedError('0', status);
        if (!socket) throw new NotConnectedError('0', status);

        // const onWhatsapp = await this.isOnWhatsapp(phoneNumber);
        // if (!onWhatsapp) throw new RecipientNotOnWhatsappError('0', phoneNumber);

        return socket;
    }

    private ensureMessageKeyExists(messageKey: WAMessageKey) {
        const socket = this.socket;
        if (!socket) throw new SessionNotFoundError('0');
        if (!messageKey.remoteJid) throw new InvalidMessageKeyError('0');
        return { socket, messageKey };
    }

    async sendTyping(phoneNumber: string) {
        const socket = await this.ensureSendable();
        await socket.sendPresenceUpdate('composing', formatJid(phoneNumber));
        return true;
    }

    async sendMessage(phoneNumber: string, msgText: string) {
        const socket = await this.ensureSendable();
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


    async sendMediaMessage(phoneNumber: string, mediaType: string, mediaUrl: string, caption?: string) {
        const socket = await this.ensureSendable();

        // SSRF guard: validate the URL before Baileys fetches it server-side
        const validated = await validateMediaUrl(mediaUrl);
        if (!validated) {
            throw new SsrfBlockedUrlError('0');
        }

        const messageOptions: AnyMediaMessageContent = this.buildMediaOptions(mediaType, 'url', mediaUrl, caption);
        const message = await socket.sendMessage(formatJid(phoneNumber), messageOptions);
        return message;
    }

    async sendMediaFile(phoneNumber: string, file: Express.Multer.File, caption?: string) {
        const socket = await this.ensureSendable();
        const type = getMimeTypeGroup(file.mimetype);
        const messageOptions: AnyMediaMessageContent = this.buildMediaOptions(type, 'file', file.buffer, caption, file.originalname);
        const message = await socket.sendMessage(formatJid(phoneNumber), messageOptions);
        return message;
    }

    async sendVoiceNote(phoneNumber: string, file: Express.Multer.File) {
        const socket = await this.ensureSendable();
        const type = getMimeTypeGroup(file.mimetype);
        if (type !== "audio") throw new UnsupportedMediaTypeError('0', file.mimetype);

        const messageOptions: AnyMediaMessageContent = {
            audio: file.buffer,
            mimetype: file.mimetype,
            ptt: true
        }

        const message = await socket.sendMessage(formatJid(phoneNumber), messageOptions);
        return message;
    }



    async isOnWhatsapp(phoneNumber: string) {
        const socket = this.socket;
        if (!socket) throw new SessionNotFoundError('0');

        const isWhatsappAvailable = await socket.onWhatsApp(phoneNumber);
        return isWhatsappAvailable?.[0]?.exists;
    }

    async deleteMessage(msgKey: WAMessageKey) {
        const { socket, messageKey } = this.ensureMessageKeyExists(msgKey);
        await socket.sendMessage(messageKey.remoteJid!, {
            delete: messageKey
        });
        return true;
    }

    async readMessage(msgKey: WAMessageKey) {
        const { socket, messageKey } = this.ensureMessageKeyExists(msgKey);
        await socket.readMessages([messageKey]);
        return true;
    }

    async reactMessage(msgKey: WAMessageKey, emoji: string) {
        const { socket, messageKey } = this.ensureMessageKeyExists(msgKey);
        await socket.sendMessage(messageKey.remoteJid!, {
            react: {
                text: emoji,
                key: messageKey
            }
        });
        return true;
    }
}