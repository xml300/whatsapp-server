import { randomUUID } from "crypto";
import { unlink } from "fs/promises";
import { generateMessageIDV2, BufferJSON } from "baileys";
import { Outbox, Session } from "../data/db.js";
import { Events } from "../data/models/events.js";
import { nameLogger } from "./logger.js";
import { formatJid } from "../utils/format.js";
import { whatsappService } from "./whatsapp-manager.js";
import {
    InvalidMessageKeyError,
    NotConnectedError,
    RecipientNotOnWhatsappError,
    SessionNotFoundError,
    SsrfBlockedUrlError,
    UnsupportedMediaTypeError,
    MessageNotFoundError,
    InvalidRecipientError,
    WhatsappServiceError
} from "../errors/whatsapp-errors.js";
import { ConnectionStatus, type SendMessageExtraOptions } from "../types/whatsapp.js";
import type { IOutbox, OutboxActionType, OutboxStatus } from "../types/models.js";

const logger = nameLogger("OutboxEngine");

const RATE_LIMIT_PER_MIN = parseInt(process.env.OUTBOX_RATE_LIMIT_PER_MIN || "20", 10);
const ACK_TIMEOUT_MS = parseInt(process.env.OUTBOX_ACK_TIMEOUT_MS || "20000", 10);
const SWEEP_INTERVAL_MS = parseInt(process.env.OUTBOX_SWEEP_INTERVAL_MS || "5000", 10);
const DEFAULT_MAX_ATTEMPTS = parseInt(process.env.OUTBOX_MAX_ATTEMPTS || "6", 10);

export class SessionRateLimiter {
    private history = new Map<string, number[]>();
    private queues = new Map<string, Promise<void>>();

    async acquireToken(sessionId: string): Promise<void> {
        const currentQueue = this.queues.get(sessionId) || Promise.resolve();

        const nextPromise = currentQueue.then(async () => {
            while (true) {
                const now = Date.now();
                let timestamps = this.history.get(sessionId);
                if (!timestamps) {
                    timestamps = [];
                    this.history.set(sessionId, timestamps);
                }

                while (timestamps.length > 0 && timestamps[0]! <= now - 60000) {
                    timestamps.shift();
                }

                if (timestamps.length < RATE_LIMIT_PER_MIN) {
                    timestamps.push(Date.now());
                    return;
                }

                const oldest = timestamps[0]!;
                const waitMs = Math.max(50, (oldest + 60000) - now + 10);
                await new Promise((resolve) => setTimeout(resolve, waitMs));
            }
        });

        this.queues.set(sessionId, nextPromise.catch(() => {}));
        return nextPromise;
    }

    clear(sessionId?: string) {
        if (sessionId) {
            this.history.delete(sessionId);
            this.queues.delete(sessionId);
        } else {
            this.history.clear();
            this.queues.clear();
        }
    }
}

export interface EnqueueOptions {
    userId: string;
    sessionId: string;
    idempotencyKey?: string;
    recipientJid: string;
    actionType: OutboxActionType;
    payload: IOutbox["payload"];
    simulateTyping?: boolean;
}

export interface EnqueueResult {
    doc: IOutbox;
    deduplicated: boolean;
}

export class OutboxEngine {
    private rateLimiter = new SessionRateLimiter();
    private runningActors = new Set<string>();
    private actorPending = new Map<string, boolean>();
    private earlyAckSet = new Set<string>();
    private ackTimeouts = new Map<string, NodeJS.Timeout>();
    private sweepInterval: NodeJS.Timeout | null = null;
    private isStarted = false;

