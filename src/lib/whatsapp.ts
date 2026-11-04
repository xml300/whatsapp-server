import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    type AnyMediaMessageContent,
    type WAMessageKey,
    type WAMessage,
    type GroupMetadata,
    type MiscMessageGenerationOptions,
    type WAPresence,
    type ChatModification,
    decryptPollVote,
    getKeyAuthor,
    jidNormalizedUser,
    sha256,
    BufferJSON
} from "baileys";
import { Boom } from "@hapi/boom";
import { EventEmitter } from "events";
import { readFile } from "fs/promises";
import pino from "pino";
import { ConnectionStatus, type ClientStateInfo, type WhatsappEvents, type SendMessageExtraOptions } from "../types/whatsapp.js";
import type { ContactCardInput } from "../types/models.js";
import { formatJid, normalizeParticipantJid, buildVCard } from "../utils/format.js";
import { nameLogger } from "./logger.js";
import { useNoSQLAuthState } from "./auth.js";
import {
    InvalidMessageKeyError,
    NotConnectedError,
    RecipientNotOnWhatsappError,
    SessionNotFoundError,
    SsrfBlockedUrlError,
    UnsupportedMediaTypeError,
    MessageNotFoundError
} from "../errors/whatsapp-errors.js";
import { clearUserKeys } from "../data/queries.js";
import { validateMediaUrl } from "../utils/url.js";
import { Session, Outbox } from "../data/db.js";
import { Events } from "../data/models/events.js";

const logger = nameLogger("WhatsappService");
const waLogger = pino(pino.destination("./server.log"));

