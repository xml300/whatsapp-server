
import { type WAMessageKey } from "baileys";
import { EventEmitter } from "events";
import { type WhatsappEvents } from "../types/whatsapp.js";
import { nameLogger } from "./logger.js";
import { SessionNotFoundError } from "../errors/whatsapp-errors.js";
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

    private async clearSession(sessionId: string) {
        const session = await Session.findOne({ id: sessionId });
        if (!session) {
            logger.info("No session record found");
            return false;
        }
        const status = await clearUserKeys(session.userId);
        return status;
    }

    private getClientSession(sessionId: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) {
            return null;
        }
        return clientSession;
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
            return this.sockets.get(sessionId)?.isConnected();
        }
        const existing = this.sockets.get(sessionId);
        let promiseResolve = () => { };
        const promise = new Promise<void>((resolve) => promiseResolve = resolve);
        this.isConnecting.set(sessionId, promise);
        try {
            // Already connected — idempotent, no-op
            if (existing?.isConnected()) {
                logger.info("Already connected for this API key");
                return existing.isConnected();
            }


            if (existing) {
                return await existing.connect();
            }

            const session = await Session.findOne({ id: sessionId });
            if (!session) {
                return null;
            }

            const clientSession = new WhatsappService(session.phoneNumber);
            const status = await clientSession.connect();
            this.sockets.set(sessionId, clientSession);
            return status;
        } finally {
            promiseResolve();
            this.isConnecting.delete(sessionId);
        }
    }

    async disconnect(sessionId: string) {
        try {
            const clientSession = this.sockets.get(sessionId);
            if (!clientSession) throw new SessionNotFoundError(sessionId);

            const sessionStatus = await clientSession.disconnect();
            const keysStatus = await this.clearSession(sessionId);
            return sessionStatus && keysStatus;
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

    async sendMessage(sessionId: string, phoneNumber: string, msgText: string) {
        const clientSession = this.sockets.get(sessionId);
        if(!clientSession) throw new SessionNotFoundError(sessionId);

        return await clientSession.sendMessage(phoneNumber, msgText);
    }

    async sendMediaMessage(sessionId: string, phoneNumber: string, mediaType: string, mediaUrl: string, caption?: string) {
        const clientSession = this.sockets.get(sessionId);
        if(!clientSession) throw new SessionNotFoundError(sessionId);

        const message = await clientSession.sendMediaMessage(phoneNumber, mediaType, mediaUrl, caption);
        return message;
    }

    async sendMediaFile(sessionId: string, phoneNumber: string, file: Express.Multer.File, caption?: string) {
       const clientSession = this.sockets.get(sessionId);
        if(!clientSession) throw new SessionNotFoundError(sessionId);
        
        const message = await clientSession.sendMediaFile(phoneNumber, file, caption);
        return message;
    }

    async sendVoiceNote(sessionId: string, phoneNumber: string, file: Express.Multer.File) {
       const clientSession = this.sockets.get(sessionId);
       if(!clientSession) throw new SessionNotFoundError(sessionId);
        
        const message = await clientSession.sendVoiceNote(phoneNumber, file);
        return message;
    }



    async isOnWhatsapp(sessionId: string, phoneNumber: string) {
        const clientSession = this.sockets.get(sessionId);
        if(!clientSession) throw new SessionNotFoundError(sessionId);

        const isWhatsappAvailable = await clientSession.isOnWhatsapp(phoneNumber);
        return isWhatsappAvailable;
    }

    async deleteMessage(sessionId: string, msgKey: WAMessageKey) {
        const clientSession = this.sockets.get(sessionId);
        if(!clientSession) throw new SessionNotFoundError(sessionId);

        const message = await clientSession.deleteMessage(msgKey);
        return message;
    }

    async readMessage(sessionId: string, msgKey: WAMessageKey) {
        const clientSession = this.sockets.get(sessionId);
        if(!clientSession) throw new SessionNotFoundError(sessionId);

        const message = await clientSession.readMessage(msgKey);
        return message;
    }

    async reactMessage(sessionId: string, msgKey: WAMessageKey, emoji: string) {
        const clientSession = this.sockets.get(sessionId);
        if(!clientSession) throw new SessionNotFoundError(sessionId);

        const message = await clientSession.reactMessage(msgKey, emoji);
        return message;
    }
}

export const whatsappService = new WhatsappManager();