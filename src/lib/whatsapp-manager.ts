
import { type WAMessageKey } from "baileys";
import { EventEmitter } from "events";
import { ConnectionStatus, type WhatsappEvents } from "../types/whatsapp.js";
import { nameLogger } from "./logger.js";
import { NotConnectedError, SessionNotFoundError } from "../errors/whatsapp-errors.js";
import { clearUserKeys } from "../data/queries.js";
import { Session } from "../data/db.js";
import { WhatsappService } from "./whatsapp.js";

const logger = nameLogger("WhatsappManager");

class WhatsappManager {
    private sockets: Map<string, WhatsappService>;
    private isConnecting: Map<string, Promise<void>>;
    private emitter: EventEmitter;

    constructor() {
        this.sockets = new Map();
        this.isConnecting = new Map();
        this.emitter = new EventEmitter();
    }

    get activeSessions() {
        const sessions = [];
        for (const key of this.sockets.keys()) {
            sessions.push(key);
        }
        return sessions;
    }

    getActiveSessions() {
        return this.activeSessions;
    }

    private async clearSession(sessionId: string) {
        const session = await Session.findOne({ id: sessionId });
        if (!session) {
            logger.info("No session record found");
            return false;
        }
        const status = await clearUserKeys(session.phoneNumber);
        return status;
    }