let cachedBaileysVersion: [number, number, number] | null = null;
async function getBaileysVersion(): Promise<[number, number, number]> {
    if (cachedBaileysVersion) return cachedBaileysVersion;
    try {
        const { version } = await fetchLatestBaileysVersion();
        cachedBaileysVersion = version;
        return version;
    } catch {
        return [2, 3000, 1034195523];
    }
}

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
    private groupCache: Map<string, { data: GroupMetadata; expiresAt: number }>;
    private allGroupsCacheExpiresAt: number;

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
        this.groupCache = new Map();
        this.allGroupsCacheExpiresAt = 0;
    }

    private async resolveWAMessageById(messageId: string): Promise<any> {
        const fromEvents = await Events.findMessageById(this.userId, this.sessionId, messageId);
        if (fromEvents) {
            try {
                return JSON.parse(JSON.stringify(fromEvents), BufferJSON.reviver);
            } catch {
                return fromEvents;
            }
        }
        const outboxDoc = await Outbox.findOne({ sessionId: this.sessionId, waMessageId: messageId }).lean();
        if (outboxDoc?.payload?.sentMessage) {
            try {
                return JSON.parse(JSON.stringify(outboxDoc.payload.sentMessage), BufferJSON.reviver);
            } catch {
                return outboxDoc.payload.sentMessage;
            }
        }
        return null;
    }

    private registerConnectionHandler() {
        this.socket?.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            logger.debug(JSON.stringify(update, null, 2));
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

                if (message.message?.pollUpdateMessage) {
                    try {
                        const pollUpdate = message.message.pollUpdateMessage;
                        const creationMsgKey = pollUpdate.pollCreationMessageKey;
                        if (creationMsgKey?.id) {
                            const pollMsg = await this.resolveWAMessageById(creationMsgKey.id);
                            const secret =
                                pollMsg?.message?.messageContextInfo?.messageSecret ||
                                pollMsg?.messageContextInfo?.messageSecret;
                            if (secret && pollUpdate.vote) {
                                const pollEncKey = Buffer.isBuffer(secret)
                                    ? secret
                                    : Buffer.from(secret?.data || secret);
                                const meIdNormalised = jidNormalizedUser(
                                    this.socket?.user?.id || formatJid(this.phoneNumber)
                                );
                                const pollCreatorJid = getKeyAuthor(creationMsgKey, meIdNormalised);
                                const voterJid = getKeyAuthor(message.key, meIdNormalised);

                                const voteMsg = decryptPollVote(pollUpdate.vote, {
                                    pollEncKey,
                                    pollCreatorJid,
                                    pollMsgId: creationMsgKey.id,
                                    voterJid
                                });

                                const rawOptions =
                                    pollMsg.message?.pollCreationMessage?.options ||
                                    pollMsg.message?.pollCreationMessageV2?.options ||
                                    pollMsg.message?.pollCreationMessageV3?.options ||
                                    pollMsg.pollCreationMessage?.options ||
                                    pollMsg.pollCreationMessageV2?.options ||
                                    pollMsg.pollCreationMessageV3?.options ||
                                    [];

                                const selectedOptions: string[] = [];
                                for (const optionHash of voteMsg.selectedOptions || []) {
                                    const hashHex = Buffer.from(optionHash).toString("hex");
                                    const matched = rawOptions.find((opt: any) => {
                                        const optHashHex = sha256(
                                            Buffer.from(opt.optionName || "")
                                        ).toString("hex");
                                        return optHashHex === hashHex;
                                    });
                                    if (matched?.optionName) {
                                        selectedOptions.push(matched.optionName);
                                    }
                                }

                                const rawTs = pollUpdate.senderTimestampMs;
                                const timestampMs =
                                    typeof rawTs === "object" && rawTs !== null && "toNumber" in rawTs
                                        ? (rawTs as any).toNumber()
                                        : Number(rawTs) || Date.now();

                                if (this.userId && this.sessionId) {
                                    await Events.create({
                                        userId: this.userId,
                                        sessionId: this.sessionId,
                                        eventType: "poll.vote",
                                        payload: {
                                            pollMessageKey: creationMsgKey,
                                            voteMessageKey: message.key,
                                            voterJid,
                                            selectedOptions,
                                            timestampMs
                                        }
                                    });
                                }
                            }
                        }
                    } catch (err) {
                        logger.warn(`Failed to decrypt poll vote: ${err}`);
                    }
                }
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
            if (this.userId && this.sessionId && Array.isArray(updates)) {
                for (const update of updates) {
                    try {
                        if (update.update?.message?.editedMessage) {
                            await Events.create({
                                userId: this.userId,
                                sessionId: this.sessionId,
                                eventType: "message.edited",
                                payload: update
                            });
                        }
                        if (
                            update.update &&
                            (update.update.status !== undefined ||
                                update.update.message !== undefined ||
                                update.update.pollUpdates !== undefined)
                        ) {
                            await Events.create({
                                userId: this.userId,
                                sessionId: this.sessionId,
                                eventType: "message.update",
                                payload: update
                            });
                        }
                    } catch (err) {
                        logger.error(`Failed to store message update event: ${err}`);
                    }
                }
            }
        });
    }

    private registerGroupHandlers() {
        this.socket?.ev.on('groups.upsert', async (groups) => {
            for (const group of groups) {
                if (group.id) {
                    this.groupCache.set(group.id, {
                        data: group,
                        expiresAt: Date.now() + 5 * 60 * 1000
                    });
                }
            }
            this.allGroupsCacheExpiresAt = Date.now() + 5 * 60 * 1000;
            if (this.userId && this.sessionId) {
                try {
                    await Events.create({
                        userId: this.userId,
                        sessionId: this.sessionId,
                        eventType: "group.upsert",
                        payload: groups
                    });
                } catch (err) {
                    logger.error(`Failed to store group.upsert event: ${err}`);
                }
            }
        });

        this.socket?.ev.on('groups.update', async (updates) => {
            for (const update of updates) {
                if (update.id) {
                    const cached = this.groupCache.get(update.id);
                    if (cached) {
                        this.groupCache.set(update.id, {
                            data: { ...cached.data, ...update } as GroupMetadata,
                            expiresAt: Date.now() + 5 * 60 * 1000
                        });
                    }
                }
            }
            if (this.userId && this.sessionId) {
                try {
                    await Events.create({
                        userId: this.userId,
                        sessionId: this.sessionId,
                        eventType: "group.update",
                        payload: updates
                    });
                } catch (err) {
                    logger.error(`Failed to store group.update event: ${err}`);
                }
            }
        });

        this.socket?.ev.on('group-participants.update', async (update) => {
            if (update?.id) {
                this.groupCache.delete(update.id);
            }
            if (this.userId && this.sessionId) {
                try {
                    await Events.create({
                        userId: this.userId,
                        sessionId: this.sessionId,
                        eventType: "group.participants",
                        payload: update
                    });
                } catch (err) {
                    logger.error(`Failed to store group.participants event: ${err}`);
                }
            }
        });

        this.socket?.ev.on('group.join-request', async (update) => {
            if (this.userId && this.sessionId) {
                try {
                    await Events.create({
                        userId: this.userId,
                        sessionId: this.sessionId,
                        eventType: "group.join_request",
                        payload: update
                    });
                } catch (err) {
                    logger.error(`Failed to store group.join_request event: ${err}`);
                }
            }
        });
    }

    private registerNewsletterHandlers() {
        this.socket?.ev.on('newsletter.reaction', async (update) => {
            if (this.userId && this.sessionId) {
                try {
                    await Events.create({
                        userId: this.userId,
                        sessionId: this.sessionId,
                        eventType: "channel.reaction",
                        payload: update
                    });
                } catch (err) {
                    logger.error(`Failed to store channel.reaction event: ${err}`);
                }
            }
        });

        this.socket?.ev.on('newsletter.view', async (update) => {
            if (this.userId && this.sessionId) {
                try {
                    await Events.create({
                        userId: this.userId,
                        sessionId: this.sessionId,
                        eventType: "channel.view",
                        payload: update
                    });
                } catch (err) {
                    logger.error(`Failed to store channel.view event: ${err}`);
                }
            }
        });

        this.socket?.ev.on('newsletter-participants.update', async (update) => {
            if (this.userId && this.sessionId) {
                try {
                    await Events.create({
                        userId: this.userId,
                        sessionId: this.sessionId,
                        eventType: "channel.participants",
                        payload: update
                    });
                } catch (err) {
                    logger.error(`Failed to store channel.participants event: ${err}`);
                }
            }
        });

        this.socket?.ev.on('newsletter-settings.update', async (update) => {
            if (this.userId && this.sessionId) {
                try {
                    await Events.create({
                        userId: this.userId,
                        sessionId: this.sessionId,
                        eventType: "channel.settings",
                        payload: update
                    });
                } catch (err) {
                    logger.error(`Failed to store channel.settings event: ${err}`);
                }
            }
        });
    }

    private registerMiscHandlers() {
        this.socket?.ev.on('messages.delete', async (payload) => {
            if (this.userId && this.sessionId) {
                try {
                    await Events.create({
                        userId: this.userId,
                        sessionId: this.sessionId,
                        eventType: "message.delete",
                        payload
                    });
                } catch (err) {
                    logger.error(`Failed to store message.delete event: ${err}`);
                }
            }
        });

        this.socket?.ev.on('messages.reaction', async (reactions) => {
            if (this.userId && this.sessionId && Array.isArray(reactions)) {
                for (const item of reactions) {
                    try {
                        await Events.create({
                            userId: this.userId,
                            sessionId: this.sessionId,
                            eventType: "message.reaction",
                            payload: item
                        });
                    } catch (err) {
                        logger.error(`Failed to store message.reaction event: ${err}`);
                    }
                }
            }
        });

        this.socket?.ev.on('presence.update', async (update) => {
            if (this.userId && this.sessionId) {
                try {
                    await Events.create({
                        userId: this.userId,
                        sessionId: this.sessionId,
                        eventType: "presence.update",
                        payload: update
                    });
                } catch (err) {
                    logger.error(`Failed to store presence.update event: ${err}`);
                }
            }
        });

        this.socket?.ev.on('call', async (callEvents) => {
            if (this.userId && this.sessionId && Array.isArray(callEvents)) {
                for (const callEvent of callEvents) {
                    try {
                        await Events.create({
                            userId: this.userId,
                            sessionId: this.sessionId,
                            eventType: "call",
                            payload: callEvent
                        });
                    } catch (err) {
                        logger.error(`Failed to store call event: ${err}`);
                    }
                }
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

        const [authState, version] = await Promise.all([
            useNoSQLAuthState(this.phoneNumber),
            getBaileysVersion()
        ]);
        const { state, saveCreds } = authState;
        const socket = makeWASocket({
            version,
            auth: state,
            logger: waLogger,
            cachedGroupMetadata: async (jid) => {
                const entry = this.groupCache.get(jid);
                return (entry && entry.expiresAt > Date.now()) ? entry.data : undefined;
            },
            getMessage: async (key) => {
                if (!key?.id) return undefined;
                const msg = await this.resolveWAMessageById(key.id);
                return msg?.message || undefined;
            }
        });
        this.socket = socket;

        this.registerConnectionHandler();
        socket.ev.on('creds.update', saveCreds);
        this.registerMessageHandler();
        this.registerMessageUpdateHandler();
        this.registerGroupHandlers();
        this.registerNewsletterHandlers();
        this.registerMiscHandlers();

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
        this.socket?.ev.removeAllListeners('creds.update');
        this.socket?.ev.removeAllListeners('messages.upsert');
        this.socket?.ev.removeAllListeners('message-receipt.update');
        this.socket?.ev.removeAllListeners('messages.update');
        this.socket?.ev.removeAllListeners('groups.upsert');
        this.socket?.ev.removeAllListeners('groups.update');
        this.socket?.ev.removeAllListeners('group-participants.update');
        this.socket?.ev.removeAllListeners('group.join-request');
        this.socket?.ev.removeAllListeners('newsletter.reaction');
        this.socket?.ev.removeAllListeners('newsletter.view');
        this.socket?.ev.removeAllListeners('newsletter-participants.update');
        this.socket?.ev.removeAllListeners('newsletter-settings.update');
        this.socket?.ev.removeAllListeners('messages.delete');
        this.socket?.ev.removeAllListeners('messages.reaction');
        this.socket?.ev.removeAllListeners('presence.update');
        this.socket?.ev.removeAllListeners('call');
    }

    async disconnect() {
        const socket = this.socket;
        if (!socket) throw new SessionNotFoundError(this.sessionId);
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
        this.cleanupEventListeners();
        this.groupCache.clear();
        this.allGroupsCacheExpiresAt = 0;
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
        this.groupCache.clear();
        this.allGroupsCacheExpiresAt = 0;
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

        return socket;
    }

    private async ensureMessageKeyExists(messageKey: WAMessageKey) {
        const socket = await this.ensureSendable();
        if (!messageKey.remoteJid) throw new InvalidMessageKeyError(this.sessionId);
        return { socket, messageKey };
    }

    private async buildSendContext(
        recipientJid: string,
        extra?: SendMessageExtraOptions
    ): Promise<{ mentions?: string[]; options: MiscMessageGenerationOptions }> {
        let mentions: string[] | undefined;
        if (extra?.mentions === "all" && recipientJid.endsWith("@g.us")) {
            try {
                const meta = await this.groupMetadata(recipientJid);
                if (meta?.participants) {
                    mentions = meta.participants.map((p) => p.id);
                }
            } catch (err) {
                logger.warn(`Failed to fetch group metadata for mentions: ${err}`);
            }
        } else if (Array.isArray(extra?.mentions)) {
            mentions = extra.mentions
                .map((m) => normalizeParticipantJid(m) || formatJid(m))
                .filter(Boolean) as string[];
        }

        let quoted: any = undefined;
        if (extra?.quoted) {
            if (extra.quoted.rawMessage) {
                quoted = extra.quoted.rawMessage;
            } else if (extra.quoted.messageId) {
                const found = await this.resolveWAMessageById(extra.quoted.messageId);
                if (found) {
                    quoted = found;
                } else {
                    quoted = {
                        key: {
                            remoteJid: extra.quoted.remoteJid || recipientJid,
                            fromMe: Boolean(extra.quoted.fromMe),
                            id: extra.quoted.messageId,
                            ...(extra.quoted.participant ? { participant: extra.quoted.participant } : {})
                        },
                        message: {
                            conversation: extra.quoted.text || ""
                        }
                    };
                }
            }
        }

        const statusJidList = extra?.statusOptions?.statusJidList
            ? (extra.statusOptions.statusJidList
                  .map((j) => normalizeParticipantJid(j) || formatJid(j))
                  .filter(Boolean) as string[])
            : undefined;

        const options: MiscMessageGenerationOptions = {
            ...(extra?.customMessageId ? { messageId: extra.customMessageId } : {}),
            ...(quoted ? { quoted } : {}),
            ...(statusJidList ? { statusJidList } : {}),
            ...(extra?.statusOptions?.backgroundColor !== undefined ? { backgroundColor: extra.statusOptions.backgroundColor } : {}),
            ...(extra?.statusOptions?.font !== undefined ? { font: extra.statusOptions.font } : {})
        };

        return {
            ...(mentions ? { mentions } : {}),
            options
        };
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

    async sendMessage(
        recipient: string,
        msgText: string,
        customMessageId?: string,
        extra?: SendMessageExtraOptions
    ) {
        const socket = await this.ensureSendable();
        const targetJid = formatJid(recipient);
        const { mentions, options } = await this.buildSendContext(targetJid, extra);
        if (customMessageId) {
            options.messageId = customMessageId;
        }

        const message = await socket.sendMessage(
            targetJid,
            { text: msgText, ...(mentions?.length ? { mentions } : {}) },
            options
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

    async sendMediaMessage(
        recipient: string,
        mediaType: string,
        mediaUrl: string,
        caption?: string,
        customMessageId?: string,
        extra?: SendMessageExtraOptions
    ) {
        const socket = await this.ensureSendable();

        // SSRF guard: validate the URL before Baileys fetches it server-side
        const validated = await validateMediaUrl(mediaUrl);
        if (!validated) {
            throw new SsrfBlockedUrlError(this.sessionId);
        }

        const targetJid = formatJid(recipient);
        const { mentions, options } = await this.buildSendContext(targetJid, extra);
        if (customMessageId) {
            options.messageId = customMessageId;
        }

        const messageOptions: any = this.buildMediaOptions(mediaType, 'url', mediaUrl, caption);
        if (extra?.viewOnce) {
            messageOptions.viewOnce = true;
        }
        if (mentions?.length) {
            messageOptions.mentions = mentions;
        }

        const message = await socket.sendMessage(targetJid, messageOptions, options);
        await this.recordOutgoingMessage(message);
        return message;
    }

    async sendMediaFile(
        recipient: string,
        file: Express.Multer.File | { buffer?: Buffer; path?: string; mimetype: string; originalname: string },
        caption?: string,
        customMessageId?: string,
        extra?: SendMessageExtraOptions
    ) {
        const socket = await this.ensureSendable();
        const buffer = file.buffer ?? (file.path ? await readFile(file.path) : undefined);
        if (!buffer) {
            throw new Error("No file buffer or path provided for media file");
        }
        const type = getMimeTypeGroup(file.mimetype);
        const targetJid = formatJid(recipient);
        const { mentions, options } = await this.buildSendContext(targetJid, extra);
        if (customMessageId) {
            options.messageId = customMessageId;
        }

        const messageOptions: any = this.buildMediaOptions(
            type,
            'file',
            buffer,
            caption,
            file.originalname,
            file.mimetype
        );
        if (extra?.viewOnce) {
            messageOptions.viewOnce = true;
        }
        if (mentions?.length) {
            messageOptions.mentions = mentions;
        }

        const message = await socket.sendMessage(targetJid, messageOptions, options);
        await this.recordOutgoingMessage(message);
        return message;
    }

    async sendVoiceNote(
        recipient: string,
        file: Express.Multer.File | { buffer?: Buffer; path?: string; mimetype?: string; originalname?: string },
        customMessageId?: string,
        extra?: SendMessageExtraOptions
    ) {
        const socket = await this.ensureSendable();
        const mimetype = file.mimetype || "audio/ogg";
        const type = getMimeTypeGroup(mimetype);
        if (type !== "audio") throw new UnsupportedMediaTypeError(this.sessionId, mimetype);

        const buffer = file.buffer ?? (file.path ? await readFile(file.path) : undefined);
        if (!buffer) {
            throw new Error("No file buffer or path provided for voice note");
        }

        const targetJid = formatJid(recipient);
        const { mentions, options } = await this.buildSendContext(targetJid, extra);
        if (customMessageId) {
            options.messageId = customMessageId;
        }

        const messageOptions: any = {
            audio: buffer,
            mimetype,
            ptt: true
        };
        if (extra?.viewOnce) {
            messageOptions.viewOnce = true;
        }
        if (mentions?.length) {
            messageOptions.mentions = mentions;
        }

        const message = await socket.sendMessage(targetJid, messageOptions, options);
        await this.recordOutgoingMessage(message);
        return message;
    }

    async sendSticker(
        recipient: string,
        source: { url?: string; path?: string; buffer?: Buffer; mimetype?: string; isAnimated?: boolean },
        customMessageId?: string,
        extra?: SendMessageExtraOptions
    ) {
        const socket = await this.ensureSendable();
        let media: Buffer | { url: string };
        if (source.url) {
            const validated = await validateMediaUrl(source.url);
            if (!validated) {
                throw new SsrfBlockedUrlError(this.sessionId);
            }
            media = { url: source.url };
        } else if (source.buffer) {
            media = source.buffer;
        } else if (source.path) {
            media = await readFile(source.path);
        } else {
            throw new Error("No sticker media provided (url, buffer, or path required)");
        }

        const targetJid = formatJid(recipient);
        const { mentions, options } = await this.buildSendContext(targetJid, extra);
        if (customMessageId) {
            options.messageId = customMessageId;
        }

        const messageOptions: any = {
            sticker: media,
            ...(source.isAnimated ? { isAnimated: true } : {}),
            ...(mentions?.length ? { mentions } : {})
        };

        const message = await socket.sendMessage(targetJid, messageOptions, options);
        await this.recordOutgoingMessage(message);
        return message;
    }

    async sendPoll(
        recipient: string,
        poll: { name: string; values: string[]; selectableCount?: number; toAnnouncementGroup?: boolean },
        customMessageId?: string,
        extra?: SendMessageExtraOptions
    ) {
        const socket = await this.ensureSendable();
        const targetJid = formatJid(recipient);
        const { mentions, options } = await this.buildSendContext(targetJid, extra);
        if (customMessageId) {
            options.messageId = customMessageId;
        }

        const messageOptions: any = {
            poll: {
                name: poll.name,
                values: poll.values,
                selectableCount: poll.selectableCount ?? 1,
                toAnnouncementGroup: poll.toAnnouncementGroup
            },
            ...(mentions?.length ? { mentions } : {})
        };

        const message = await socket.sendMessage(targetJid, messageOptions, options);
        await this.recordOutgoingMessage(message);
        return message;
    }

    async sendLocation(
        recipient: string,
        location: { degreesLatitude: number; degreesLongitude: number; name?: string; address?: string; url?: string },
        customMessageId?: string,
        extra?: SendMessageExtraOptions
    ) {
        const socket = await this.ensureSendable();
        const targetJid = formatJid(recipient);
        const { mentions, options } = await this.buildSendContext(targetJid, extra);
        if (customMessageId) {
            options.messageId = customMessageId;
        }

        const messageOptions: any = {
            location: {
                degreesLatitude: location.degreesLatitude,
                degreesLongitude: location.degreesLongitude,
                name: location.name,
                address: location.address,
                url: location.url
            },
            ...(mentions?.length ? { mentions } : {})
        };

        const message = await socket.sendMessage(targetJid, messageOptions, options);
        await this.recordOutgoingMessage(message);
        return message;
    }

    async sendContacts(
        recipient: string,
        contactsPayload: { displayName?: string; contacts: ContactCardInput[] },
        customMessageId?: string,
        extra?: SendMessageExtraOptions
    ) {
        const socket = await this.ensureSendable();
        const targetJid = formatJid(recipient);
        const { mentions, options } = await this.buildSendContext(targetJid, extra);
        if (customMessageId) {
            options.messageId = customMessageId;
        }

        const contactsList = (contactsPayload.contacts || []).map((c) => ({
            displayName: c.displayName,
            vcard: buildVCard(c)
        }));

        const messageOptions: any = {
            contacts: {
                displayName: contactsPayload.displayName || contactsPayload.contacts[0]?.displayName || "Contact",
                contacts: contactsList
            },
            ...(mentions?.length ? { mentions } : {})
        };

        const message = await socket.sendMessage(targetJid, messageOptions, options);
        await this.recordOutgoingMessage(message);
        return message;
    }

    async editMessage(msgKey: WAMessageKey, newText: string, customMessageId?: string) {
        const { socket, messageKey } = await this.ensureMessageKeyExists(msgKey);
        const message = await socket.sendMessage(
            messageKey.remoteJid!,
            { text: newText, edit: messageKey },
            customMessageId ? { messageId: customMessageId } : undefined
        );
        await this.recordOutgoingMessage(message);
        return message;
    }

    async pinMessage(
        msgKey: WAMessageKey,
        type: "pin" | "unpin" | number,
        time?: 86400 | 604800 | 2592000,
        customMessageId?: string
    ) {
        const { socket, messageKey } = await this.ensureMessageKeyExists(msgKey);
        const pinType = type === "unpin" || type === 2 ? 2 : 1;
        const message = await socket.sendMessage(
            messageKey.remoteJid!,
            {
                pin: messageKey,
                type: pinType,
                ...(pinType === 1 ? { time: time || 86400 } : {})
            },
            customMessageId ? { messageId: customMessageId } : undefined
        );
        await this.recordOutgoingMessage(message);
        return message;
    }

    async starMessage(msgKey: WAMessageKey, star: boolean) {
        const { socket, messageKey } = await this.ensureMessageKeyExists(msgKey);
        await socket.star(
            messageKey.remoteJid!,
            [{ id: messageKey.id!, fromMe: Boolean(messageKey.fromMe) }],
            star
        );
        return true;
    }

    async forwardMessage(
        recipient: string,
        forwardPayload: { messageId?: string; messageKey?: WAMessageKey; rawMessage?: any; force?: boolean },
        customMessageId?: string
    ) {
        const socket = await this.ensureSendable();
        let resolvedMsg: any = forwardPayload.rawMessage;
        if (!resolvedMsg) {
            const id = forwardPayload.messageId || forwardPayload.messageKey?.id;
            if (id) {
                resolvedMsg = await this.resolveWAMessageById(id);
            }
            if (!resolvedMsg) {
                throw new MessageNotFoundError(this.sessionId, id || "unknown");
            }
        }

        const targetJid = formatJid(recipient);
        const message = await socket.sendMessage(
            targetJid,
            { forward: resolvedMsg, ...(forwardPayload.force ? { force: true } : {}) },
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
        const { socket, messageKey } = await this.ensureMessageKeyExists(msgKey);
        const message = await socket.sendMessage(
            messageKey.remoteJid!,
            { delete: messageKey },
            customMessageId ? { messageId: customMessageId } : undefined
        );
        return message;
    }

    async readMessage(msgKey: WAMessageKey) {
        const { socket, messageKey } = await this.ensureMessageKeyExists(msgKey);
        await socket.readMessages([messageKey]);
        return true;
    }

    async reactMessage(msgKey: WAMessageKey, emoji: string, customMessageId?: string) {
        const { socket, messageKey } = await this.ensureMessageKeyExists(msgKey);
        const message = await socket.sendMessage(
            messageKey.remoteJid!,
            {
                react: {
                    text: emoji,
                    key: messageKey
                }
            },
            customMessageId ? { messageId: customMessageId } : undefined
        );
        return message;
    }

    // --- Group Management Methods ---

    async groupFetchAllParticipating(forceRefresh: boolean = false): Promise<{ [jid: string]: GroupMetadata }> {
        const socket = await this.ensureSendable();
        const now = Date.now();

        // 1. If not forcing refresh and all groups cache is valid, return cached groups
        if (!forceRefresh && this.allGroupsCacheExpiresAt > now && this.groupCache.size > 0) {
            const cachedRecord: Record<string, GroupMetadata> = {};
            for (const [id, entry] of this.groupCache.entries()) {
                if (entry.expiresAt > now) {
                    cachedRecord[id] = entry.data;
                }
            }
            if (Object.keys(cachedRecord).length > 0) {
                return cachedRecord;
            }
        }

        // 2. Fetch from network
        try {
            const fetched = await socket.groupFetchAllParticipating();
            const record: Record<string, GroupMetadata> = fetched || {};

            for (const [id, meta] of Object.entries(record)) {
                this.groupCache.set(id, {
                    data: meta,
                    expiresAt: now + 5 * 60 * 1000
                });
            }

            // Merge unexpired groups from cache in case of partial response
            for (const [id, entry] of this.groupCache.entries()) {
                if (!record[id] && entry.expiresAt > now) {
                    record[id] = entry.data;
                }
            }

            this.allGroupsCacheExpiresAt = now + 5 * 60 * 1000;
            return record;
        } catch (err) {
            logger.warn(`Failed to fetch all participating groups from network: ${err}`);
            // Graceful fallback to cache if available
            if (this.groupCache.size > 0) {
                const fallbackRecord: Record<string, GroupMetadata> = {};
                for (const [id, entry] of this.groupCache.entries()) {
                    fallbackRecord[id] = entry.data;
                }
                if (Object.keys(fallbackRecord).length > 0) {
                    return fallbackRecord;
                }
            }
            throw err;
        }
    }

    async groupMetadata(groupJid: string) {
        const socket = await this.ensureSendable();
        const cached = this.groupCache.get(groupJid);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }
        const meta = await socket.groupMetadata(groupJid);
        this.groupCache.set(groupJid, { data: meta, expiresAt: Date.now() + 5 * 60 * 1000 });
        return meta;
    }

    async groupCreate(subject: string, participants: string[]) {
        const socket = await this.ensureSendable();
        const normalized = participants.map((p) => normalizeParticipantJid(p) || formatJid(p));
        const res = await socket.groupCreate(subject, normalized);
        if (res?.id) {
            this.groupCache.set(res.id, {
                data: res,
                expiresAt: Date.now() + 5 * 60 * 1000
            });
        }
        return res;
    }

    async groupLeave(groupJid: string) {
        const socket = await this.ensureSendable();
        this.groupCache.delete(groupJid);
        return await socket.groupLeave(groupJid);
    }

    async groupUpdateSubject(groupJid: string, subject: string) {
        const socket = await this.ensureSendable();
        const res = await socket.groupUpdateSubject(groupJid, subject);
        const cached = this.groupCache.get(groupJid);
        if (cached) {
            this.groupCache.set(groupJid, {
                data: { ...cached.data, subject },
                expiresAt: Date.now() + 5 * 60 * 1000
            });
        } else {
            this.groupCache.delete(groupJid);
        }
        return res;
    }

    async groupUpdateDescription(groupJid: string, description: string) {
        const socket = await this.ensureSendable();
        const res = await socket.groupUpdateDescription(groupJid, description);
        const cached = this.groupCache.get(groupJid);
        if (cached) {
            this.groupCache.set(groupJid, {
                data: { ...cached.data, desc: description },
                expiresAt: Date.now() + 5 * 60 * 1000
            });
        } else {
            this.groupCache.delete(groupJid);
        }
        return res;
    }

    async groupSettingUpdate(groupJid: string, setting: 'announcement' | 'not_announcement' | 'locked' | 'unlocked') {
        const socket = await this.ensureSendable();
        return await socket.groupSettingUpdate(groupJid, setting);
    }

    async groupMemberAddMode(groupJid: string, mode: 'admin_add' | 'all_member_add') {
        const socket = await this.ensureSendable();
        return await socket.groupMemberAddMode(groupJid, mode);
    }

    async groupJoinApprovalMode(groupJid: string, mode: 'on' | 'off') {
        const socket = await this.ensureSendable();
        return await socket.groupJoinApprovalMode(groupJid, mode);
    }

    async groupToggleEphemeral(groupJid: string, ephemeralExpiration: number) {
        const socket = await this.ensureSendable();
        return await socket.groupToggleEphemeral(groupJid, ephemeralExpiration);
    }

    async groupParticipantsUpdate(
        groupJid: string,
        participants: string[],
        action: 'add' | 'remove' | 'demote' | 'promote'
    ) {
        const socket = await this.ensureSendable();
        this.groupCache.delete(groupJid);
        const normalized = participants.map((p) => normalizeParticipantJid(p) || formatJid(p));
        return await socket.groupParticipantsUpdate(groupJid, normalized, action);
    }

    async groupInviteCode(groupJid: string) {
        const socket = await this.ensureSendable();
        return await socket.groupInviteCode(groupJid);
    }

    async groupRevokeInvite(groupJid: string) {
        const socket = await this.ensureSendable();
        return await socket.groupRevokeInvite(groupJid);
    }

    async groupAcceptInvite(code: string) {
        const socket = await this.ensureSendable();
        return await socket.groupAcceptInvite(code);
    }

    async groupGetInviteInfo(code: string) {
        const socket = await this.ensureSendable();
        return await socket.groupGetInviteInfo(code);
    }

    async groupRequestParticipantsList(groupJid: string) {
        const socket = await this.ensureSendable();
        return await socket.groupRequestParticipantsList(groupJid);
    }

    async groupRequestParticipantsUpdate(
        groupJid: string,
        participants: string[],
        action: 'approve' | 'reject'
    ) {
        const socket = await this.ensureSendable();
        const normalized = participants.map((p) => normalizeParticipantJid(p) || formatJid(p));
        return await socket.groupRequestParticipantsUpdate(groupJid, normalized, action);
    }

    async updateGroupPicture(groupJid: string, picture: { url?: string; buffer?: Buffer; path?: string }) {
        const socket = await this.ensureSendable();
        this.groupCache.delete(groupJid);
        if (picture.url) {
            const validated = await validateMediaUrl(picture.url);
            if (!validated) {
                throw new SsrfBlockedUrlError(this.sessionId);
            }
            return await socket.updateProfilePicture(groupJid, { url: picture.url });
        }
        if (picture.buffer) {
            return await socket.updateProfilePicture(groupJid, picture.buffer);
        }
        if (picture.path) {
            const buffer = await readFile(picture.path);
            return await socket.updateProfilePicture(groupJid, buffer);
        }
        throw new Error("No picture provided (url, buffer, or path required)");
    }

    async removeGroupPicture(groupJid: string) {
        const socket = await this.ensureSendable();
        this.groupCache.delete(groupJid);
        return await socket.removeProfilePicture(groupJid);
    }

    // --- Channel / Newsletter Methods ---

    async newsletterCreate(name: string, description?: string) {
        const socket = await this.ensureSendable();
        return await socket.newsletterCreate(name, description);
    }

    async newsletterMetadata(channelJid: string, type: "jid" | "invite" = "jid") {
        const socket = await this.ensureSendable();
        const queryType = type === "invite" || !channelJid.includes("@") ? "invite" : "jid";
        return await socket.newsletterMetadata(queryType, channelJid);
    }

    async newsletterUpdate(
        channelJid: string,
        updates: { name?: string; description?: string; pictureUrl?: string; picturePath?: string }
    ) {
        const socket = await this.ensureSendable();
        if (updates.pictureUrl) {
            const validated = await validateMediaUrl(updates.pictureUrl);
            if (!validated) {
                throw new SsrfBlockedUrlError(this.sessionId);
            }
            await socket.newsletterUpdatePicture(channelJid, { url: updates.pictureUrl });
        } else if (updates.picturePath) {
            const buffer = await readFile(updates.picturePath);
            await socket.newsletterUpdatePicture(channelJid, buffer);
        }

        if (updates.name !== undefined || updates.description !== undefined) {
            await socket.newsletterUpdate(channelJid, {
                ...(updates.name !== undefined ? { name: updates.name } : {}),
                ...(updates.description !== undefined ? { description: updates.description } : {})
            });
        }
        return true;
    }

    async newsletterRemovePicture(channelJid: string) {
        const socket = await this.ensureSendable();
        return await socket.newsletterRemovePicture(channelJid);
    }

    async newsletterDelete(channelJid: string) {
        const socket = await this.ensureSendable();
        return await socket.newsletterDelete(channelJid);
    }

    async newsletterFollow(channelJid: string) {
        const socket = await this.ensureSendable();
        return await socket.newsletterFollow(channelJid);
    }

    async newsletterUnfollow(channelJid: string) {
        const socket = await this.ensureSendable();
        return await socket.newsletterUnfollow(channelJid);
    }

    async newsletterMute(channelJid: string) {
        const socket = await this.ensureSendable();
        return await socket.newsletterMute(channelJid);
    }

    async newsletterUnmute(channelJid: string) {
        const socket = await this.ensureSendable();
        return await socket.newsletterUnmute(channelJid);
    }

    async newsletterSubscribers(channelJid: string) {
        const socket = await this.ensureSendable();
        return await socket.newsletterSubscribers(channelJid);
    }

    async newsletterReactMessage(channelJid: string, serverId: string, reaction?: string) {
        const socket = await this.ensureSendable();
        return await socket.newsletterReactMessage(channelJid, serverId, reaction);
    }

    async newsletterFetchMessages(channelJid: string, count: number, since: number = 0, after: number = 0) {
        const socket = await this.ensureSendable();
        return await socket.newsletterFetchMessages(channelJid, count, since, after);
    }

    async subscribeNewsletterUpdates(channelJid: string) {
        const socket = await this.ensureSendable();
        return await socket.subscribeNewsletterUpdates(channelJid);
    }

    async newsletterAdminCount(channelJid: string) {
        const socket = await this.ensureSendable();
        return await socket.newsletterAdminCount(channelJid);
    }

    async newsletterChangeOwner(channelJid: string, newOwnerJid: string) {
        const socket = await this.ensureSendable();
        const normalized = normalizeParticipantJid(newOwnerJid) || formatJid(newOwnerJid);
        return await socket.newsletterChangeOwner(channelJid, normalized);
    }

    async newsletterDemote(channelJid: string, userJid: string) {
        const socket = await this.ensureSendable();
        const normalized = normalizeParticipantJid(userJid) || formatJid(userJid);
        return await socket.newsletterDemote(channelJid, normalized);
    }

    // --- Profile / Contact / Presence / Chat Methods ---

    async updateProfileName(name: string) {
        const socket = await this.ensureSendable();
        return await socket.updateProfileName(name);
    }

    async updateProfileStatus(status: string) {
        const socket = await this.ensureSendable();
        return await socket.updateProfileStatus(status);
    }

    async updateProfilePicture(picture: { url?: string; buffer?: Buffer; path?: string }) {
        const socket = await this.ensureSendable();
        const jid = socket.user?.id || formatJid(this.phoneNumber);
        if (picture.url) {
            const validated = await validateMediaUrl(picture.url);
            if (!validated) {
                throw new SsrfBlockedUrlError(this.sessionId);
            }
            return await socket.updateProfilePicture(jid, { url: picture.url });
        }
        if (picture.buffer) {
            return await socket.updateProfilePicture(jid, picture.buffer);
        }
        if (picture.path) {
            const buffer = await readFile(picture.path);
            return await socket.updateProfilePicture(jid, buffer);
        }
        throw new Error("No picture provided (url, buffer, or path required)");
    }

    async removeProfilePicture() {
        const socket = await this.ensureSendable();
        const jid = socket.user?.id || formatJid(this.phoneNumber);
        return await socket.removeProfilePicture(jid);
    }

    async fetchPrivacySettings(force?: boolean) {
        const socket = await this.ensureSendable();
        return await socket.fetchPrivacySettings(force);
    }

    async updatePrivacySetting(setting: string, value: string) {
        const socket = await this.ensureSendable();
        switch (setting.toLowerCase()) {
            case "call":
            case "calladd":
                return await socket.updateCallPrivacy(value as any);
            case "messages":
                return await socket.updateMessagesPrivacy(value as any);
            case "last":
            case "last_seen":
                return await socket.updateLastSeenPrivacy(value as any);
            case "online":
                return await socket.updateOnlinePrivacy(value as any);
            case "profile":
            case "profile_picture":
                return await socket.updateProfilePicturePrivacy(value as any);
            case "status":
                return await socket.updateStatusPrivacy(value as any);
            case "read":
            case "read_receipts":
                return await socket.updateReadReceiptsPrivacy(value as any);
            case "groupadd":
            case "groups_add":
                return await socket.updateGroupsAddPrivacy(value as any);
            case "link_preview":
            case "disable_link_previews":
                return await socket.updateDisableLinkPreviewsPrivacy(value === "true" || value === "all");
            default:
                throw new Error(`Unsupported privacy setting: ${setting}`);
        }
    }

    async getContactProfile(contactJid: string) {
        const socket = await this.ensureSendable();
        const jid = normalizeParticipantJid(contactJid) || formatJid(contactJid);
        const [statusRes, profilePicUrl] = await Promise.allSettled([
            socket.fetchStatus(jid),
            socket.profilePictureUrl(jid, "image").catch(() => undefined)
        ]);
        const statusObj = statusRes.status === "fulfilled" ? statusRes.value?.[0] : undefined;
        const picture = profilePicUrl.status === "fulfilled" ? profilePicUrl.value : undefined;
        return {
            jid,
            status: (statusObj as any)?.status,
            setAt: (statusObj as any)?.setAt,
            pictureUrl: picture
        };
    }

    async fetchBlocklist() {
        const socket = await this.ensureSendable();
        return await socket.fetchBlocklist();
    }

    async updateBlockStatus(contactJid: string, action: "block" | "unblock") {
        const socket = await this.ensureSendable();
        const jid = normalizeParticipantJid(contactJid) || formatJid(contactJid);
        return await socket.updateBlockStatus(jid, action);
    }

    async sendPresence(type: WAPresence, recipientJid?: string) {
        const socket = await this.ensureSendable();
        const toJid = recipientJid ? (normalizeParticipantJid(recipientJid) || formatJid(recipientJid)) : undefined;
        return await socket.sendPresenceUpdate(type, toJid);
    }

    async presenceSubscribe(recipientJid: string) {
        const socket = await this.ensureSendable();
        const toJid = normalizeParticipantJid(recipientJid) || formatJid(recipientJid);
        return await socket.presenceSubscribe(toJid);
    }

    async chatModify(mod: ChatModification, chatJid: string) {
        const socket = await this.ensureSendable();
        const jid = formatJid(chatJid);
        return await socket.chatModify(mod, jid);
    }
}
