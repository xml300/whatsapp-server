import type { ConnectionStatus } from "../types/whatsapp.js";

export abstract class WhatsappServiceError extends Error {
  abstract readonly code: string;
  constructor(message: string, public readonly apiKey: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class SessionNotFoundError extends WhatsappServiceError {
    readonly code = "SESSION_NOT_FOUND";
    constructor(apiKey: string){
        super(`Session not found`, apiKey);
    }
}

export class NotConnectedError extends WhatsappServiceError {
    readonly code = "NOT_CONNECTED";
    constructor(apiKey: string, status: ConnectionStatus){
        super(`Whatsapp is not connected, status: ${status}`,  apiKey);
    }
}

export class RecipientNotOnWhatsappError extends WhatsappServiceError {
    readonly code = "RECIPIENT_NOT_ON_WHATSAPP";
    constructor(apiKey: string, phoneNumber: string){
        super(`${phoneNumber} is not on WhatsApp`, apiKey);
    }
}

export class InvalidMessageKeyError extends WhatsappServiceError {
    readonly code = "INVALID_MESSAGE_KEY";
    constructor(apiKey: string){
        super(`Message key is missing a remote JID`, apiKey);
    }
}

export class UnsupportedMediaTypeError extends WhatsappServiceError {
  readonly code = "UNSUPPORTED_MEDIA_TYPE";
  constructor(apiKey: string, public readonly mimeType: string) {
    super(`Unsupported media type: ${mimeType}`, apiKey);
  }
}

export class SsrfBlockedUrlError extends WhatsappServiceError {
  readonly code = "BLOCKED_URL";
  constructor(apiKey: string) {
    super(`The provided media URL is not allowed`, apiKey);
  }
}

// Wraps whatever Baileys/network throws, so callers still get one hierarchy
export class WhatsappTransportError extends WhatsappServiceError {
  readonly code = "TRANSPORT_ERROR";
  constructor(apiKey: string, cause: unknown) {
    super(`Underlying WhatsApp transport error`, apiKey, { cause });
  }
}