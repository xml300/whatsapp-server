# WhatsApp Server API Specification Reference

This document provides a comprehensive reference for the WhatsApp Server REST API (v1), including authentication schemes, request headers and idempotency guarantees, asynchronous Outbox response structures, message mutation endpoints, Outbox lifecycle management, and event polling.

---

## 1. Authentication Schemes & Request Headers

The WhatsApp Server implements a dual-tier authentication architecture alongside optional idempotency headers:

### 1.1 Management & Administration Tier (`CookieAuth`)
Used for administrative operations: user authentication, session provisioning, and API key generation.
- **Mechanism**: HTTP-only Cookie (`auth_token`) containing a signed JSON Web Token (JWT).
- **TTL**: 1 hour from issuance.
- **Payload**: `{ id: string, username: string }`.
- **Handling**: Browsers handle this automatically via `credentials: 'include'`. API clients (e.g. cURL, Postman) should persist cookies using a cookie jar (`-c cookies.txt -b cookies.txt`).

### 1.2 WhatsApp Gateway Tier (`ApiKeyAuth`)
Used for automated programmatic interactions: socket connection management, message dispatch, media upload, and real-time event streaming.
- **Mechanism**: HTTP Request Header:
  ```http
  x-api-key: <YOUR_UUID_V4_API_KEY>
  ```
- **Generation**: Generated via `POST /api/api-keys/generate` while authenticated with an `auth_token` cookie.

### 1.3 Idempotency Key Header (`Idempotency-Key`)
Supported on all asynchronous message dispatch and mutation endpoints (`/api/v1/send/*` and `/api/v1/messages/*`):
- **Mechanism**: HTTP Request Header:
  ```http
  Idempotency-Key: <UNIQUE_UUID_OR_STRING>
  ```
- **Transparent Deduplication**:
  When a request includes an `Idempotency-Key`, the engine queries the MongoDB Outbox for an existing record with matching `(sessionId, idempotencyKey)`.
  - If a matching record is found, the server bypasses re-enqueueing and immediately returns `202 Accepted` with the existing Outbox item metadata, setting `"deduplicated": true` and `"message": "Duplicate request; returning existing outbox item"`.
  - For multipart file uploads (`/api/v1/send/file` and `/api/v1/send/voice`), any newly staged file written to disk (`data/outbox-media/`) is immediately unlinked to eliminate orphan file leakage.
  - If omitted, the server automatically generates a unique UUID v4 string as the idempotency key.

---

## 2. Standard Response Formats

### 2.1 Synchronous Success Response (`200 OK`)
Used by non-queued endpoints (e.g., connection status, queries, typing indicators, outbox inspections):
```json
{
  "success": true,
  "data": { ... }
}
```

### 2.2 Asynchronous Outbox Acceptance Response (`202 Accepted`)
Returned by all message dispatch and mutation endpoints (`/api/v1/send/*`, `/api/v1/messages/*`, and `/api/v1/outbox/:outboxId/retry`):
```json
{
  "success": true,
  "data": {
    "outboxId": "6725225c57fa85b5420cb051",
    "messageId": "3EB091AE751D87A0",
    "remoteJid": "2348012345678@s.whatsapp.net",
    "status": "queued",
    "idempotencyKey": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "deduplicated": false,
    "message": "Message queued for delivery"
  }
}
```

#### Outbox Response Fields:
| Field | Type | Description |
|---|---|---|
| `outboxId` | `string` | MongoDB `ObjectId` string identifying the durable Outbox job. |
| `messageId` | `string` | 16-character Baileys WhatsApp message ID pre-assigned at enqueue time (`generateMessageIDV2()`). |
| `remoteJid` | `string` | Formatted WhatsApp JID of the recipient (`<phoneNumber>@s.whatsapp.net` or group JID). |
| `status` | `string` | Current lifecycle state: `"queued"`, `"processing"`, `"dispatched"`, `"delivered_to_server"`, `"failed_terminal"`, `"cancelled"`. |
| `idempotencyKey` | `string` | Client-supplied or server-generated idempotency key. |
| `deduplicated` | `boolean` | `true` if this request matched an existing outbox record; `false` if newly enqueued. |
| `message` | `string` | Human-readable outcome description. |

### 2.3 Error Response (`4xx` / `5xx`)
```json
{
  "success": false,
  "error": {
    "code": 400,
    "message": "Human-readable error description"
  }
}
```

---

## 3. Endpoints Inventory

### 3.1 System & Health

#### `GET /api/health`
Checks server liveness and returns active in-memory session IDs.

- **Auth**: None
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "ok": true,
      "activeSessions": [
        "d41d8cd98f00b204e9800998ecf8427e"
      ]
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X GET http://localhost:3000/api/health
  ```

#### `GET /api/logs`
Retrieves paginated application and HTTP access logs stored in MongoDB.

- **Auth**: Cookie (`auth_token`)
- **Query Parameters**:
  - `page` *(optional, integer, default: `1`)*: Page number.
  - `limit` *(optional, integer, default: `100`)*: Log entries per page.
- **Response**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "2768ffec-914b-4dd9-a511-2ebf4fa944ae",
        "source": "HTTP_SERVER",
        "message": "[POST] /api/v1/send/text - 202 Accepted (34ms)",
        "level": "INFO",
        "timestamp": "2026-11-01T15:30:00.000Z"
      }
    ],
    "meta": {
      "totalPages": 12,
      "currentPage": 1,
      "logsPerPage": 100,
      "totalLogs": 1145
    }
  }
  ```

---

### 3.2 User Authentication

#### `POST /api/auth/register`
Creates a new administrative user and returns a set-cookie header with `auth_token`.

- **Auth**: None
- **Request Body** (`application/json`):
  ```json
  {
    "username": "admin_user",
    "password": "securePassword123"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "username": "admin_user",
        "createdAt": "2026-11-01T12:00:00.000Z"
      }
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X POST http://localhost:3000/api/auth/register \
    -H "Content-Type: application/json" \
    -c cookies.txt \
    -d '{"username":"admin_user","password":"securePassword123"}'
  ```

#### `POST /api/auth/login`
Authenticates existing credentials and issues the `auth_token` cookie.

- **Auth**: None
- **Request Body** (`application/json`):
  ```json
  {
    "username": "admin_user",
    "password": "securePassword123"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "username": "admin_user",
        "createdAt": "2026-11-01T12:00:00.000Z"
      }
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -c cookies.txt \
    -d '{"username":"admin_user","password":"securePassword123"}'
  ```

---

### 3.3 API Keys Management

#### `GET /api/api-keys`
Lists all API keys created by the currently authenticated user.

