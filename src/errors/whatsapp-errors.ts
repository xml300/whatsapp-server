import type { ConnectionStatus } from "../types/whatsapp.js";

export abstract class WhatsappServiceError extends Error {
  abstract readonly code: string;
  constructor(message: string, public readonly sessionId: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class SessionNotFoundError extends WhatsappServiceError {
    readonly code = "SESSION_NOT_FOUND";
    constructor(sessionId: string){
        super(`Session not found`, sessionId);
    }
}

export class NotConnectedError extends WhatsappServiceError {
    readonly code = "NOT_CONNECTED";
    constructor(sessionId: string, status: ConnectionStatus){
        super(`Whatsapp is not connected, status: ${status}`, sessionId);
    }
}

export class RecipientNotOnWhatsappError extends WhatsappServiceError {
    readonly code = "RECIPIENT_NOT_ON_WHATSAPP";
    constructor(sessionId: string, phoneNumber: string){
        super(`${phoneNumber} is not on WhatsApp`, sessionId);
    }
}

export class InvalidMessageKeyError extends WhatsappServiceError {
    readonly code = "INVALID_MESSAGE_KEY";
    constructor(sessionId: string){
        super(`Message key is missing a remote JID`, sessionId);
    }
}

export class UnsupportedMediaTypeError extends WhatsappServiceError {
  readonly code = "UNSUPPORTED_MEDIA_TYPE";
  constructor(sessionId: string, public readonly mimeType: string) {
    super(`Unsupported media type: ${mimeType}`, sessionId);
  }
}

export class SsrfBlockedUrlError extends WhatsappServiceError {
  readonly code = "BLOCKED_URL";
  constructor(sessionId: string) {
    super(`The provided media URL is not allowed`, sessionId);
  }
}

// Wraps whatever Baileys/network throws, so callers still get one hierarchy
export class WhatsappTransportError extends WhatsappServiceError {
  readonly code = "TRANSPORT_ERROR";
  constructor(sessionId: string, cause: unknown) {
    super(`Underlying WhatsApp transport error`, sessionId, { cause });
  }
}