    async start(): Promise<void> {
        if (this.isStarted) return;
        this.isStarted = true;

        whatsappService.on('connected', (sessionId) => {
            this.kickSession(sessionId).catch((err) => logger.error(`kickSession error: ${err}`));
        });

        whatsappService.on('disconnected', (sessionId, reason) => {
            this.handleDisconnect(sessionId, reason).catch((err) => logger.error(`handleDisconnect error: ${err}`));
        });

        whatsappService.on('logged.out', (sessionId, reason) => {
            this.failAllForSession(sessionId, reason).catch((err) => logger.error(`failAllForSession error: ${err}`));
        });

        whatsappService.on('messages.update', (sessionId, updates) => {
            this.handleMessagesUpdate(sessionId, updates);
        });

        whatsappService.on('message.update', (sessionId, update) => {
            this.handleMessageReceiptUpdate(sessionId, update);
        });

        try {
            await Outbox.updateMany(
                { status: "PROCESSING" },
                {
                    $set: {
                        status: "QUEUED",
                        nextAttemptAt: new Date(),
                        lastError: "Process restarted during processing; re-queued",
                        updatedAt: new Date()
                    }
                }
            );
        } catch (err) {
            logger.error(`Failed to recover orphaned processing jobs: ${err}`);
        }

        this.sweepInterval = setInterval(() => {
            this.runSweep().catch((err) => logger.error(`Outbox sweep error: ${err}`));
        }, SWEEP_INTERVAL_MS);

        logger.info("OutboxEngine started successfully");
    }

    stop(): void {
        if (this.sweepInterval) {
            clearInterval(this.sweepInterval);
            this.sweepInterval = null;
        }

        for (const timer of this.ackTimeouts.values()) {
            clearTimeout(timer);
        }
        this.ackTimeouts.clear();
        this.isStarted = false;
        logger.info("OutboxEngine stopped");
    }

    async enqueue(options: EnqueueOptions): Promise<EnqueueResult> {
        const { userId, sessionId, recipientJid, actionType, payload, simulateTyping } = options;
        const idempotencyKey = options.idempotencyKey?.trim() || randomUUID();
        const formattedJid = formatJid(recipientJid);

        const existing = await Outbox.findOne({ sessionId, idempotencyKey });
        if (existing) {
            if (payload.filePath && existing.payload?.filePath && payload.filePath !== existing.payload.filePath) {
                unlink(payload.filePath).catch(() => {});
            }
            return { doc: existing, deduplicated: true };
        }

        const waMessageId = generateMessageIDV2();

        try {
            const doc = await Outbox.create({
                userId,
                sessionId,
                idempotencyKey,
                waMessageId,
                recipientJid: formattedJid,
                actionType,
                payload,
                simulateTyping: Boolean(simulateTyping),
                status: "QUEUED",
                attempts: 0,
                maxAttempts: DEFAULT_MAX_ATTEMPTS,
                nextAttemptAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date()
            });

            setImmediate(() => this.notify(sessionId, formattedJid));
            return { doc, deduplicated: false };
        } catch (err: any) {
            if (err.code === 11000) {
                const dupDoc = await Outbox.findOne({ sessionId, idempotencyKey });
                if (dupDoc) {
                    if (payload.filePath && dupDoc.payload?.filePath && payload.filePath !== dupDoc.payload.filePath) {
                        unlink(payload.filePath).catch(() => {});
                    }
                    return { doc: dupDoc, deduplicated: true };
                }
            }
            throw err;
        }
    }

    notify(sessionId: string, recipientJid: string): void {
        const key = `${sessionId}:${recipientJid}`;
        if (this.runningActors.has(key)) {
            this.actorPending.set(key, true);
            return;
        }

        this.runningActors.add(key);
        this.processMailbox(sessionId, recipientJid, key).catch((err) => {
            logger.error(`Unhandled error in mailbox ${key}: ${err}`);
        });
    }

    private async processMailbox(sessionId: string, recipientJid: string, key: string): Promise<void> {
        try {
            while (true) {
                if (!whatsappService.isConnected(sessionId)) {
                    logger.debug(`Session ${sessionId} is not connected; mailbox pausing for ${recipientJid}`);
                    break;
                }

                const job = await Outbox.findOneAndUpdate(
                    {
                        sessionId,
                        recipientJid,
                        status: "QUEUED",
                        nextAttemptAt: { $lte: new Date() }
                    },
                    {
                        $set: { status: "PROCESSING", updatedAt: new Date() },
                        $inc: { attempts: 1 }
                    },
                    { sort: { _id: 1 }, returnDocument: 'after' }
                );

                if (!job) {
                    break;
                }

                await this.executeJob(job);
            }
        } finally {
            this.runningActors.delete(key);
            if (this.actorPending.get(key)) {
                this.actorPending.delete(key);
                this.notify(sessionId, recipientJid);
            }
        }
    }

