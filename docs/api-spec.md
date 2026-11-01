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

### 3.6 Messaging & Media Dispatch (Asynchronous Outbox)

All messaging dispatches are accepted asynchronously into the durable MongoDB Outbox with `202 Accepted`. Per-JID mailboxes (`ChatActor`) ensure sequential FIFO dispatch without cross-chat Head-of-Line blocking.

#### `POST /api/v1/send/text`
Queues a standard text message for delivery.

- **Auth**: Header `x-api-key`
- **Optional Headers**: `Idempotency-Key: <UUID>`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: Registered session ID.
  - `phoneNumber` *(required, string)*: Recipient phone number (e.g. `08099887766` or international format).
  - `message` *(required, string)*: Text content to deliver.
  - `simulateTyping` *(optional, boolean, default: `false`)*: When `true`, broadcasts a WhatsApp composing presence indicator for 1–2 seconds prior to sending the message.
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb051",
      "messageId": "3EB091AE751D87A0",
      "remoteJid": "2348099887766@s.whatsapp.net",
      "status": "queued",
      "idempotencyKey": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
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

#### `POST /api/v1/send/file`
Uploads and queues a binary media file (image, video, audio, or document) up to 25MB. Files are streamed directly to `data/outbox-media/` to protect V8 heap memory and unlinked automatically once server delivery ACK is verified.

- **Auth**: Header `x-api-key`
- **Optional Headers**: `Idempotency-Key: <UUID>`
- **Content-Type**: `multipart/form-data`
- **Form Fields**:
  - `sessionId` *(required, text)*: WhatsApp session ID.
  - `phoneNumber` *(required, text)*: Recipient phone number.
  - `caption` *(optional, text)*: Optional caption accompanying the file.
  - `simulateTyping` *(optional, boolean)*: Set to `"true"` to simulate composing before dispatch.
  - `file` *(required, binary file)*: Target file payload (max 25MB).
- **Supported MIME Types**:
  - Images: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
  - Videos: `video/mp4`, `video/3gpp`, `video/quicktime`
  - Audio: `audio/mp4`, `audio/mpeg`, `audio/ogg`, `audio/wav`
  - Documents: `application/pdf`, `text/plain`, `application/vnd.openxmlformats-officedocument.*`, etc.
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
    -F "simulateTyping=true" \
    -F "file=@/path/to/statement.pdf"
  ```

#### `POST /api/v1/send/media`
Queues media delivery from a remote public URL. The URL is resolved and checked against private/reserved IPv4 & IPv6 CIDRs to guard against SSRF attacks.

- **Auth**: Header `x-api-key`
- **Optional Headers**: `Idempotency-Key: <UUID>`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `phoneNumber` *(required, string)*: Recipient phone number.
  - `mediaType` *(required, string)*: One of `"image"`, `"video"`, `"audio"`, `"document"`.
  - `mediaUrl` *(required, string)*: Publicly reachable URL pointing to the media asset.
  - `caption` *(optional, string)*: Media caption.
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
      "caption": "Limited time offer!"
    }'
  ```

#### `POST /api/v1/send/voice`
Uploads and queues a Push-to-Talk (PTT) voice note. File must have an `audio/*` MIME type. Staged to `data/outbox-media/` and unlinked upon delivery ACK verification.

- **Auth**: Header `x-api-key`
- **Optional Headers**: `Idempotency-Key: <UUID>`
- **Content-Type**: `multipart/form-data`
- **Form Fields**:
  - `sessionId` *(required, text)*: WhatsApp session ID.
  - `phoneNumber` *(required, text)*: Recipient phone number.
  - `simulateTyping` *(optional, boolean)*: Set to `"true"` to broadcast typing presence.
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
    -F "simulateTyping=true" \
    -F "file=@/path/to/voice-note.ogg"
  ```

---

### 3.7 Contacts & Message Mutations

#### `GET /api/v1/contacts/:phoneNumber/on-whatsapp`
Verifies whether a given phone number is registered on WhatsApp.

- **Auth**: Header `x-api-key`
- **Path Parameters**: `phoneNumber` (string)
- **Query Parameters**: `sessionId` *(required, string)*
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "phoneNumber": "2348099887766",
      "exists": true
    }
  }
  ```

#### `POST /api/v1/messages/react`
Queues an emoji reaction to an existing message via the Outbox.