- **Auth**: Cookie (`auth_token`)
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "apiKeys": [
        {
          "_id": "66bf744b82d38e21a48c90aa",
          "userId": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
          "apiKey": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
          "createdAt": "2026-11-01T12:05:00.000Z",
          "updatedAt": "2026-11-01T12:05:00.000Z"
        }
      }
    ]
  }
  ```

#### `POST /api/api-keys/generate`
Generates a new UUID v4 API key for programmatic access.

- **Auth**: Cookie (`auth_token`)
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "apiKey": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X POST http://localhost:3000/api/api-keys/generate \
    -b cookies.txt
  ```

---

### 3.4 WhatsApp Session Management

#### `GET /api/sessions`
Returns all registered WhatsApp sessions for the user.

- **Auth**: Cookie (`auth_token`)
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "sessions": [
        {
          "id": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "userId": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
          "phoneNumber": "2348012345678",
          "desiredState": "CONNECTED"
        }
      ]
    }
  }
  ```

#### `POST /api/sessions`
Creates a new session record for a given phone number. Normalizes phone numbers (e.g. `08012345678` -> `2348012345678`).

- **Auth**: Cookie (`auth_token`)
- **Request Body** (`application/json`):
  ```json
  {
    "phoneNumber": "08012345678"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "session": {
        "id": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "userId": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
        "phoneNumber": "2348012345678"
      }
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X POST http://localhost:3000/api/sessions \
    -H "Content-Type: application/json" \
    -b cookies.txt \
    -d '{"phoneNumber":"08012345678"}'
  ```

---

### 3.5 WhatsApp Connection & Lifecycle

#### `GET /api/v1/sessions`
Returns all WhatsApp sessions belonging to the authenticated API key user along with live Baileys connection and pairing readiness statuses.

- **Auth**: Header `x-api-key`
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "sessions": [
        {
          "id": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "userId": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
          "phoneNumber": "2348012345678",
          "desiredState": "CONNECTED",
          "isConnected": true,
          "isPairingReady": false,
          "status": "connected"
        }
      ]
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X GET http://localhost:3000/api/v1/sessions \
    -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
  ```

#### `POST /api/v1/connection`
Initializes a Baileys WebSocket instance for the specified session and phone number, setting `desiredState: "CONNECTED"` in MongoDB.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  ```json
  {
    "sessionId": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "phoneNumber": "08012345678"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "serviceStatus": "connected",
      "sessionId": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X POST http://localhost:3000/api/v1/connection \
    -H "Content-Type: application/json" \
    -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    -d '{"sessionId":"e3b0c44...","phoneNumber":"08012345678"}'
  ```

#### `GET /api/v1/connection/:sessionId/status`
Queries the active socket connection state, pairing readiness, and finite state machine (FSM) status.

- **Auth**: Header `x-api-key`
- **Path Parameters**: `sessionId` (string)
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "isConnected": true,
      "isPairingReady": false,
      "status": "connected"
    }
  }
  ```

##### Status Values:
| Status | Description |
|---|---|
| `"connected"` | Active authenticated WhatsApp socket connection established. |
| `"connecting"` | Socket connection or initial authentication handshake in progress. |
| `"reconnecting"` | Fast exponential backoff reconnection retries (attempts 1–5, 2s to 30s base delay + random jitter). |
| `"degraded"` | Retries exceeded 5 attempts; infinite circuit-breaker probe mode in effect (60-second periodic attempts + random jitter). |
| `"disconnected"` | Socket closed, session manually disconnected, or logged out by WhatsApp. |

#### `GET /api/v1/connection/:sessionId/qr`
Retrieves the raw QR code string emitted during WhatsApp multi-device handshake.

- **Auth**: Header `x-api-key`
- **Path Parameters**: `sessionId` (string)
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "qr": "2@4e8a...==,9j3K...==,1@x..."
    }
  }
  ```

#### `GET /api/v1/connection/:sessionId/pairing-code`
Retrieves an 8-digit alphanumeric pairing code for linking devices via phone number.

- **Auth**: Header `x-api-key`
- **Path Parameters**: `sessionId` (string)
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "pairingCode": "ABCD-1234"
    }
  }
  ```

#### `POST /api/v1/connection/:sessionId/end`
Gracefully terminates the WhatsApp connection socket and updates `desiredState: "DISCONNECTED"` in MongoDB.

- **Auth**: Header `x-api-key`
- **Path Parameters**: `sessionId` (string)
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "serviceStatus": "disconnected"
    }
  }
  ```

---

### 3.6 1:1 Messaging & Media Dispatch (Asynchronous Outbox)

All 1:1 messaging dispatches are accepted asynchronously into the durable MongoDB Outbox with `202 Accepted`. Per-JID mailboxes (`ChatActor`) ensure sequential FIFO dispatch without cross-chat Head-of-Line blocking.

#### `POST /api/v1/send/typing`
Sends an immediate typing / composing presence indicator directly to the chat without passing through the Outbox queue.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `phoneNumber` *(required, string)*: Recipient phone number.
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "message": "Typing sent successfully"
    }
  }
  ```

#### `POST /api/v1/send/text`
Queues a standard text message for delivery via the Outbox. Supports rich contextual features including quoted message replies, participant mentions, and simulated typing presence.

- **Auth**: Header `x-api-key`
- **Optional Headers**: `Idempotency-Key: <UUID>`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: Registered session ID.
  - `phoneNumber` *(required, string)*: Recipient phone number (e.g. `08099887766` or international format).
  - `message` *(required, string)*: Text content to deliver.
  - `mentions` *(optional, array of strings)*: Array of phone numbers or WhatsApp JIDs to mention in the message.
  - `quoted` *(optional, object)*: Context of a message being replied to (`{ messageId, remoteJid, participant, fromMe, text }`).
  - `quotedMessageId` *(optional, string)*: Convenience shorthand for `quoted.messageId` (resolved automatically from message history).
  - `simulateTyping` *(optional, boolean, default: `false`)*: Broadcasts a composing presence indicator before dispatch.
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb051",
      "messageId": "3EB091AE751D87A0",
      "remoteJid": "2348099887766@s.whatsapp.net",
      "status": "queued",
      "idempotencyKey": "text-job-12345",
      "deduplicated": false,
      "message": "Message queued for delivery"
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X POST http://localhost:3000/api/v1/send/text \
    -H "Content-Type: application/json" \
    -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    -H "Idempotency-Key: text-job-12345" \
    -d '{
      "sessionId": "sales-line-1",
      "phoneNumber": "08099887766",
      "message": "Hello from the WhatsApp Gateway!",
      "simulateTyping": true
    }'
  ```