    private async executeJob(job: IOutbox): Promise<void> {
        // 1. Re-verify connection
        if (!whatsappService.isConnected(job.sessionId)) {
            await Outbox.updateOne(
                { _id: String(job._id) },
                {
                    $set: { status: "QUEUED", updatedAt: new Date() },
                    $inc: { attempts: -1 }
                }
            );
            return;
        }

        // 2. Token-bucket rate limiter
        await this.rateLimiter.acquireToken(job.sessionId);

        // 3. Resolve target recipient
        const targetRecipient = job.payload.phoneNumber || job.payload.recipientJid || job.recipientJid;

        // 4. Build extra options
        const extra: SendMessageExtraOptions = {
            customMessageId: job.waMessageId,
            ...(job.payload.mentions ? { mentions: job.payload.mentions } : {}),
            ...(job.payload.quoted ? { quoted: job.payload.quoted } : {}),
            ...(job.payload.viewOnce !== undefined ? { viewOnce: job.payload.viewOnce } : {}),
            ...(job.payload.isAnimated !== undefined ? { isAnimated: job.payload.isAnimated } : {}),
            ...(job.payload.statusOptions ? { statusOptions: job.payload.statusOptions } : {})
        };

        // 5. Anti-ban pacing
        const isTypingAction = [
            "text",
            "media_url",
            "media_file",
            "voice",
            "status_text",
            "status_media_url",
            "status_media_file",
            "status_voice"
        ].includes(job.actionType);

        if (
            job.simulateTyping &&
            isTypingAction &&
            targetRecipient &&
            targetRecipient !== "status@broadcast" &&
            !targetRecipient.endsWith("@newsletter")
        ) {
            try {
                await whatsappService.sendTyping(job.sessionId, targetRecipient);
                await new Promise((r) => setTimeout(r, 1000 + Math.floor(Math.random() * 1000)));
                await whatsappService.sendTypingPaused(job.sessionId, targetRecipient);
            } catch {
                // Ignore transient typing error
            }
        } else {
            const jitterMs = 300 + Math.floor(Math.random() * 500);
            await new Promise((r) => setTimeout(r, jitterMs));
        }

        // 6. Action execution
        try {
            let sentMessage: any = null;
            switch (job.actionType) {
                case "text":
                case "status_text":
                    sentMessage = await whatsappService.sendMessage(
                        job.sessionId,
                        targetRecipient,
                        job.payload.message!,
                        job.waMessageId,
                        extra
                    );
                    break;
                case "media_url":
                case "status_media_url":
                    sentMessage = await whatsappService.sendMediaMessage(
                        job.sessionId,
                        targetRecipient,
                        job.payload.mediaType!,
                        job.payload.mediaUrl!,
                        job.payload.caption,
                        job.waMessageId,
                        extra
                    );
                    break;
                case "media_file":
                case "status_media_file":
                    sentMessage = await whatsappService.sendMediaFile(
                        job.sessionId,
                        targetRecipient,
                        {
                            path: job.payload.filePath!,
                            mimetype: job.payload.mimeType || "application/octet-stream",
                            originalname: job.payload.originalName || "file"
                        },
                        job.payload.caption,
                        job.waMessageId,
                        extra
                    );
                    break;
                case "voice":
                case "status_voice":
                    sentMessage = await whatsappService.sendVoiceNote(
                        job.sessionId,
                        targetRecipient,
                        {
                            path: job.payload.filePath!,
                            mimetype: job.payload.mimeType || "audio/ogg",
                            originalname: job.payload.originalName || "voice.ogg"
                        },
                        job.waMessageId,
                        extra
                    );
                    break;
                case "sticker":
                    sentMessage = await whatsappService.sendSticker(
                        job.sessionId,
                        targetRecipient,
                        {
                            ...(job.payload.mediaUrl ? { url: job.payload.mediaUrl } : {}),
                            ...(job.payload.filePath ? { path: job.payload.filePath } : {}),
                            ...(job.payload.mimeType ? { mimetype: job.payload.mimeType } : {}),
                            ...(job.payload.isAnimated !== undefined ? { isAnimated: job.payload.isAnimated } : {})
                        },
                        job.waMessageId,
                        extra
                    );
                    break;
                case "poll":
                    sentMessage = await whatsappService.sendPoll(
                        job.sessionId,
                        targetRecipient,
                        job.payload.poll!,
                        job.waMessageId,
                        extra
                    );
                    break;
                case "location":
                    sentMessage = await whatsappService.sendLocation(
                        job.sessionId,
                        targetRecipient,
                        job.payload.location!,
                        job.waMessageId,
                        extra
                    );
                    break;
                case "contact":
                    sentMessage = await whatsappService.sendContacts(
                        job.sessionId,
                        targetRecipient,
                        job.payload.contacts!,
                        job.waMessageId,
                        extra
                    );
                    break;
                case "react":
                    sentMessage = await whatsappService.reactMessage(
                        job.sessionId,
                        job.payload.messageKey as any,
                        job.payload.emoji!,
                        job.waMessageId
                    );
                    break;
                case "edit":
                    sentMessage = await whatsappService.editMessage(
                        job.sessionId,
                        job.payload.messageKey as any,
                        job.payload.message!,
                        job.waMessageId
                    );
                    break;
                case "delete":
                case "status_delete":
                    sentMessage = await whatsappService.deleteMessage(
                        job.sessionId,
                        job.payload.messageKey as any,
                        job.waMessageId
                    );
                    break;
                case "read":
                    sentMessage = await whatsappService.readMessage(
                        job.sessionId,
                        job.payload.messageKey as any
                    );
                    break;
                case "pin":
                    sentMessage = await whatsappService.pinMessage(
                        job.sessionId,
                        job.payload.messageKey as any,
                        job.payload.pin!.type,
                        job.payload.pin?.time,
                        job.waMessageId
                    );
                    break;
                case "star":
                    sentMessage = await whatsappService.starMessage(
                        job.sessionId,
                        job.payload.messageKey as any,
                        Boolean(job.payload.star?.star)
                    );
                    break;
                case "forward":
                    sentMessage = await whatsappService.forwardMessage(
                        job.sessionId,
                        targetRecipient,
                        job.payload.forward as any,
                        job.waMessageId
                    );
                    break;
                default:
                    throw new Error(`Unsupported outbox actionType: ${job.actionType}`);
            }

            // Store returned sentMessage preserving Buffers
            if (sentMessage && typeof sentMessage === "object") {
                try {
                    const serializedSentMsg = JSON.parse(JSON.stringify(sentMessage, BufferJSON.replacer));
                    await Outbox.updateOne(
                        { _id: String(job._id) },
                        { $set: { "payload.sentMessage": serializedSentMsg, updatedAt: new Date() } }
                    );
                } catch (e) {
                    logger.warn(`Failed to serialize sentMessage for job ${job._id}: ${e}`);
                }
            }

            // 7. Two-Stage Completion
            const immediateAck =
                job.actionType === "read" ||
                job.actionType === "star" ||
                job.actionType === "status_delete" ||
                job.recipientJid.endsWith("@newsletter");

            if (immediateAck) {
                await Outbox.updateOne(
                    { _id: String(job._id) },
                    {
                        $set: {
                            status: "DELIVERED_TO_SERVER",
                            completedAt: new Date(),
                            updatedAt: new Date()
                        }
                    }
                );
                if (job.payload.filePath) {
                    unlink(job.payload.filePath).catch(() => {});
                }
                await Events.create({
                    userId: job.userId,
                    sessionId: job.sessionId,
                    eventType: "message.delivered",
                    payload: {
                        outboxId: String(job._id),
                        messageId: job.waMessageId,
                        remoteJid: job.recipientJid,
                        actionType: job.actionType,
                        status: "DELIVERED_TO_SERVER"
                    }
                }).catch((err) => logger.error(`Failed to store message.delivered event: ${err}`));
            } else {
                if (this.earlyAckSet.has(job.waMessageId)) {
                    this.clearAckTimeout(job.waMessageId);
                    await Outbox.updateOne(
                        { _id: String(job._id) },
                        {
                            $set: {
                                status: "DELIVERED_TO_SERVER",
                                completedAt: new Date(),
                                updatedAt: new Date()
                            }
                        }
                    );
                    if (job.payload.filePath) {
                        unlink(job.payload.filePath).catch(() => {});
                    }
                    await Events.create({
                        userId: job.userId,
                        sessionId: job.sessionId,
                        eventType: "message.delivered",
                        payload: {
                            outboxId: String(job._id),
                            messageId: job.waMessageId,
                            remoteJid: job.recipientJid,
                            actionType: job.actionType,
                            status: "DELIVERED_TO_SERVER"
                        }
                    }).catch((err) => logger.error(`Failed to store message.delivered event: ${err}`));
                } else {
                    await Outbox.updateOne(
                        { _id: String(job._id), status: { $in: ["PROCESSING", "QUEUED"] } },
                        {
                            $set: {
                                status: "DISPATCHED",
                                dispatchedAt: new Date(),
                                updatedAt: new Date()
                            }
                        }
                    );
                    this.scheduleAckTimeout(job);
                    await Events.create({
                        userId: job.userId,
                        sessionId: job.sessionId,
                        eventType: "message.sent",
                        payload: {
                            outboxId: String(job._id),
                            messageId: job.waMessageId,
                            remoteJid: job.recipientJid,
                            actionType: job.actionType,
                            status: "DISPATCHED"
                        }
                    }).catch((err) => logger.error(`Failed to store message.sent event: ${err}`));
                }
            }
        } catch (err: any) {
            await this.handleJobError(job, err);
        }
    }