- **Auth**: Header `x-api-key`
- **Optional Headers**: `Idempotency-Key: <UUID>`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `messageId` *(required, string)*: Target WhatsApp message ID.
  - `remoteJid` *(required, string)*: Recipient or group JID.
  - `emoji` *(required, string)*: Emoji character (e.g. `"👍"`, `"❤️"`, or `""` to remove reaction).
  - `fromMe` *(optional, boolean)*: Whether the target message was originally sent by you.
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb055",
      "messageId": "3EB091AE751D87A4",
      "remoteJid": "2348099887766@s.whatsapp.net",
      "status": "queued",
      "idempotencyKey": "react-job-3344",
      "deduplicated": false,
      "message": "Reaction queued for delivery"
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X POST http://localhost:3000/api/v1/messages/react \
    -H "Content-Type: application/json" \
    -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    -d '{
      "sessionId": "sales-line-1",
      "messageId": "3EB04818F2F7D65",
      "remoteJid": "2348099887766@s.whatsapp.net",
      "emoji": "👍"
    }'
  ```

#### `POST /api/v1/messages/delete`
Queues a message revocation ("Delete for Everyone") via the Outbox.

- **Auth**: Header `x-api-key`
- **Optional Headers**: `Idempotency-Key: <UUID>`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `messageId` *(required, string)*: Target WhatsApp message ID.
  - `remoteJid` *(required, string)*: Recipient or group JID.
  - `fromMe` *(optional, boolean, default: `true`)*: Whether the message was sent by your account.
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb056",
      "messageId": "3EB091AE751D87A5",
      "remoteJid": "2348099887766@s.whatsapp.net",
      "status": "queued",
      "idempotencyKey": "delete-job-5566",
      "deduplicated": false,
      "message": "Delete action queued for delivery"
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X POST http://localhost:3000/api/v1/messages/delete \
    -H "Content-Type: application/json" \
    -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    -d '{
      "sessionId": "sales-line-1",
      "messageId": "3EB04818F2F7D65",
      "remoteJid": "2348099887766@s.whatsapp.net"
    }'
  ```

#### `POST /api/v1/messages/read`
Queues a read receipt to mark a message as read via the Outbox.

- **Auth**: Header `x-api-key`
- **Optional Headers**: `Idempotency-Key: <UUID>`
- **Request Body** (`application/json`):
  - `sessionId` *(required, string)*: WhatsApp session ID.
  - `messageId` *(required, string)*: Target WhatsApp message ID.
  - `remoteJid` *(required, string)*: Sender or group JID.
  - `fromMe` *(optional, boolean, default: `false`)*: Whether the message was from your account.
- **Success Response (`202 Accepted`)**:
  ```json
  {
    "success": true,
    "data": {
      "outboxId": "6725225c57fa85b5420cb057",
      "messageId": "3EB091AE751D87A6",
      "remoteJid": "2348099887766@s.whatsapp.net",
      "status": "queued",
      "idempotencyKey": "read-job-7788",
      "deduplicated": false,
      "message": "Read receipt queued for delivery"
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X POST http://localhost:3000/api/v1/messages/read \
    -H "Content-Type: application/json" \
    -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    -d '{
      "sessionId": "sales-line-1",
      "messageId": "3EB04818F2F7D65",
      "remoteJid": "2348099887766@s.whatsapp.net"
    }'
  ```

---

### 3.8 Outbox Management & Queue Inspection

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
- **Example cURL**:
  ```bash
  # List all queued items for a session
  curl -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    "http://localhost:3000/api/v1/outbox?sessionId=sales-line-1&status=QUEUED&limit=25"

  # Forward pagination using nextCursor
  curl -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    "http://localhost:3000/api/v1/outbox?sessionId=sales-line-1&after=6725225c57fa85b5420cb051&limit=25"
  ```

#### `GET /api/v1/outbox/:outboxId`
Inspects a single Outbox document by its MongoDB `ObjectId`.

- **Auth**: Header `x-api-key`
- **Path Parameters**:
  - `outboxId` *(required, string)*: Valid 24-character hexadecimal MongoDB `ObjectId`.
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
- **Error Response (`404 Not Found`)**:
  ```json
  {
    "success": false,
    "error": {
      "code": 404,
      "message": "Outbox item not found"
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    "http://localhost:3000/api/v1/outbox/6725225c57fa85b5420cb051"
  ```

#### `DELETE /api/v1/outbox/:outboxId`
Cancels an Outbox job before dispatch. Only items currently in `QUEUED` status may be cancelled. If a staged media file exists on disk (`data/outbox-media/`), it is automatically unlinked.

- **Auth**: Header `x-api-key`
- **Path Parameters**:
  - `outboxId` *(required, string)*: Outbox document ID.
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
- **Conflict Response (`409 Conflict`)**:
  If the item has already transitioned to `PROCESSING`, `DISPATCHED`, or `DELIVERED_TO_SERVER`:
  ```json
  {
    "success": false,
    "error": {
      "code": 409,
      "message": "Cannot cancel outbox item in status DISPATCHED"
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X DELETE -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    "http://localhost:3000/api/v1/outbox/6725225c57fa85b5420cb051"
  ```

