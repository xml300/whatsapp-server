
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "baileys";
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import { EventEmitter } from "events";
import pino from "pino";
import { ConnectionStatus } from "../utils/types";
import type { WhatsappEvents } from "../utils/types";
import { formatJid } from "../utils/helpers";

class WhatsappService {
    private sock: ReturnType<typeof makeWASocket> | null;
    private emitter: EventEmitter;
    private status: ConnectionStatus;
    private qr: string | null;

    constructor() {
        this.sock = null;
        this.emitter = new EventEmitter();
        this.status = ConnectionStatus.DISCONNECTED;
        this.qr = null;
    }

    on<K extends keyof WhatsappEvents>(event: K, listener: WhatsappEvents[K]) {
        this.emitter.on(event, listener);
    }

    isConnected() {
        return this.status === ConnectionStatus.CONNECTED;
    }

    getQrCode(){
        return this.qr;
    }

    async connect() {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_folder');

        this.sock = makeWASocket({
            auth: state,
            logger: pino(
                pino.destination('./server.log')
            ),
            browser: ["Ubuntu", "Chrome", "20.0.04"]
        });

        this.registerConnectionHandler();
        this.sock.ev.on('creds.update', saveCreds);
        this.registerMessageHandler();
    }

    async disconnect() {
        this.sock?.end(undefined);
        this.sock = null;
        this.status = ConnectionStatus.DISCONNECTED;
    }

    private registerConnectionHandler() {
        this.sock?.ev.on('connection.update', async (update) => {
            console.log(update);
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                console.log("QR Created.")
                await QRCode.toFile('qr.png', qr);
                this.qr = await QRCode.toDataURL(qr);
                this.emitter.emit('qr', this.qr);
            }
            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                this.status = ConnectionStatus.DISCONNECTED;
                if (shouldReconnect) {
                    console.log("Connection closed. Reconnecting...");
                    setTimeout(() => this.connect(), 5000);
                } else {
                    console.log("Connection closed. Not reconnecting...");
                }
            } else if (connection === 'open') {
                console.log("✅ WhatsApp is connected!");
                this.status = ConnectionStatus.CONNECTED;
                this.emitter.emit('connected');
            }
        });
    }

    private registerMessageHandler() {
        this.sock?.ev.on('messages.upsert', async m => {
            const message = m.messages[0];

            const text = message.message?.conversation;
            const sender = message.key.remoteJid;
            console.log('New message received:', sender, text);
        });
    }

    async sendTyping(phoneNumber: string) {
        if (this.status !== ConnectionStatus.CONNECTED) {
            throw new Error("WhatsApp is not connected");
        }
        await this.sock?.sendPresenceUpdate('composing', formatJid(phoneNumber));
        return true;
    }

    async sendMessage(phoneNumber: string, msgText: string) {
        if (this.status !== ConnectionStatus.CONNECTED) {
            throw new Error("WhatsApp is not connected");
        }
        const message = await this.sock?.sendMessage(formatJid(phoneNumber), {
            text: msgText
        });
        return message;
    }

    async sendMediaFile(phoneNumber: string, file: File, caption?: string) {
        if (this.status !== ConnectionStatus.CONNECTED) {
            throw new Error("WhatsApp is not connected");
        }
        const message = await this.sock?.sendMessage(formatJid(phoneNumber), {
            document: Buffer.from(await file.arrayBuffer()),
            mimetype: file.type,
            fileName: file.name,
            caption: caption
        })
        return message;
    }
}

export const whatsappService = new WhatsappService();