    private async handleJobError(job: IOutbox, err: any): Promise<void> {
        const isTerminal =
            err instanceof SsrfBlockedUrlError ||
            err instanceof UnsupportedMediaTypeError ||
            err instanceof InvalidMessageKeyError ||
            err instanceof RecipientNotOnWhatsappError ||
            err instanceof MessageNotFoundError ||
            err instanceof InvalidRecipientError ||
            err?.code === "ENOENT" ||
            job.attempts >= job.maxAttempts;

        if (isTerminal) {
            if (job.payload.filePath && job.attempts >= job.maxAttempts) {
                unlink(job.payload.filePath).catch(() => {});
            }
            this.clearAckTimeout(job.waMessageId);

            await Outbox.updateOne(
                { _id: String(job._id) },
                {
                    $set: {
                        status: "FAILED_TERMINAL",
                        lastError: err.message || String(err),
                        completedAt: new Date(),
                        updatedAt: new Date()
                    }
                }
            );

            await Events.create({
                userId: job.userId,
                sessionId: job.sessionId,
                eventType: "message.failed",
                payload: {
                    outboxId: String(job._id),
                    messageId: job.waMessageId,
                    remoteJid: job.recipientJid,
                    actionType: job.actionType,
                    status: "FAILED_TERMINAL",
                    error: err.message || String(err)
                }
            }).catch((e) => logger.error(`Failed to store message.failed event: ${e}`));
        } else {
            const backoffMs =
                Math.min(60000, 2000 * Math.pow(2, Math.max(0, job.attempts - 1))) +
                Math.floor(Math.random() * 500);

            await Outbox.updateOne(
                { _id: String(job._id) },
                {
                    $set: {
                        status: "QUEUED",
                        nextAttemptAt: new Date(Date.now() + backoffMs),
                        lastError: err.message || String(err),
                        updatedAt: new Date()
                    }
                }
            );
        }
    }