#### `POST /api/v1/send/media`
Queues media delivery from a remote public URL. The URL is resolved and checked against private/reserved IPv4 & IPv6 CIDRs to guard against SSRF attacks. Supports `viewOnce`, `mentions`, and `quoted` context.

- **Auth**: Header `x-api-key`
- **Optional Headers**: `Idempotency-Key: <UUID>`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `phoneNumber` *(required, string)*: Recipient phone number.
  - `mediaType` *(required, string)*: One of `"image"`, `"video"`, `"audio"`, `"document"`.
  - `mediaUrl` *(required, string)*: Publicly reachable URL pointing to the media asset.
  - `caption` *(optional, string)*: Media caption.
  - `viewOnce` *(optional, boolean, default: `false`)*: When `true`, sends media as a view-once asset.
  - `mentions` *(optional, array of strings)*: Participant JIDs or phone numbers mentioned in caption.
  - `quoted` *(optional, object)*: Quoted message context.
  - `quotedMessageId` *(optional, string)*: Message ID to quote.
  - `simulateTyping` *(optional, boolean, default: `false`)*: Whether to simulate typing before dispatch.
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb053",
      "messageId": "3EB091AE751D87A2",
      "remoteJid": "2348099887766@s.whatsapp.net",
      "status": "queued",
      "idempotencyKey": "url-job-5432",
      "deduplicated": false,
      "message": "Media queued for delivery"
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X POST http://localhost:3000/api/v1/send/media \
    -H "Content-Type: application/json" \
    -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    -d '{
      "sessionId": "sales-line-1",
      "phoneNumber": "08099887766",
      "mediaType": "image",
      "mediaUrl": "https://example.com/promo.png",
      "caption": "Limited time offer!",
      "viewOnce": true
    }'
  ```

#### `POST /api/v1/send/file`
Uploads and queues a binary media file (image, video, audio, or document) up to 25MB. Files are streamed directly to `data/outbox-media/` to protect V8 heap memory and unlinked automatically once server delivery ACK is verified.

- **Auth**: Header `x-api-key`
- **Optional Headers**: `Idempotency-Key: <UUID>`
- **Content-Type**: `multipart/form-data`
- **Form Fields**:
  - `sessionId` *(required, text)*: WhatsApp session ID.
  - `phoneNumber` *(required, text)*: Recipient phone number.
  - `caption` *(optional, text)*: Optional caption accompanying the file.
  - `viewOnce` *(optional, boolean)*: Set to `"true"` for view-once media.
  - `mentions` *(optional, text)*: Mentioned phone numbers / JIDs (comma-separated or JSON array).
  - `quoted` / `quotedMessageId` *(optional, text)*: Quoted message context or ID.
  - `simulateTyping` *(optional, boolean)*: Set to `"true"` to simulate composing before dispatch.
  - `file` *(required, binary file)*: Target file payload (max 25MB).
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb052",
      "messageId": "3EB091AE751D87A1",
      "remoteJid": "2348099887766@s.whatsapp.net",
      "status": "queued",
      "idempotencyKey": "file-job-9876",
      "deduplicated": false,
      "message": "File queued for delivery"
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X POST http://localhost:3000/api/v1/send/file \
    -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    -H "Idempotency-Key: file-job-9876" \
    -F "sessionId=sales-line-1" \
    -F "phoneNumber=08099887766" \
    -F "caption=Monthly Statement" \
    -F "file=@/path/to/statement.pdf"
  ```

#### `POST /api/v1/send/voice`
Uploads and queues a Push-to-Talk (PTT) voice note. File must have an `audio/*` MIME type. Staged to `data/outbox-media/` and unlinked upon delivery ACK verification.

- **Auth**: Header `x-api-key`
- **Optional Headers**: `Idempotency-Key: <UUID>`
- **Content-Type**: `multipart/form-data`
- **Form Fields**:
  - `sessionId` *(required, text)*: WhatsApp session ID.
  - `phoneNumber` *(required, text)*: Recipient phone number.
  - `viewOnce` *(optional, boolean)*: Set to `"true"` for view-once voice note.
  - `quoted` / `quotedMessageId` *(optional, text)*: Quoted message context or ID.
  - `simulateTyping` *(optional, boolean)*: Set to `"true"` to broadcast audio recording presence.
  - `file` *(required, binary file)*: Audio file payload (`audio/ogg`, `audio/mp4`, `audio/mpeg`, etc.).
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb054",
      "messageId": "3EB091AE751D87A3",
      "remoteJid": "2348099887766@s.whatsapp.net",
      "status": "queued",
      "idempotencyKey": "voice-job-1122",
      "deduplicated": false,
      "message": "Voice note queued for delivery"
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X POST http://localhost:3000/api/v1/send/voice \
    -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    -F "sessionId=sales-line-1" \
    -F "phoneNumber=08099887766" \
    -F "file=@/path/to/voice-note.ogg"
  ```

#### `POST /api/v1/send/sticker`
Queues a WhatsApp WebP sticker for delivery. Supports both multipart binary uploads and remote media URLs, with optional animated sticker support.

- **Auth**: Header `x-api-key`
- **Optional Headers**: `Idempotency-Key: <UUID>`
- **Content-Type**: `multipart/form-data` OR `application/json`
- **Parameters**:
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `phoneNumber` *(required, string)*: Recipient phone number.
  - `mediaUrl` *(optional, string)*: Remote sticker asset URL (checked against SSRF rules).
  - `isAnimated` *(optional, boolean)*: Set to `true` if sticker contains animated frames.
  - `quoted` / `quotedMessageId` *(optional)*: Quoted message context.
  - `file` *(optional, binary file)*: Sticker file (WebP or image) when using multipart.
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb058",
      "messageId": "3EB091AE751D87A7",
      "remoteJid": "2348099887766@s.whatsapp.net",
      "status": "queued",
      "idempotencyKey": "sticker-job-1010",
      "deduplicated": false,
      "message": "Sticker queued for delivery"
    }
  }
  ```

#### `POST /api/v1/send/poll`
Queues an interactive WhatsApp poll with selectable choices. Poll votes are decrypted automatically when returned by WhatsApp.