#### `POST /api/v1/outbox/:outboxId/retry`
Re-queues a failed or cancelled Outbox item for redelivery. Only items in `FAILED_TERMINAL` or `CANCELLED` status can be retried. Resets `attempts` to 0, sets status to `QUEUED`, and triggers immediate mailbox notification.

- **Auth**: Header `x-api-key`
- **Path Parameters**:
  - `outboxId` *(required, string)*: Outbox document ID.
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
- **Conflict Response (`409 Conflict`)**:
  If the item is not in `FAILED_TERMINAL` or `CANCELLED` state:
  ```json
  {
    "success": false,
    "error": {
      "code": 409,
      "message": "Only FAILED_TERMINAL or CANCELLED items can be retried (current: DELIVERED_TO_SERVER)"
    }
  }
  ```
- **Gone Response (`410 Gone`)**:
  If the item was a binary file/voice note whose staged disk file has already been unlinked:
  ```json
  {
    "success": false,
    "error": {
      "code": 410,
      "message": "Staged media file has already been cleaned up; please upload and send the file again"
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X POST -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    "http://localhost:3000/api/v1/outbox/6725225c57fa85b5420cb051/retry"
  ```

---

### 3.9 Event Storage & Polling

Events (incoming messages, outbound delivery milestones, receipts, connection status changes, and QR codes) are persisted to MongoDB with automatic TTL cleanup (3 days). Consumers poll `/api/v1/events` using cursor-based pagination.

#### Supported Event Types:
| `eventType` | Trigger / Description |
|---|---|
| `message` | Inbound message received from a WhatsApp user or group chat. |
| `message.sent` | Outbox message dispatched to the WhatsApp socket connection (awaiting server ACK). |
| `message.delivered` | WhatsApp server receipt ACK received; Outbox job transitioned to `DELIVERED_TO_SERVER`. |
| `message.failed` | Outbox message failed terminally (max attempts exceeded or non-retriable error like SSRF / non-WhatsApp recipient). |
| `message.update` | WhatsApp receipt update (delivery, read receipts from peers). |
| `connection` | Session socket state change (`connected`, `connecting`, `reconnecting`, `degraded`, `disconnected`). |
| `qr` | Multi-device authentication QR code string updated. |

#### `GET /api/v1/events`
Poll persisted WhatsApp events for the authenticated user.

- **Auth**: Header `x-api-key`
- **Query Parameters**:
  - `sessionId` *(string, optional)*: Filter events by session ID.
  - `eventType` *(string, optional)*: Filter by event type (`message`, `message.sent`, `message.delivered`, `message.failed`, `message.update`, `connection`, `qr`).
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
          "eventType": "message.sent",
          "payload": {
            "outboxId": "6725225c57fa85b5420cb051",
            "messageId": "3EB091AE751D87A0",
            "remoteJid": "2348099887766@s.whatsapp.net",
            "actionType": "text",
            "status": "DISPATCHED"
          },
          "createdAt": "2026-11-01T18:00:01.200Z"
        },
        {
          "_id": "6724fa0e219ba3cb9e9ef403",
          "userId": "user-uuid-1234",
          "sessionId": "sales-line-1",
          "eventType": "message.delivered",
          "payload": {
            "outboxId": "6725225c57fa85b5420cb051",
            "messageId": "3EB091AE751D87A0",
            "remoteJid": "2348099887766@s.whatsapp.net",
            "actionType": "text",
            "status": "DELIVERED_TO_SERVER"
          },
          "createdAt": "2026-11-01T18:00:01.850Z"
        },
        {
          "_id": "6724fa0e219ba3cb9e9ef404",
          "userId": "user-uuid-1234",
          "sessionId": "sales-line-1",
          "eventType": "message.failed",
          "payload": {
            "outboxId": "6725225c57fa85b5420cb099",
            "messageId": "3EB091AE751D8799",
            "remoteJid": "2348099887799@s.whatsapp.net",
            "actionType": "text",
            "status": "FAILED_TERMINAL",
            "error": "Number 2348099887799 is not registered on WhatsApp"
          },
          "createdAt": "2026-11-01T18:05:00.000Z"
        }
      ],
      "count": 3,
      "lastCursor": "6724fa0e219ba3cb9e9ef404"
    }
  }
  ```
- **Example cURL**:
  ```bash
  # Initial poll for delivered messages
  curl -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    "http://localhost:3000/api/v1/events?sessionId=sales-line-1&eventType=message.delivered&limit=50"

  # Subsequent poll using lastCursor
  curl -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    "http://localhost:3000/api/v1/events?sessionId=sales-line-1&after=6724fa0e219ba3cb9e9ef404"
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