    private scheduleAckTimeout(job: IOutbox): void {
        this.clearAckTimeout(job.waMessageId);
        const timer = setTimeout(async () => {
            this.ackTimeouts.delete(job.waMessageId);
            await this.handleAckTimeout(job.sessionId, job.waMessageId);
        }, ACK_TIMEOUT_MS);
        this.ackTimeouts.set(job.waMessageId, timer);
    }

    private clearAckTimeout(waMessageId: string): void {
        const timer = this.ackTimeouts.get(waMessageId);
        if (timer) {
            clearTimeout(timer);
            this.ackTimeouts.delete(waMessageId);
        }
    }

    private async handleAckTimeout(sessionId: string, waMessageId: string): Promise<void> {
        const job = await Outbox.findOne({ sessionId, waMessageId, status: "DISPATCHED" });
        if (!job) return;

        if (job.attempts >= job.maxAttempts) {
            if (job.payload.filePath) {
                unlink(job.payload.filePath).catch(() => {});
            }
            await Outbox.updateOne(
                { _id: String(job._id) },
                {
                    $set: {
                        status: "FAILED_TERMINAL",
                        lastError: "SERVER_ACK timeout exceeded; max attempts reached",
                        completedAt: new Date(),
                        updatedAt: new Date()
                    }
                }
            );
            await Events.create({
                userId: job.userId,
                sessionId: job.sessionId,
                eventType: "message.failed",
                payload: {
                    outboxId: String(job._id),
                    messageId: job.waMessageId,
                    remoteJid: job.recipientJid,
                    actionType: job.actionType,
                    status: "FAILED_TERMINAL",
                    error: "SERVER_ACK timeout exceeded; max attempts reached"
                }
            }).catch((e) => logger.error(`Failed to store message.failed event: ${e}`));
        } else {
            await Outbox.updateOne(
                { _id: String(job._id) },
                {
                    $set: {
                        status: "QUEUED",
                        nextAttemptAt: new Date(),
                        lastError: "SERVER_ACK timeout exceeded; re-queued for replay",
                        updatedAt: new Date()
                    }
                }
            );
            if (whatsappService.isConnected(sessionId)) {
                this.notify(sessionId, job.recipientJid);
            }
        }
    }