- **Auth**: Header `x-api-key`
- **Optional Headers**: `Idempotency-Key: <UUID>`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `phoneNumber` *(required, string)*: Recipient phone number.
  - `name` *(required, string)*: Poll question / title.
  - `values` *(required, array of strings)*: Array of 2 to 12 choice strings.
  - `selectableCount` *(optional, integer, default: `1`)*: Maximum choices a voter can select.
  - `quoted` / `quotedMessageId` *(optional)*: Quoted message context.
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb059",
      "messageId": "3EB091AE751D87A8",
      "remoteJid": "2348099887766@s.whatsapp.net",
      "status": "queued",
      "idempotencyKey": "poll-job-2020",
      "deduplicated": false,
      "message": "Poll queued for delivery"
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X POST http://localhost:3000/api/v1/send/poll \
    -H "Content-Type: application/json" \
    -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    -d '{
      "sessionId": "sales-line-1",
      "phoneNumber": "08099887766",
      "name": "Preferred delivery time?",
      "values": ["Morning (9am - 12pm)", "Afternoon (1pm - 5pm)", "Evening (6pm - 9pm)"],
      "selectableCount": 1
    }'
  ```

#### `POST /api/v1/send/location`
Queues a geographic location pin or business venue card for delivery.

- **Auth**: Header `x-api-key`
- **Optional Headers**: `Idempotency-Key: <UUID>`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `phoneNumber` *(required, string)*: Recipient phone number.
  - `latitude` *(required, number)*: Latitude coordinates in degrees.
  - `longitude` *(required, number)*: Longitude coordinates in degrees.
  - `name` *(optional, string)*: Venue or place name.
  - `address` *(optional, string)*: Physical postal address.
  - `url` *(optional, string)*: URL associated with location.
  - `quoted` / `quotedMessageId` *(optional)*: Quoted message context.
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb060",
      "messageId": "3EB091AE751D87A9",
      "remoteJid": "2348099887766@s.whatsapp.net",
      "status": "queued",
      "idempotencyKey": "loc-job-3030",
      "deduplicated": false,
      "message": "Location queued for delivery"
    }
  }
  ```

#### `POST /api/v1/send/contact`
Queues one or multiple interactive WhatsApp vCard contact cards. Automatically formats compliant vCard 3.0 records with international phone normalization.

- **Auth**: Header `x-api-key`
- **Optional Headers**: `Idempotency-Key: <UUID>`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `phoneNumber` *(required, string)*: Recipient phone number.
  - `displayName` *(optional, string)*: Contact display name.
  - `phoneNumberCard` *(optional, string)*: Single contact card phone number (shorthand).
  - `vcard` *(optional, string)*: Pre-formatted custom vCard 3.0 text block.
  - `contacts` *(optional, array of objects)*: Multi-contact card list: `[{ displayName: string, phoneNumber?: string, vcard?: string }]`.
  - `quoted` / `quotedMessageId` *(optional)*: Quoted message context.
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb061",
      "messageId": "3EB091AE751D87AA",
      "remoteJid": "2348099887766@s.whatsapp.net",
      "status": "queued",
      "idempotencyKey": "contact-job-4040",
      "deduplicated": false,
      "message": "Contact queued for delivery"
    }
  }
  ```

---

### 3.7 Message Mutations (Asynchronous Outbox)

Endpoints that mutate existing messages or send conversational feedback. All endpoints queue operations into the Outbox and return `202 Accepted`. Operations without WhatsApp server ACK receipts (`read`, `star`) complete immediately upon socket execution.

#### `POST /api/v1/messages/react`
Queues an emoji reaction to an existing message.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `messageId` *(required, string)*: Target message ID.
  - `remoteJid` *(required, string)*: Conversation JID (`<phone>@s.whatsapp.net` or `<group>@g.us`).
  - `emoji` *(required, string)*: Emoji character (`"👍"`, `"❤️"`, or `""` to remove).
  - `fromMe` *(optional, boolean)*: Whether the target message was sent by your session.
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb055",
      "messageId": "3EB091AE751D87A4",
      "status": "queued",
      "message": "Reaction queued for delivery"
    }
  }
  ```

#### `POST /api/v1/messages/edit`
Queues an edit to a previously sent text message. Only messages originally sent by your session (`fromMe: true`) can be edited.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `messageId` *(required, string)*: ID of the message to edit.
  - `remoteJid` *(required, string)*: Chat JID where message was sent.
  - `message` *(required, string)*: Replacement text content.
  - `fromMe` *(optional, boolean, default: `true`)*: Confirms message was sent by session.
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb062",
      "messageId": "3EB091AE751D87AB",
      "status": "queued",
      "message": "Edit queued for delivery"
    }
  }
  ```

#### `POST /api/v1/messages/pin`
Pins or unpins a message in a 1:1 or group conversation with an optional expiration window.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `messageId` *(required, string)*: ID of the target message.
  - `remoteJid` *(required, string)*: Conversation JID.
  - `action` *(required, string)*: `"pin"` or `"unpin"`.
  - `time` *(optional, integer)*: Pin duration in seconds (`86400` = 24h, `604800` = 7 days, `2592000` = 30 days). Default: `86400`.
  - `fromMe` *(optional, boolean)*: Whether target was sent by session.
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb063",
      "messageId": "3EB091AE751D87AC",
      "status": "queued",
      "message": "Pin action queued for delivery"
    }
  }
  ```

#### `POST /api/v1/messages/star`
Stars or unstars a message in chat history. Completes immediately upon socket dispatch.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `messageId` *(required, string)*: ID of target message.
  - `remoteJid` *(required, string)*: Conversation JID.
  - `star` *(required, boolean)*: `true` to star, `false` to unstar.
  - `fromMe` *(optional, boolean)*: Whether message was from session.
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb064",
      "status": "queued",
      "message": "Star action queued for delivery"
    }
  }
  ```

#### `POST /api/v1/messages/delete`
Queues a message revocation ("Delete for Everyone").

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `messageId` *(required, string)*: Target WhatsApp message ID.
  - `remoteJid` *(required, string)*: Recipient or group JID.
  - `fromMe` *(optional, boolean, default: `true`)*: Whether message was from your account.
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb056",
      "messageId": "3EB091AE751D87A5",
      "status": "queued",
      "message": "Delete action queued for delivery"
    }
  }
  ```

#### `POST /api/v1/messages/read`
Queues a read receipt to mark incoming messages as read. Completes immediately upon socket execution.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `messageId` *(required, string)*: Target WhatsApp message ID.
  - `remoteJid` *(required, string)*: Sender or group JID.
  - `participant` *(optional, string)*: Sender JID for group messages.
  - `fromMe` *(optional, boolean, default: `false`)*: Whether message was from session.
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb057",
      "status": "queued",
      "message": "Read receipt queued for delivery"
    }
  }
  ```

#### `POST /api/v1/messages/forward`
Forwards an existing message to another chat or group without re-uploading media. Automatically resolves original message payload from historical events or outbound archives.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `recipientJid` *(optional, string)*: Destination JID (or `phoneNumber`).
  - `phoneNumber` *(optional, string)*: Destination phone number.
  - `messageId` *(optional, string)*: Message ID to forward (resolved via `resolveWAMessageById`).
  - `remoteJid` *(optional, string)*: Source chat JID.
  - `fromMe` *(optional, boolean)*: Whether message was originally from session.
  - `rawMessage` *(optional, object)*: Direct Baileys message object if available.
  - `force` *(optional, boolean)*: Set to `true` to force forward without forwarded tag.
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb065",
      "messageId": "3EB091AE751D87AD",
      "status": "queued",
      "message": "Forward action queued for delivery"
    }
  }
  ```

