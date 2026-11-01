# WhatsApp Server API Specification Reference

This document provides a comprehensive reference for the WhatsApp Server REST API (v1), including authentication schemes, request parameters, response structures, Server-Sent Events (SSE) streaming, and cURL examples.

---

## 1. Authentication Schemes

The WhatsApp Server implements a dual-tier authentication architecture:

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

---

## 2. Standard Response Format

All JSON endpoints adhere to the following payload schema:

### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": { ... }
}
```

### Error Response (`4xx` / `5xx`)
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
        "message": "[POST] /api/v1/send/text - 200 OK (34ms)",
        "level": "INFO",
        "timestamp": "2026-08-16T15:30:00.000Z"
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
        "createdAt": "2026-08-16T12:00:00.000Z"
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
        "createdAt": "2026-08-16T12:00:00.000Z"
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
          "createdAt": "2026-08-16T12:05:00.000Z",
          "updatedAt": "2026-08-16T12:05:00.000Z"
        }
      ]
    }
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
          "phoneNumber": "2348012345678"
        }
      ]
    }
  }
  ```

#### `POST /api/sessions`
Creates a new session for a given phone number. Normalizes phone numbers (e.g. `08012345678` -> `2348012345678`).

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
Initializes a Baileys WebSocket instance for the specified session and phone number.

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
Queries the active socket connection state and pairing readiness.

- **Auth**: Header `x-api-key`
- **Path Parameters**: `sessionId` (string)
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "isConnected": true,
      "isPairingReady": false
    }
  }
  ```

#### `GET /api/v1/connection/:sessionId/qr`
Retrieves the raw QR code string emitted by WhatsApp multi-device handshake.

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
Terminates the WhatsApp connection and cleans up active socket resources.

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

### 3.6 Messaging & Media Dispatch

#### `POST /api/v1/send/text`
Sends a standard text message.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  ```json
  {
    "sessionId": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "phoneNumber": "08099887766",
    "message": "Hello from the WhatsApp Gateway!"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "message": "Message sent successfully"
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X POST http://localhost:3000/api/v1/send/text \
    -H "Content-Type: application/json" \
    -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    -d '{
      "sessionId": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "phoneNumber": "08099887766",
      "message": "Hello from the WhatsApp Gateway!"
    }'
  ```

#### `POST /api/v1/send/typing`
Sends a typing / composing presence indicator to the recipient chat.

- **Auth**: Header `x-api-key`
- **Request Body** (`application/json`):
  ```json
  {
    "sessionId": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "phoneNumber": "08099887766"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "message": "Typing sent successfully"
    }
  }
  ```

#### `POST /api/v1/send/file`
Uploads and sends a binary media file (Image, Video, Audio, or Document) up to 25MB.

- **Auth**: Header `x-api-key`
- **Content-Type**: `multipart/form-data`
- **Form Fields**:
  - `sessionId` *(required, text)*: WhatsApp session ID.
  - `phoneNumber` *(required, text)*: Recipient phone number.
  - `caption` *(optional, text)*: Media caption.
  - `file` *(required, binary file)*: Target file (max 25MB).
- **Supported MIME Types**:
  - Images: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
  - Videos: `video/mp4`, `video/3gpp`, `video/quicktime`
  - Audio: `audio/mp4`, `audio/mpeg`, `audio/ogg`, `audio/wav`
  - Documents: `application/pdf`, `text/plain`, `application/vnd.openxmlformats-officedocument.*`, etc.
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "message": "File sent successfully"
    }
  }
  ```
- **Example cURL**:
  ```bash
  curl -X POST http://localhost:3000/api/v1/send/file \
    -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    -F "sessionId=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" \
    -F "phoneNumber=08099887766" \
    -F "caption=Invoice for August 2026" \
    -F "file=@/path/to/invoice.pdf"
  ```

---

### 3.7 Event Storage & Polling

Events (incoming messages, message receipts, connection status changes, and QR codes) are persisted to MongoDB with automatic TTL cleanup (3 days). Consumers poll `/api/v1/events` using cursor-based pagination.

#### `GET /api/v1/events`
Poll persisted WhatsApp events for the authenticated user.

- **Auth**: Header `x-api-key`
- **Query Parameters**:
  - `sessionId` *(string, optional)*: Filter events by session ID.
  - `eventType` *(string, optional)*: Filter by event type (`message`, `message.update`, `connection`, `qr`).
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
          "eventType": "message",
          "payload": {
            "key": {
              "remoteJid": "2348099887766@s.whatsapp.net",
              "fromMe": false,
              "id": "3EB04818F2F7D65"
            },
            "message": {
              "conversation": "Hello! Thanks for your order."
            },
            "messageTimestamp": 1723819200
          },
          "createdAt": "2026-11-01T18:00:00.000Z"
        }
      ],
      "count": 1,
      "lastCursor": "6724fa0e219ba3cb9e9ef402"
    }
  }
  ```
- **Example cURL**:
  ```bash
  # Initial poll
  curl -H "x-api-key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \
    "http://localhost:3000/api/v1/events?sessionId=sales-line-1&limit=50"

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