    async handleAck(sessionId: string, waMessageId: string): Promise<void> {
        this.earlyAckSet.add(waMessageId);
        setTimeout(() => this.earlyAckSet.delete(waMessageId), 10000);

        this.clearAckTimeout(waMessageId);

        const doc = await Outbox.findOneAndUpdate(
            {
                sessionId,
                waMessageId,
                status: { $in: ["PROCESSING", "DISPATCHED"] }
            },
            {
                $set: {
                    status: "DELIVERED_TO_SERVER",
                    completedAt: new Date(),
                    updatedAt: new Date()
                }
            },
            { returnDocument: 'before' }
        );

        if (doc) {
            if (doc.payload?.filePath) {
                unlink(doc.payload.filePath).catch(() => {});
            }
            if (doc.status === "DISPATCHED") {
                await Events.create({
                    userId: doc.userId,
                    sessionId: doc.sessionId,
                    eventType: "message.delivered",
                    payload: {
                        outboxId: String(doc._id),
                        messageId: doc.waMessageId,
                        remoteJid: doc.recipientJid,
                        actionType: doc.actionType,
                        status: "DELIVERED_TO_SERVER"
                    }
                }).catch((err) => logger.error(`Failed to store message.delivered event: ${err}`));
            }
        }
    }

    private handleMessagesUpdate(sessionId: string, updates: any[]): void {
        for (const update of updates) {
            const id = update.key?.id;
            const status = update.update?.status;
            if (id && (status === undefined || status >= 2)) {
                this.handleAck(sessionId, id).catch((err) =>
                    logger.error(`Error handling ack for ${id}: ${err}`)
                );
            }
        }
    }

    private handleMessageReceiptUpdate(sessionId: string, update: any): void {
        const id = update?.key?.id;
        if (id) {
            this.handleAck(sessionId, id).catch((err) =>
                logger.error(`Error handling ack receipt for ${id}: ${err}`)
            );
        }
    }

    async kickSession(sessionId: string): Promise<void> {
        try {
            await Outbox.updateMany(
                {
                    sessionId,
                    status: "DISPATCHED",
                    dispatchedAt: { $lte: new Date(Date.now() - ACK_TIMEOUT_MS) }
                },
                {
                    $set: {
                        status: "QUEUED",
                        nextAttemptAt: new Date(),
                        lastError: "Re-queued on session connect",
                        updatedAt: new Date()
                    }
                }
            );

            const jids = await Outbox.distinct("recipientJid", {
                sessionId,
                status: "QUEUED",
                nextAttemptAt: { $lte: new Date() }
            });

            for (const jid of jids) {
                this.notify(sessionId, jid);
            }
        } catch (err) {
            logger.error(`Error kicking session ${sessionId}: ${err}`);
        }
    }