    private getClientSession(sessionId: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) {
            return null;
        }
        return clientSession;
    }

    private forwardEvents(clientSession: WhatsappService) {
        clientSession.on('connected', (id) => this.emit('connected', id));
        clientSession.on('disconnected', (id, reason) => this.emit('disconnected', id, reason));
        clientSession.on('qr', (id, qr) => this.emit('qr', id, qr));
        clientSession.on('message', (id, data) => this.emit('message', id, data));
        clientSession.on('message.update', (id, update) => this.emit('message.update', id, update));
        clientSession.on('messages.update', (id, updates) => this.emit('messages.update', id, updates));
        clientSession.on('logged.out', (id, reason) => this.emit('logged.out', id, reason));
    }

    getSessionStatus(sessionId: string): ConnectionStatus {
        return this.sockets.get(sessionId)?.getStatus() ?? ConnectionStatus.DISCONNECTED;
    }

    async isEligibleForOutbox(sessionId: string, userId: string) {
        const session = await Session.findOne({ id: sessionId, userId });
        if (!session) {
            throw new SessionNotFoundError(sessionId);
        }
        if (session.desiredState !== "CONNECTED" && !this.sockets.has(sessionId)) {
            throw new NotConnectedError(sessionId, ConnectionStatus.DISCONNECTED);
        }
        return session;
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

    isConnected(sessionId: string) {
        const clientSession = this.getClientSession(sessionId);
        if (!clientSession) {
            return false;
        }
        return clientSession.isConnected();
    }

    isConnectionReady(sessionId: string) {
        const clientSession = this.getClientSession(sessionId);
        if (!clientSession) {
            return false;
        }
        return clientSession.isConnectionReady();
    }

    getQrCode(sessionId: string) {
        const clientSession = this.getClientSession(sessionId);
        if (!clientSession) {
            return null;
        }
        return clientSession.getQrCode();
    }

    async getPairingCode(sessionId: string) {
        const clientSession = this.getClientSession(sessionId);
        if (!clientSession) {
            return null;
        }
        return await clientSession.getPairingCode(sessionId);
    }

    async connect(sessionId: string) {
        const inflightGuard = this.isConnecting.get(sessionId);
        if (inflightGuard) {
            await inflightGuard;
            return this.sockets.get(sessionId)?.isConnected()
                ? ConnectionStatus.CONNECTED
                : ConnectionStatus.DISCONNECTED;
        }
        const existing = this.sockets.get(sessionId);
        let promiseResolve = () => { };
        const promise = new Promise<void>((resolve) => promiseResolve = resolve);
        this.isConnecting.set(sessionId, promise);
        try {
            await Session.updateOne({ id: sessionId }, { $set: { desiredState: "CONNECTED", updatedAt: new Date() } });

            // Already connected — idempotent, no-op
            if (existing?.isConnected()) {
                logger.info("Already connected for this session");
                return ConnectionStatus.CONNECTED;
            }

            if (existing) {
                return await existing.connect();
            }

            const session = await Session.findOne({ id: sessionId });
            if (!session) {
                return null;
            }

            const clientSession = new WhatsappService(session.phoneNumber, sessionId, session.userId);
            this.forwardEvents(clientSession);
            this.sockets.set(sessionId, clientSession);
            return await clientSession.connect();
        } finally {
            promiseResolve();
            this.isConnecting.delete(sessionId);
        }
    }

    async disconnect(sessionId: string) {
        try {
            await Session.updateOne({ id: sessionId }, { $set: { desiredState: "DISCONNECTED", updatedAt: new Date() } });
            const clientSession = this.sockets.get(sessionId);
            if (!clientSession) throw new SessionNotFoundError(sessionId);

            const sessionStatus = await clientSession.disconnect();
            this.emit('logged.out', sessionId, 'Session manually disconnected');
            return sessionStatus;
        } finally {
            this.sockets.delete(sessionId);
        }
    }

    async clearAll() {
        for (const clientSession of this.sockets.values()) {
            clientSession.clear();
        }
        this.sockets.clear();
        return true;
    }

    async sendTyping(sessionId: string, phoneNumber: string) {
        const clientSession = this.sockets.get(sessionId);
        if(!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.sendTyping(phoneNumber);
    }

    async sendTypingPaused(sessionId: string, phoneNumber: string) {
        const clientSession = this.sockets.get(sessionId);
        if(!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.sendTypingPaused(phoneNumber);
    }

    async sendMessage(sessionId: string, phoneNumber: string, msgText: string, customMessageId?: string) {
        const clientSession = this.sockets.get(sessionId);
        if(!clientSession) throw new SessionNotFoundError(sessionId);

        return await clientSession.sendMessage(phoneNumber, msgText, customMessageId);
    }

    async sendMediaMessage(sessionId: string, phoneNumber: string, mediaType: string, mediaUrl: string, caption?: string, customMessageId?: string) {
        const clientSession = this.sockets.get(sessionId);
        if(!clientSession) throw new SessionNotFoundError(sessionId);

        const message = await clientSession.sendMediaMessage(phoneNumber, mediaType, mediaUrl, caption, customMessageId);
        return message;
    }

    async sendMediaFile(
        sessionId: string,
        phoneNumber: string,
        file: Express.Multer.File | { buffer?: Buffer; path?: string; mimetype: string; originalname: string },
        caption?: string,
        customMessageId?: string
    ) {
        const clientSession = this.sockets.get(sessionId);
        if(!clientSession) throw new SessionNotFoundError(sessionId);
        
        const message = await clientSession.sendMediaFile(phoneNumber, file, caption, customMessageId);
        return message;
    }

    async sendVoiceNote(
        sessionId: string,
        phoneNumber: string,
        file: Express.Multer.File | { buffer?: Buffer; path?: string; mimetype: string; originalname?: string },
        customMessageId?: string
    ) {
        const clientSession = this.sockets.get(sessionId);
        if(!clientSession) throw new SessionNotFoundError(sessionId);
        
        const message = await clientSession.sendVoiceNote(phoneNumber, file, customMessageId);
        return message;
    }

    async isOnWhatsapp(sessionId: string, phoneNumber: string) {
        const clientSession = this.sockets.get(sessionId);
        if(!clientSession) throw new SessionNotFoundError(sessionId);

        const isWhatsappAvailable = await clientSession.isOnWhatsapp(phoneNumber);
        return isWhatsappAvailable;
    }

    async deleteMessage(sessionId: string, msgKey: WAMessageKey, customMessageId?: string) {
        const clientSession = this.sockets.get(sessionId);
        if(!clientSession) throw new SessionNotFoundError(sessionId);

        const message = await clientSession.deleteMessage(msgKey, customMessageId);
        return message;
    }

    async readMessage(sessionId: string, msgKey: WAMessageKey) {
        const clientSession = this.sockets.get(sessionId);
        if(!clientSession) throw new SessionNotFoundError(sessionId);

        const message = await clientSession.readMessage(msgKey);
        return message;
    }

    async reactMessage(sessionId: string, msgKey: WAMessageKey, emoji: string, customMessageId?: string) {
        const clientSession = this.sockets.get(sessionId);
        if(!clientSession) throw new SessionNotFoundError(sessionId);

        const message = await clientSession.reactMessage(msgKey, emoji, customMessageId);
        return message;
    }
}

export const whatsappService = new WhatsappManager();