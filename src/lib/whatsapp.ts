
import makeWASocket, { DisconnectReason, isLidUser, isPnUser, type WAMessageKey } from "baileys";
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
import { SocketAddress } from "net";

const logger = nameLogger("WhatsappService");

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
    private emitter: EventEmitter;

    constructor() {
        this.sockets = new Map();
        this.emitter = new EventEmitter();
    }

    get activeSessions(){
        const sessions = [];
        for(const [key, value] of this.sockets.entries()){
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
        let retries = 0;
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
                if (shouldReconnect && retries < 5) {
                    logger.info("Connection closed. Reconnecting...");
                    retries = retries + 1;
                    setTimeout(() => this.connect(apiKey, phoneNumber), 5000 * retries);
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

    private async messageUpdateHandler(stateInfo: ClientStateInfo, apiKey: string) {
        const { socket } = stateInfo;

        socket?.ev.on('message-receipt.update', (updates) => {
            for(const update of updates) {
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
            phoneNumber,
            status: ConnectionStatus.DISCONNECTED,
            isPairingReady: false,
            qr: null
        }

        this.registerConnectionHandler(stateInfo, apiKey, phoneNumber);
        socket.ev.on('creds.update', saveCreds);
        this.registerMessageHandler(stateInfo, apiKey);
        this.messageUpdateHandler(stateInfo, apiKey);
        this.sockets.set(apiKey, stateInfo);
        return stateInfo.status;
    }

    async disconnect(apiKey: string) {
        const socket = this.getSocket(apiKey);
        if (!socket) {
            logger.info("No socket found for API key");
            return false;
        }
        await socket.logout();
        this.sockets.delete(apiKey);
        const status = await this.clearSession(apiKey);
        return status;
    }

     async clearAll() {
        for(const [apiKey, stateInfo] of this.sockets.entries()) {
            stateInfo.socket?.end(undefined);
            this.sockets.delete(apiKey);
        }
        return true;
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

    async sendMediaMessage(apiKey: string, phoneNumber: string, mediaType: string, mediaUrl: string, caption?: string) {
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

        const messageOptions: any = {
            mimetype: mediaType, 
            caption: caption || ""
        }

        if(mediaType === "image") messageOptions.image = {url: mediaUrl};
        else if(mediaType === "video") messageOptions.video = {url: mediaUrl};
        else if(mediaType === "audio") messageOptions.audio = {url: mediaUrl};
        else messageOptions.document = {url: mediaUrl};

        const message = await socket.sendMessage(formatJid(phoneNumber), messageOptions);
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

        const type = getMimeTypeGroup(file.mimetype);
        const messageOptions: any = {
            mimetype: file.mimetype,
            fileName: file.originalname,
            caption: caption || ""
        }

        if(type === "image") messageOptions.image = file.buffer;
        else if(type === "video") messageOptions.video = file.buffer;
        else if(type === "audio") messageOptions.audio = file.buffer;
        else messageOptions.document = file.buffer;

        const message = await socket.sendMessage(formatJid(phoneNumber), messageOptions);
        return message;
    }

     async sendVoiceNote(apiKey: string, phoneNumber: string, file: Express.Multer.File) {
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

        const type = getMimeTypeGroup(file.mimetype);
        if(type !== "audio") {
            logger.info("File is not audio");
            return null;
        }
        const messageOptions: any = {
            audio: file.buffer,
            mimetype: file.mimetype,
            ptt: true
        }

        const message = await socket.sendMessage(formatJid(phoneNumber), messageOptions);
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

    async deleteMessage(apiKey: string, messageKey: WAMessageKey) {
        const socket = this.getSocket(apiKey);
        if(!socket){
            logger.info("No socket found for API key");
            return false;
        }
        if(!messageKey.remoteJid){
            logger.info("Message key remote JID is not available");
            return false;
        }
        await socket.sendMessage(messageKey.remoteJid, {
            delete: messageKey
        });
        return true;
    }

    async readMessage(apiKey: string, messageKey: WAMessageKey) {
        const socket = this.getSocket(apiKey);
        if(!socket){
            logger.info("No socket found for API key");
            return false;
        }
        if(!messageKey.remoteJid){
            logger.info("Message key remote JID is not available");
            return false;
        }
        await socket.readMessages([messageKey]);
        return true;
    }

    async reactMessage(apiKey: string, messageKey: WAMessageKey, emoji: string) {
        const socket = this.getSocket(apiKey);
        if(!socket){
            logger.info("No socket found for API key");
            return false;
        }
        if(!messageKey.remoteJid){
            logger.info("Message key remote JID is not available");
            return false;
        }
        await socket.sendMessage(messageKey.remoteJid, {
            react: {
                text: emoji,
                key: messageKey
            }
        });
        return true;
    }
}

export const whatsappService = new WhatsappService();