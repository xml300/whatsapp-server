import {
    type WAMessageKey,
    type WAPresence,
    type ChatModification
} from "baileys";
import { EventEmitter } from "events";
import { ConnectionStatus, type WhatsappEvents, type SendMessageExtraOptions } from "../types/whatsapp.js";
import type { ContactCardInput } from "../types/models.js";
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

    getStatus(sessionId: string): ConnectionStatus {
        return this.getSessionStatus(sessionId);
    }

    getUserId(sessionId: string): string | null {
        return this.sockets.get(sessionId)?.getUserId() ?? null;
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

    async clear(sessionId: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        clientSession.clear();
        this.sockets.delete(sessionId);
        return true;
    }

    async clearAll() {
        for (const clientSession of this.sockets.values()) {
            clientSession.clear();
        }
        this.sockets.clear();
        return true;
    }

    // --- Message Sending / Mutation Methods ---

    async sendTyping(sessionId: string, phoneNumber: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.sendTyping(phoneNumber);
    }

    async sendTypingPaused(sessionId: string, phoneNumber: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.sendTypingPaused(phoneNumber);
    }

    async sendMessage(
        sessionId: string,
        recipient: string,
        msgText: string,
        customMessageId?: string,
        extra?: SendMessageExtraOptions
    ) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.sendMessage(recipient, msgText, customMessageId, extra);
    }

    async sendMediaMessage(
        sessionId: string,
        recipient: string,
        mediaType: string,
        mediaUrl: string,
        caption?: string,
        customMessageId?: string,
        extra?: SendMessageExtraOptions
    ) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.sendMediaMessage(recipient, mediaType, mediaUrl, caption, customMessageId, extra);
    }

    async sendMediaFile(
        sessionId: string,
        recipient: string,
        file: Express.Multer.File | { buffer?: Buffer; path?: string; mimetype: string; originalname: string },
        caption?: string,
        customMessageId?: string,
        extra?: SendMessageExtraOptions
    ) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.sendMediaFile(recipient, file, caption, customMessageId, extra);
    }

    async sendVoiceNote(
        sessionId: string,
        recipient: string,
        file: Express.Multer.File | { buffer?: Buffer; path?: string; mimetype?: string; originalname?: string },
        customMessageId?: string,
        extra?: SendMessageExtraOptions
    ) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.sendVoiceNote(recipient, file, customMessageId, extra);
    }

    async sendSticker(
        sessionId: string,
        recipient: string,
        source: { url?: string; path?: string; buffer?: Buffer; mimetype?: string; isAnimated?: boolean },
        customMessageId?: string,
        extra?: SendMessageExtraOptions
    ) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.sendSticker(recipient, source, customMessageId, extra);
    }

    async sendPoll(
        sessionId: string,
        recipient: string,
        poll: { name: string; values: string[]; selectableCount?: number; toAnnouncementGroup?: boolean },
        customMessageId?: string,
        extra?: SendMessageExtraOptions
    ) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.sendPoll(recipient, poll, customMessageId, extra);
    }

    async sendLocation(
        sessionId: string,
        recipient: string,
        location: { degreesLatitude: number; degreesLongitude: number; name?: string; address?: string; url?: string },
        customMessageId?: string,
        extra?: SendMessageExtraOptions
    ) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.sendLocation(recipient, location, customMessageId, extra);
    }

    async sendContacts(
        sessionId: string,
        recipient: string,
        contactsPayload: { displayName?: string; contacts: ContactCardInput[] },
        customMessageId?: string,
        extra?: SendMessageExtraOptions
    ) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.sendContacts(recipient, contactsPayload, customMessageId, extra);
    }

    async editMessage(sessionId: string, msgKey: WAMessageKey, newText: string, customMessageId?: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.editMessage(msgKey, newText, customMessageId);
    }

    async pinMessage(
        sessionId: string,
        msgKey: WAMessageKey,
        type: "pin" | "unpin" | number,
        time?: 86400 | 604800 | 2592000,
        customMessageId?: string
    ) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.pinMessage(msgKey, type, time, customMessageId);
    }

    async starMessage(sessionId: string, msgKey: WAMessageKey, star: boolean) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.starMessage(msgKey, star);
    }

    async forwardMessage(
        sessionId: string,
        recipient: string,
        forwardPayload: { messageId?: string; messageKey?: WAMessageKey; rawMessage?: any; force?: boolean },
        customMessageId?: string
    ) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.forwardMessage(recipient, forwardPayload, customMessageId);
    }

    async isOnWhatsapp(sessionId: string, phoneNumber: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.isOnWhatsapp(phoneNumber);
    }

    async deleteMessage(sessionId: string, msgKey: WAMessageKey, customMessageId?: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.deleteMessage(msgKey, customMessageId);
    }

    async readMessage(sessionId: string, msgKey: WAMessageKey) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.readMessage(msgKey);
    }

    async reactMessage(sessionId: string, msgKey: WAMessageKey, emoji: string, customMessageId?: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.reactMessage(msgKey, emoji, customMessageId);
    }

    // --- Group Management Methods ---

    async groupFetchAllParticipating(sessionId: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.groupFetchAllParticipating();
    }

    async groupMetadata(sessionId: string, groupJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.groupMetadata(groupJid);
    }

    async groupCreate(sessionId: string, subject: string, participants: string[]) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.groupCreate(subject, participants);
    }

    async groupLeave(sessionId: string, groupJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.groupLeave(groupJid);
    }

    async groupUpdateSubject(sessionId: string, groupJid: string, subject: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.groupUpdateSubject(groupJid, subject);
    }

    async groupUpdateDescription(sessionId: string, groupJid: string, description: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.groupUpdateDescription(groupJid, description);
    }

    async groupSettingUpdate(
        sessionId: string,
        groupJid: string,
        setting: 'announcement' | 'not_announcement' | 'locked' | 'unlocked'
    ) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.groupSettingUpdate(groupJid, setting);
    }

    async groupMemberAddMode(sessionId: string, groupJid: string, mode: 'admin_add' | 'all_member_add') {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.groupMemberAddMode(groupJid, mode);
    }

    async groupJoinApprovalMode(sessionId: string, groupJid: string, mode: 'on' | 'off') {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.groupJoinApprovalMode(groupJid, mode);
    }

    async groupToggleEphemeral(sessionId: string, groupJid: string, ephemeralExpiration: number) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.groupToggleEphemeral(groupJid, ephemeralExpiration);
    }

    async groupParticipantsUpdate(
        sessionId: string,
        groupJid: string,
        participants: string[],
        action: 'add' | 'remove' | 'demote' | 'promote'
    ) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.groupParticipantsUpdate(groupJid, participants, action);
    }

    async groupInviteCode(sessionId: string, groupJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.groupInviteCode(groupJid);
    }

    async groupRevokeInvite(sessionId: string, groupJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.groupRevokeInvite(groupJid);
    }

    async groupAcceptInvite(sessionId: string, code: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.groupAcceptInvite(code);
    }

    async groupGetInviteInfo(sessionId: string, code: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.groupGetInviteInfo(code);
    }

    async groupRequestParticipantsList(sessionId: string, groupJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.groupRequestParticipantsList(groupJid);
    }

    async groupRequestParticipantsUpdate(
        sessionId: string,
        groupJid: string,
        participants: string[],
        action: 'approve' | 'reject'
    ) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.groupRequestParticipantsUpdate(groupJid, participants, action);
    }

    async updateGroupPicture(
        sessionId: string,
        groupJid: string,
        picture: { url?: string; buffer?: Buffer; path?: string }
    ) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.updateGroupPicture(groupJid, picture);
    }

    async removeGroupPicture(sessionId: string, groupJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.removeGroupPicture(groupJid);
    }

    // --- Channel / Newsletter Methods ---

    async newsletterCreate(sessionId: string, name: string, description?: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.newsletterCreate(name, description);
    }

    async newsletterMetadata(sessionId: string, channelJid: string, type: "jid" | "invite" = "jid") {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.newsletterMetadata(channelJid, type);
    }

    async newsletterUpdate(
        sessionId: string,
        channelJid: string,
        updates: { name?: string; description?: string; pictureUrl?: string; picturePath?: string }
    ) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.newsletterUpdate(channelJid, updates);
    }

    async newsletterRemovePicture(sessionId: string, channelJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.newsletterRemovePicture(channelJid);
    }

    async newsletterDelete(sessionId: string, channelJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.newsletterDelete(channelJid);
    }

    async newsletterFollow(sessionId: string, channelJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.newsletterFollow(channelJid);
    }

    async newsletterUnfollow(sessionId: string, channelJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.newsletterUnfollow(channelJid);
    }

    async newsletterMute(sessionId: string, channelJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.newsletterMute(channelJid);
    }

    async newsletterUnmute(sessionId: string, channelJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.newsletterUnmute(channelJid);
    }

    async newsletterSubscribers(sessionId: string, channelJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.newsletterSubscribers(channelJid);
    }

    async newsletterReactMessage(sessionId: string, channelJid: string, serverId: string, reaction?: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.newsletterReactMessage(channelJid, serverId, reaction);
    }

    async newsletterFetchMessages(sessionId: string, channelJid: string, count: number, since: number = 0, after: number = 0) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.newsletterFetchMessages(channelJid, count, since, after);
    }

    async subscribeNewsletterUpdates(sessionId: string, channelJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.subscribeNewsletterUpdates(channelJid);
    }

    async newsletterAdminCount(sessionId: string, channelJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.newsletterAdminCount(channelJid);
    }

    async newsletterChangeOwner(sessionId: string, channelJid: string, newOwnerJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.newsletterChangeOwner(channelJid, newOwnerJid);
    }

    async newsletterDemote(sessionId: string, channelJid: string, userJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.newsletterDemote(channelJid, userJid);
    }

    // --- Profile / Contact / Presence / Chat Methods ---

    async updateProfileName(sessionId: string, name: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.updateProfileName(name);
    }

    async updateProfileStatus(sessionId: string, status: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.updateProfileStatus(status);
    }

    async updateProfilePicture(
        sessionId: string,
        picture: { url?: string; buffer?: Buffer; path?: string }
    ) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.updateProfilePicture(picture);
    }

    async removeProfilePicture(sessionId: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.removeProfilePicture();
    }

    async fetchPrivacySettings(sessionId: string, force?: boolean) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.fetchPrivacySettings(force);
    }

    async updatePrivacySetting(sessionId: string, setting: string, value: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.updatePrivacySetting(setting, value);
    }

    async getContactProfile(sessionId: string, contactJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.getContactProfile(contactJid);
    }

    async fetchBlocklist(sessionId: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.fetchBlocklist();
    }

    async updateBlockStatus(sessionId: string, contactJid: string, action: "block" | "unblock") {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.updateBlockStatus(contactJid, action);
    }

    async sendPresence(sessionId: string, type: WAPresence, recipientJid?: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.sendPresence(type, recipientJid);
    }

    async presenceSubscribe(sessionId: string, recipientJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.presenceSubscribe(recipientJid);
    }

    async chatModify(sessionId: string, mod: ChatModification, chatJid: string) {
        const clientSession = this.sockets.get(sessionId);
        if (!clientSession) throw new SessionNotFoundError(sessionId);
        return await clientSession.chatModify(mod, chatJid);
    }
}

export const whatsappService = new WhatsappManager();