    async handleDisconnect(sessionId: string, reason: string): Promise<void> {
        try {
            const dispatchedJobs = await Outbox.find({ sessionId, status: "DISPATCHED" });
            for (const job of dispatchedJobs) {
                this.clearAckTimeout(job.waMessageId);
            }

            await Outbox.updateMany(
                { sessionId, status: "DISPATCHED" },
                {
                    $set: {
                        status: "QUEUED",
                        nextAttemptAt: new Date(Date.now() + 1000),
                        lastError: `Socket disconnected before SERVER_ACK (${reason}); re-queued for replay`,
                        updatedAt: new Date()
                    }
                }
            );
        } catch (err) {
            logger.error(`Error handling disconnect for session ${sessionId}: ${err}`);
        }
    }

    async failAllForSession(sessionId: string, reason: string): Promise<void> {
        try {
            const pendingDocs = await Outbox.find({
                sessionId,
                status: { $in: ["QUEUED", "PROCESSING", "DISPATCHED"] }
            });

            for (const doc of pendingDocs) {
                if (doc.payload?.filePath) {
                    unlink(doc.payload.filePath).catch(() => {});
                }
                this.clearAckTimeout(doc.waMessageId);
                await Events.create({
                    userId: doc.userId,
                    sessionId: doc.sessionId,
                    eventType: "message.failed",
                    payload: {
                        outboxId: String(doc._id),
                        messageId: doc.waMessageId,
                        remoteJid: doc.recipientJid,
                        actionType: doc.actionType,
                        status: "FAILED_TERMINAL",
                        error: reason
                    }
                }).catch((e) => logger.error(`Failed to store message.failed event: ${e}`));
            }

            await Outbox.updateMany(
                {
                    sessionId,
                    status: { $in: ["QUEUED", "PROCESSING", "DISPATCHED"] }
                },
                {
                    $set: {
                        status: "FAILED_TERMINAL",
                        lastError: reason,
                        completedAt: new Date(),
                        updatedAt: new Date()
                    }
                }
            );
        } catch (err) {
            logger.error(`Error failing all outbox messages for session ${sessionId}: ${err}`);
        }
    }

    private async runSweep(): Promise<void> {
        const cutoff = new Date(Date.now() - ACK_TIMEOUT_MS);

        const timedOutJobs = await Outbox.find({
            status: "DISPATCHED",
            dispatchedAt: { $lte: cutoff }
        });

        for (const job of timedOutJobs) {
            this.clearAckTimeout(job.waMessageId);
            if (job.attempts >= job.maxAttempts) {
                if (job.payload.filePath) {
                    unlink(job.payload.filePath).catch(() => {});
                }
                await Outbox.updateOne(
                    { _id: String(job._id) },
                    {
                        $set: {
                            status: "FAILED_TERMINAL",
                            lastError: "SERVER_ACK timeout exceeded; max attempts reached",
                            completedAt: new Date(),
                            updatedAt: new Date()
                        }
                    }
                );
                await Events.create({
                    userId: job.userId,
                    sessionId: job.sessionId,
                    eventType: "message.failed",
                    payload: {
                        outboxId: String(job._id),
                        messageId: job.waMessageId,
                        remoteJid: job.recipientJid,
                        actionType: job.actionType,
                        status: "FAILED_TERMINAL",
                        error: "SERVER_ACK timeout exceeded; max attempts reached"
                    }
                }).catch((e) => logger.error(`Failed to store message.failed event: ${e}`));
            } else {
                await Outbox.updateOne(
                    { _id: String(job._id) },
                    {
                        $set: {
                            status: "QUEUED",
                            nextAttemptAt: new Date(),
                            lastError: "SERVER_ACK timeout exceeded; re-queued for replay",
                            updatedAt: new Date()
                        }
                    }
                );
                if (whatsappService.isConnected(job.sessionId)) {
                    this.notify(job.sessionId, job.recipientJid);
                }
            }
        }

        const queuedJobs = await Outbox.find(
            {
                status: "QUEUED",
                nextAttemptAt: { $lte: new Date() }
            },
            { sessionId: 1, recipientJid: 1 }
        ).lean();

        const seen = new Set<string>();
        for (const q of queuedJobs) {
            const key = `${q.sessionId}:${q.recipientJid}`;
            if (!seen.has(key)) {
                seen.add(key);
                if (whatsappService.isConnected(q.sessionId)) {
                    this.notify(q.sessionId, q.recipientJid);
                }
            }
        }
    }
}

export const outboxEngine = new OutboxEngine();