---

### 3.8 Presence & Chat Modifiers (Synchronous Control Plane)

Synchronous real-time control plane endpoints for broadcasting presence, subscribing to presence updates, and managing chat state (pin, archive, mute).

#### `POST /api/v1/presence`
Broadcasts an immediate user presence update across WhatsApp or targeted to a specific chat.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `presence` *(required, string)*: Presence state: `"composing"`, `"recording"`, `"paused"`, `"available"`, or `"unavailable"`.
  - `toJid` *(optional, string)*: Target conversation JID or phone number.
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "message": "Presence updated successfully"
    }
  }
  ```

#### `POST /api/v1/presence/subscribe`
Subscribes to live presence updates for a given contact or chat JID.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `toJid` *(required, string)*: Contact JID or phone number to subscribe to.
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "message": "Subscribed to presence updates"
    }
  }
  ```

#### `POST /api/v1/chats/:jid/modify`
Applies chat state modifications such as archiving, pinning, and muting.

- **Auth**: Header `x-api-key`
- **Path Parameters**: `jid` *(required, string)*: Target conversation JID (`<phone>@s.whatsapp.net` or `<group>@g.us`).
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `action` *(required, string)*: `"archive"`, `"unarchive"`, `"pin"`, `"unpin"`, `"mute"`, or `"unmute"`.
  - `muteDurationMs` *(optional, integer)*: Duration to mute in milliseconds (e.g. `28800000` = 8 hours). Omit or set to `null` for unmuting.
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "message": "Chat modified successfully"
    }
  }
  ```

---

### 3.9 Group Management & Messaging (`/api/v1/groups/*`)

Provides comprehensive group messaging via the Outbox alongside real-time synchronous endpoints for group administration, participant management, invite codes, settings, and join requests.

#### Group Messaging Endpoints (Asynchronous Outbox `202 Accepted`)
All endpoints validate `:groupJid` against WhatsApp group format (`@g.us`) and enqueue dispatches through the Outbox:
- `POST /api/v1/groups/:groupJid/send/text`: `{ sessionId, message, mentions?, quoted?, quotedMessageId?, simulateTyping? }`
- `POST /api/v1/groups/:groupJid/send/media`: `{ sessionId, mediaType, mediaUrl, caption?, mentions?, viewOnce?, quoted?, quotedMessageId?, simulateTyping? }`
- `POST /api/v1/groups/:groupJid/send/file`: Multipart upload: `file`, `sessionId`, `caption?`, `mentions?`, `viewOnce?`, `quoted?`, `quotedMessageId?`, `simulateTyping?`
- `POST /api/v1/groups/:groupJid/send/voice`: Multipart upload: `file`, `sessionId`, `viewOnce?`, `quoted?`, `quotedMessageId?`, `simulateTyping?`
- `POST /api/v1/groups/:groupJid/send/sticker`: Multipart `file` or `{ sessionId, mediaUrl?, isAnimated?, quoted?, quotedMessageId? }`
- `POST /api/v1/groups/:groupJid/send/poll`: `{ sessionId, name, values: string[], selectableCount?, toAnnouncementGroup?, mentions?, quoted?, quotedMessageId? }`
- `POST /api/v1/groups/:groupJid/send/location`: `{ sessionId, latitude, longitude, name?, address?, url?, quoted?, quotedMessageId? }`
- `POST /api/v1/groups/:groupJid/send/contact`: `{ sessionId, displayName?, contacts: [{ displayName, phoneNumber?, vcard? }], quoted?, quotedMessageId? }`

> **Note on Mentions**: Passing `mentions: "all"` automatically queries group metadata and populates participant JIDs for group-wide alerts.

#### `GET /api/v1/groups`
Fetches all participating groups for the active session.

- **Auth**: Header `x-api-key`
- **Query Parameters**: `sessionId` *(required, string)*
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "groups": [
        {
          "id": "123456789-987654@g.us",
          "subject": "Engineering Team",
          "owner": "2348011112222@s.whatsapp.net",
          "creation": 1690000000,
          "participants": [
            { "id": "2348011112222@s.whatsapp.net", "admin": "admin" },
            { "id": "2348099887766@s.whatsapp.net", "admin": null }
          ]
        }
      ]
    }
  }
  ```

#### `POST /api/v1/groups`
Creates a new WhatsApp group.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `subject` *(required, string)*: Group title / subject.
  - `participants` *(required, array of strings)*: Initial participant phone numbers or JIDs.
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "group": {
        "id": "123456789-987654@g.us",
        "subject": "Engineering Team"
      }
    }
  }
  ```

#### `GET /api/v1/groups/:groupJid`
Retrieves detailed metadata for a specific group (subject, owner, description, participants, and settings). Cached in memory for 5 minutes with event-driven invalidation.

- **Auth**: Header `x-api-key`
- **Path Parameters**: `groupJid` *(required, string)*: Target group JID (`@g.us`).
- **Query Parameters**: `sessionId` *(required, string)*
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "id": "123456789-987654@g.us",
      "subject": "Engineering Team",
      "desc": "Discussion group for backend services",
      "participants": [ ... ]
    }
  }
  ```

#### `POST /api/v1/groups/:groupJid/leave`
Leaves the specified WhatsApp group.

- **Auth**: Header `x-api-key`
- **Path Parameters**: `groupJid` *(required, string)*
- **Request Body** (`application/json`): `sessionId` *(required, string)*
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": { "message": "Left group successfully" }
  }
  ```

#### `PATCH /api/v1/groups/:groupJid/subject`
Updates group subject / title.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `subject` *(required, string)*: New group title.
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": { "message": "Group subject updated" }
  }
  ```

#### `PATCH /api/v1/groups/:groupJid/description`
Updates group description.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `description` *(required, string)*: New group description text.
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": { "message": "Group description updated" }
  }
  ```

#### `PATCH /api/v1/groups/:groupJid/settings`
Updates group operational policies: announcement mode, member editing rights, join approval mode, and disappearing messages.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `setting` *(optional, string)*: `"announcement"` (only admins send) | `"not_announcement"` (all send) | `"locked"` (only admins edit info) | `"unlocked"` (all edit info).
  - `memberAddMode` *(optional, string)*: `"admin_add"` | `"all_member_add"`.
  - `joinApprovalMode` *(optional, string)*: `"on"` | `"off"`.
  - `ephemeralExpiration` *(optional, integer)*: Disappearing message duration in seconds (`0`, `86400`, `604800`, `7776000`).
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": { "message": "Group settings updated" }
  }
  ```

#### `PUT /api/v1/groups/:groupJid/picture`
Updates group profile picture / icon via multipart file upload or remote image URL.

- **Auth**: Header `x-api-key`
- **Content-Type**: `multipart/form-data` OR `application/json`
- **Parameters**: `sessionId` *(required)*, `file` *(optional file)*, `imageUrl` *(optional URL)*
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": { "message": "Group picture updated" }
  }
  ```

#### `DELETE /api/v1/groups/:groupJid/picture`
Removes group profile picture.

- **Auth**: Header `x-api-key`
- **Parameters**: `sessionId` *(required in body or query)*
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": { "message": "Group picture removed" }
  }
  ```

#### `POST /api/v1/groups/:groupJid/participants`
Adds, removes, promotes, or demotes participants in the group.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `participants` *(required, array of strings)*: Participant phone numbers or JIDs.
  - `action` *(required, string)*: One of `"add"`, `"remove"`, `"promote"`, `"demote"`.
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "result": [
        { "status": "200", "jid": "2348099887766@s.whatsapp.net" }
      ]
    }
  }
  ```

#### `GET /api/v1/groups/:groupJid/invite-code`
Retrieves the active group invite link code.

- **Auth**: Header `x-api-key`
- **Query Parameters**: `sessionId` *(required, string)*
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "code": "C7Xz8yA1b2c",
      "inviteUrl": "https://chat.whatsapp.com/C7Xz8yA1b2c"
    }
  }
  ```

#### `POST /api/v1/groups/:groupJid/revoke-invite`
Revokes active invite code and generates a new one.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`): `sessionId` *(required, string)*
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "code": "D9Yz9zA2b3d",
      "message": "Invite code revoked and regenerated"
    }
  }
  ```

#### `POST /api/v1/groups/accept-invite`
Joins a group using an invite code string.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `code` *(required, string)*: Invite code (e.g. `"C7Xz8yA1b2c"`).
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": { "groupJid": "123456789-987654@g.us" }
  }
  ```

#### `GET /api/v1/groups/invite-info/:code`
Inspects group metadata from an invite code prior to joining.

- **Auth**: Header `x-api-key`
- **Query Parameters**: `sessionId` *(required, string)*
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "id": "123456789-987654@g.us",
      "subject": "Public Community",
      "size": 150
    }
  }
  ```

#### `GET /api/v1/groups/:groupJid/join-requests`
Lists pending membership requests for groups with join approval enabled.

- **Auth**: Header `x-api-key`
- **Query Parameters**: `sessionId` *(required, string)*
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "requests": [
        { "jid": "2348011223344@s.whatsapp.net", "request_method": "invite_link" }
      ]
    }
  }
  ```

#### `POST /api/v1/groups/:groupJid/join-requests`
Approves or rejects pending membership join requests.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `participants` *(required, array of strings)*: User JIDs or phone numbers to approve/reject.
  - `action` *(required, string)*: `"approve"` or `"reject"`.
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": { "message": "Join requests processed" }
  }
  ```

---

### 3.10 Channels & Newsletters (`/api/v1/channels/*`)

Supports WhatsApp Channels (Newsletters) for broad public broadcasting, administrative lifecycle management, subscriber tracking, and message history.

#### Channel Publishing Endpoints (Asynchronous Outbox `202 Accepted`)
Channel message broadcasts are enqueued into the Outbox and complete immediately upon dispatch (`DELIVERED_TO_SERVER`):
- `POST /api/v1/channels/:channelJid/send/text`: `{ sessionId, message }`
- `POST /api/v1/channels/:channelJid/send/media`: `{ sessionId, mediaType, mediaUrl, caption? }`
- `POST /api/v1/channels/:channelJid/send/file`: Multipart `file` + `{ sessionId, caption? }`

#### `POST /api/v1/channels`
Creates a new WhatsApp Channel / Newsletter.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `name` *(required, string)*: Channel name.
  - `description` *(optional, string)*: Channel description.
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "channel": {
        "id": "120363044455566677@newsletter",
        "name": "Acme Product Updates",
        "invite": "https://whatsapp.com/channel/..."
      }
    }
  }
  ```

#### `GET /api/v1/channels/:key`
Retrieves channel metadata by channel JID (`@newsletter`) or invite code.

- **Auth**: Header `x-api-key`
- **Query Parameters**:
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `type` *(optional, string)*: `"jid"` (default) or `"invite"`.
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "id": "120363044455566677@newsletter",
      "name": "Acme Product Updates",
      "description": "Official company updates",
      "subscribers": 12500
    }
  }
  ```

#### `PATCH /api/v1/channels/:channelJid`
Updates channel name, description, or icon picture (supports multipart file or JSON `pictureUrl`).

- **Auth**: Header `x-api-key`
- **Parameters**: `sessionId`, `name?`, `description?`, `pictureUrl?`, `file?`
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": { "message": "Channel updated successfully" }
  }
  ```

#### `DELETE /api/v1/channels/:channelJid/picture`
Removes channel picture icon.

- **Auth**: Header `x-api-key`
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": { "message": "Channel picture removed" }
  }
  ```

#### `DELETE /api/v1/channels/:channelJid`
Deletes a channel permanently.

- **Auth**: Header `x-api-key`
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": { "message": "Channel deleted successfully" }
  }
  ```

#### Channel Subscription & Interaction Endpoints (Synchronous `200 OK`):
- `POST /api/v1/channels/:channelJid/follow`: Follow channel (`{ sessionId }`).
- `POST /api/v1/channels/:channelJid/unfollow`: Unfollow channel (`{ sessionId }`).
- `POST /api/v1/channels/:channelJid/mute`: Mute notifications (`{ sessionId }`).
- `POST /api/v1/channels/:channelJid/unmute`: Unmute notifications (`{ sessionId }`).
- `GET /api/v1/channels/:channelJid/subscribers`: Fetch subscriber list (`?sessionId=...`).
- `POST /api/v1/channels/:channelJid/messages/:serverId/react`: Emoji reaction to channel broadcast (`{ sessionId, emoji }`).
- `GET /api/v1/channels/:channelJid/messages`: Retrieve historical messages (`?sessionId=...&count=...&since=...&after=...`).
- `POST /api/v1/channels/:channelJid/subscribe-updates`: Subscribe to live channel updates (`{ sessionId }`).
- `GET /api/v1/channels/:channelJid/admin-count`: Retrieve admin count (`?sessionId=...`).
- `POST /api/v1/channels/:channelJid/change-owner`: Transfer channel ownership (`{ sessionId, newOwnerJid }`).
- `POST /api/v1/channels/:channelJid/demote`: Demote channel admin (`{ sessionId, userJid }`).

---

### 3.11 Status Stories & Broadcasts (`/api/v1/status/*`)

Publish WhatsApp Status stories (disappearing 24-hour broadcasts). All dispatches route through the durable Outbox (`recipientJid: "status@broadcast"`) returning `202 Accepted`.

#### `POST /api/v1/status/text`
Publishes a text status story with customizable background color and typography font index.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `message` *(required, string)*: Text content for status story.
  - `statusJidList` *(required, array of strings)*: Non-empty array of contact phone numbers or JIDs permitted to view the status.
  - `backgroundColor` *(optional, string)*: Hex color code (e.g. `"#FF5733"`).
  - `font` *(optional, integer)*: Baileys font family index (`1` to `5`).
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb070",
      "messageId": "3EB091AE751D87AE",
      "remoteJid": "status@broadcast",
      "status": "queued",
      "message": "Status queued for delivery"
    }
  }
  ```

#### `POST /api/v1/status/media`
Publishes an image or video status story from a remote public URL (SSRF protected).

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `mediaType` *(required, string)*: `"image"` or `"video"`.
  - `mediaUrl` *(required, string)*: Public media URL.
  - `caption` *(optional, string)*: Caption for story.
  - `statusJidList` *(required, array of strings)*: Permitted recipient contacts.
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb071",
      "messageId": "3EB091AE751D87AF",
      "status": "queued",
      "message": "Status media queued for delivery"
    }
  }
  ```

#### `POST /api/v1/status/file`
Uploads and publishes a binary media file (image/video) as a status story.

- **Auth**: Header `x-api-key`
- **Content-Type**: `multipart/form-data`
- **Form Fields**: `sessionId`, `caption?`, `statusJidList` (JSON array or comma-separated string), `file` (binary payload max 25MB).
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb072",
      "messageId": "3EB091AE751D87B0",
      "remoteJid": "status@broadcast",
      "status": "queued",
      "message": "Status file queued for delivery"
    }
  }
  ```

#### `POST /api/v1/status/voice`
Uploads and publishes an audio voice note status story.

- **Auth**: Header `x-api-key`
- **Content-Type**: `multipart/form-data`
- **Form Fields**: `sessionId`, `statusJidList`, `backgroundColor?`, `file` (audio binary payload).
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb073",
      "messageId": "3EB091AE751D87B1",
      "remoteJid": "status@broadcast",
      "status": "queued",
      "message": "Status voice note queued for delivery"
    }
  }
  ```

#### `DELETE /api/v1/status/:messageId`
Revokes/deletes a previously published status story before its 24-hour expiration. Completes immediately upon socket execution.

- **Auth**: Header `x-api-key`
- **Path Parameters**: `messageId` *(required, string)*: WhatsApp message ID of status story to delete.
- **Request Body / Query**: `sessionId` *(required, string)*, `statusJidList` *(optional)*.
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb074",
      "status": "queued",
      "message": "Status delete action queued for delivery"
    }
  }
  ```

---

### 3.12 Profile & Privacy Management (`/api/v1/profile/*`)

Synchronous control plane endpoints (`200 OK`) for managing account identity and privacy boundaries.

- `PATCH /api/v1/profile/name`: Updates WhatsApp display name (`{ sessionId, name }`).
- `PATCH /api/v1/profile/status`: Updates "About" / status quote (`{ sessionId, status }`).
- `PUT /api/v1/profile/picture`: Updates profile photo via multipart `file` or JSON `{ sessionId, imageUrl }`.
- `DELETE /api/v1/profile/picture`: Removes account profile picture (`{ sessionId }`).
- `GET /api/v1/profile/privacy`: Fetches WhatsApp privacy settings for read receipts, online status, last seen, profile picture, status visibility (`?sessionId=...&force=true`).
- `PATCH /api/v1/profile/privacy`: Updates privacy settings (`{ sessionId, setting, value }`).

---

### 3.13 Contacts & Blocklist (`/api/v1/contacts/*`)

Synchronous control plane endpoints (`200 OK`) for querying WhatsApp phone registration, user profiles, and managing the account blocklist.

- `GET /api/v1/contacts/:phoneNumber/on-whatsapp`: Checks if a phone number is registered on WhatsApp (`?sessionId=...`).
- `GET /api/v1/contacts/:jid/profile`: Fetches public business/user profile details for a contact JID (`?sessionId=...`).
- `GET /api/v1/contacts/blocklist`: Retrieves list of blocked contact JIDs (`?sessionId=...`).
- `POST /api/v1/contacts/:jid/block`: Blocks a contact (`{ sessionId }`).
- `POST /api/v1/contacts/:jid/unblock`: Unblocks a contact (`{ sessionId }`).

---

### 3.14 Outbox Management & Queue Inspection

The Outbox API provides visibility into queued and dispatched dispatches, manual cancellation of un-sent messages, and retry capabilities for failed or cancelled jobs.

#### `GET /api/v1/outbox`
Lists Outbox documents belonging to the authenticated user using cursor-based pagination.

- **Auth**: Header `x-api-key`
- **Query Parameters**:
  - `sessionId` *(optional, string)*: Filter by WhatsApp session ID.
  - `status` *(optional, string)*: Filter by status: `QUEUED`, `PROCESSING`, `DISPATCHED`, `DELIVERED_TO_SERVER`, `FAILED_TERMINAL`, `CANCELLED`.
  - `after` *(optional, string)*: MongoDB `_id` cursor. Returns items created strictly after this ID.
  - `limit` *(optional, integer, default: `50`, max: `200`)*: Items per page.
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "_id": "6725225c57fa85b5420cb051",
          "userId": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
          "sessionId": "sales-line-1",
          "idempotencyKey": "text-job-12345",
          "waMessageId": "3EB091AE751D87A0",
          "recipientJid": "2348099887766@s.whatsapp.net",
          "actionType": "text",
          "payload": {
            "phoneNumber": "08099887766",
            "message": "Hello from the WhatsApp Gateway!"
          },
          "simulateTyping": true,
          "status": "DELIVERED_TO_SERVER",
          "attempts": 1,
          "maxAttempts": 6,
          "nextAttemptAt": "2026-11-01T20:00:00.000Z",
          "dispatchedAt": "2026-11-01T20:00:01.200Z",
          "completedAt": "2026-11-01T20:00:01.850Z",
          "lastError": null,
          "createdAt": "2026-11-01T20:00:00.000Z",
          "updatedAt": "2026-11-01T20:00:01.850Z"
        }
      ],
      "nextCursor": "6725225c57fa85b5420cb051",
      "hasMore": false
    }
  }
  ```

#### `GET /api/v1/outbox/:outboxId`
Inspects a single Outbox document by its MongoDB `ObjectId`.

- **Auth**: Header `x-api-key`
- **Path Parameters**: `outboxId` *(required, string)*
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "_id": "6725225c57fa85b5420cb051",
      "userId": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      "sessionId": "sales-line-1",
      "idempotencyKey": "text-job-12345",
      "waMessageId": "3EB091AE751D87A0",
      "recipientJid": "2348099887766@s.whatsapp.net",
      "actionType": "text",
      "payload": {
        "phoneNumber": "08099887766",
        "message": "Hello from the WhatsApp Gateway!"
      },
      "simulateTyping": false,
      "status": "DELIVERED_TO_SERVER",
      "attempts": 1,
      "maxAttempts": 6,
      "nextAttemptAt": "2026-11-01T20:00:00.000Z",
      "dispatchedAt": "2026-11-01T20:00:01.200Z",
      "completedAt": "2026-11-01T20:00:01.850Z",
      "lastError": null,
      "createdAt": "2026-11-01T20:00:00.000Z",
      "updatedAt": "2026-11-01T20:00:01.850Z"
    }
  }
  ```

#### `DELETE /api/v1/outbox/:outboxId`
Cancels an Outbox job before dispatch. Only items currently in `QUEUED` status may be cancelled. Unlinks staged disk files immediately.

- **Auth**: Header `x-api-key`
- **Path Parameters**: `outboxId` *(required, string)*
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb051",
      "status": "cancelled",
      "message": "Outbox item cancelled"
    }
  }
  ```

#### `POST /api/v1/outbox/:outboxId/retry`
Re-queues a failed or cancelled Outbox item for redelivery. Only items in `FAILED_TERMINAL` or `CANCELLED` status can be retried. Resets `attempts` to 0, sets status to `QUEUED`, and triggers immediate mailbox notification.

- **Auth**: Header `x-api-key`
- **Path Parameters**: `outboxId` *(required, string)*
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb051",
      "messageId": "3EB091AE751D87A0",
      "status": "queued",
      "message": "Outbox item re-queued for delivery"
    }
  }
  ```

---

### 3.15 Event Storage & Polling

Events (incoming messages, outbound delivery milestones, receipts, connection status changes, poll votes, and group/channel updates) are persisted to MongoDB with automatic TTL cleanup (3 days). Consumers poll `/api/v1/events` using cursor-based pagination.

#### Supported Event Types:
- **Core & Outbox**:
  - `connection`: Session socket state changes (`connected`, `connecting`, `reconnecting`, `degraded`, `disconnected`).
  - `qr`: Multi-device authentication QR code string updated.
  - `message`: Inbound message received from a user, group, or channel.
  - `message.update`: WhatsApp receipt updates (sent, delivered, read) and message updates.
  - `message.edited`: An existing message was edited by sender.
  - `message.delete`: A message was revoked / deleted.
  - `message.reaction`: Emoji reaction added or removed.
  - `poll.vote`: Automatically decrypted poll vote with selected plain-text options.
  - `message.sent`: Outbox message dispatched to WhatsApp edge servers.
  - `message.delivered`: Two-stage `SERVER_ACK` or immediate delivery confirmed.
  - `message.failed`: Terminal delivery failure with error details.
- **Groups**:
  - `group.upsert`: Group joined, created, or initial sync.
  - `group.update`: Group subject, description, or settings updated.
  - `group.participants`: Participant added, removed, promoted, or demoted.
  - `group.join_request`: Join request submitted by a prospective member.
- **Channels**:
  - `channel.reaction`: Reaction to channel message.
  - `channel.view`: Channel post view count update.
  - `channel.participants`: Channel subscriber count update.
  - `channel.settings`: Channel settings/profile modification.
- **Presence & Calls**:
  - `presence.update`: Contact presence state change.
  - `call`: Incoming call stanza notification.

#### `GET /api/v1/events`
Poll persisted WhatsApp events for the authenticated user.

- **Auth**: Header `x-api-key`
- **Query Parameters**:
  - `sessionId` *(string, optional)*: Filter events by session ID.
  - `eventType` *(string, optional)*: Filter by event type. Supports single event types (`message`), comma-separated lists (`message,poll.vote,group.participants`), or wildcard prefixes (`group.*`, `channel.*`, `message.*`, `*`).
  - `after` *(string, optional)*: MongoDB `_id` cursor for pagination. Returns events created strictly after this ID.
  - `limit` *(integer, optional, default: 50, max: 100)*: Maximum number of events to return.
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "events": [
        {
          "_id": "6724fa0e219ba3cb9e9ef402",
          "userId": "user-uuid-1234",
          "sessionId": "sales-line-1",
          "eventType": "poll.vote",
          "payload": {
            "pollMessageKey": {
              "remoteJid": "2348099887766@s.whatsapp.net",
              "id": "3EB091AE751D87A8",
              "fromMe": true
            },
            "voteMessageKey": {
              "remoteJid": "2348099887766@s.whatsapp.net",
              "id": "3EB0F492E31D99B2",
              "fromMe": false
            },
            "voterJid": "2348099887766@s.whatsapp.net",
            "selectedOptions": ["Morning (9am - 12pm)"],
            "timestampMs": 1730560000000
          },
          "createdAt": "2026-11-01T18:00:01.200Z"
        }
      ],
      "count": 1,
      "lastCursor": "6724fa0e219ba3cb9e9ef402"
    }
  }
  ```
- **Example cURL**:
  ```bash
  # Poll all group and message events with wildcard filters
  curl -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    "http://localhost:3000/api/v1/events?sessionId=sales-line-1&eventType=group.*,message.*&limit=50"

  # Subsequent poll using lastCursor
  curl -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    "http://localhost:3000/api/v1/events?sessionId=sales-line-1&after=6724fa0e219ba3cb9e9ef402"
  ```

#### `DELETE /api/v1/events`
Manually purge events for a specific session.

- **Auth**: Header `x-api-key`
- **Query Parameters**:
  - `sessionId` *(string, required)*: Session ID whose events should be cleared.
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "deletedCount": 12
    }
  }
  ```
