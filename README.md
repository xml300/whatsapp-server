# WhatsApp Gateway Server

[![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-blue.svg)](https://www.typescriptlang.org)
[![Express](https://img.shields.io/badge/Express-5.2.1-lightgrey.svg)](https://expressjs.com)
[![Baileys](https://img.shields.io/badge/Baileys-7.0.0--rc.9-green.svg)](https://github.com/WhiskeySockets/Baileys)
[![License: ISC](https://img.shields.io/badge/License-ISC-yellow.svg)](https://opensource.org/licenses/ISC)

A production-ready, multi-session WhatsApp Gateway REST API server built with **Express 5**, **TypeScript**, **MongoDB**, and **@whiskeysockets/baileys**. It enables seamless integration of WhatsApp messaging, media dispatch, and real-time event streaming into your backend services and workflows.

---

## Key Features

- 📬 **Durable MongoDB Outbox & Actor Mailbox Engine**:
  - **Asynchronous Acceptance**: All messaging and mutation endpoints return `202 Accepted` immediately with durable job tracking metadata (`outboxId`, `messageId`, `status`).
  - **Transparent Deduplication**: Optional `Idempotency-Key` header prevents duplicate dispatches upon network retries and returns existing Outbox jobs with `deduplicated: true`.
  - **Per-JID Sequential FIFO Ordering (`ChatActor`, `concurrency: 1`)**: Dedicated per-chat mailboxes guarantee strict FIFO dispatch order per recipient, preventing Signal Double-Ratchet cryptographic state desynchronization without causing cross-chat Head-of-Line blocking.
  - **Anti-Ban Protection & Rate Limiting**: Sliding-window token-bucket rate limiter per session (`OUTBOX_RATE_LIMIT_PER_MIN`), humanized random jitter (300–800ms), and optional realistic typing presence simulation (`simulateTyping: true`).
  - **Two-Stage `SERVER_ACK` Verification**: Dispatched messages transition from `DISPATCHED` to `DELIVERED_TO_SERVER` only upon WhatsApp server receipts (`message-receipt.update`), with automated replay upon ACK timeout (`OUTBOX_ACK_TIMEOUT_MS`) or socket drops.
  - **Zero-Memory Disk-Staging**: Binary uploads staged directly to disk (`data/outbox-media/`) via Multer streaming up to 25MB without holding binary buffers in Node.js V8 memory.
- 🔄 **Cold-Start Recovery & Graceful Shutdown**: Database-backed `desiredState` reconciliation in the MongoDB `Session` collection, surviving `SIGKILL` / OOM container restarts without relying solely on `data/sessions.json`.
- 🔌 **Infinite Self-Healing Connection FSM**: Connection state machine automatically self-heals by transitioning from fast exponential backoff (`RECONNECTING`, attempts 1–5) to 60-second circuit-breaker probes in `DEGRADED` state.
- 📱 **Multi-Session & Multi-Device Management**: Run and manage multiple concurrent WhatsApp client sessions on a single server instance.
- 🔐 **Dual-Tier Authentication**:
  - **Admin Web Tier**: Secure JWT cookie-based auth (`auth_token`) for user registration, session provisioning, and API key generation.
  - **Programmatic Gateway Tier**: Header-based API key auth (`x-api-key`) for automated bot or microservice communication.
- ⚡ **Flexible WhatsApp Linking**:
  - **QR Code**: Retrieve real-time QR code strings for app scanning.
  - **8-Digit Pairing Code**: Link WhatsApp Web via phone number without scanning a QR code.
- 💬 **Rich Messaging & Mutation Suite**:
  - Plain text messages with optional typing simulation.
  - Public media URL dispatches with SSRF validation.
  - Multipart binary media uploads (images, audio, video, documents) up to 25MB.
  - Push-to-Talk (PTT) voice note delivery.
  - Message reactions (emojis), message deletions (revoke for everyone), and read receipts.
- 📥 **Durable Event Storage & Polling**: Persist incoming WhatsApp messages, receipts, connection lifecycle transitions, and outbox delivery milestones (`message.sent`, `message.delivered`, `message.failed`) to MongoDB with automatic TTL pruning, retrievable via cursor-based polling (`/api/v1/events`).
- 🛡️ **SSRF Media Protection**: Built-in DNS resolver and private/reserved IPv4 & IPv6 CIDR blacklist to guard against Server-Side Request Forgery.
- 💾 **MongoDB Auth & Key Store**: Custom NoSQL Baileys auth store persisting Signal Protocol cryptographic keys and multi-device credentials.

---

## Architecture Overview

```
+---------------------------------------------------------------------------------------------------+
|                                           HTTP Clients                                            |
|                  (Admin / Web UI via JWT Cookie | Service / API via x-api-key)                    |
|                        Optional Header: Idempotency-Key: <UUID / Custom>                          |
+-------------------------------------------------+-------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                      Express 5 HTTP Layer                                         |
|   - loggingMiddleware (latency & HTTP status colorized logging)                                   |
|   - cookieParser, express.json, express.urlencoded, cors                                          |
|   - validate Middleware (declarative rule engine with regex & type checks)                        |
|   - Multer Disk-Staging: streams media files directly to data/outbox-media/ (Zero V8 RAM buffer) |
+------------------------+-------------------------------------------------+------------------------+
                         |                                                 |
       [Cookie JWT Auth: userAuthMiddleware]                     [API Key Auth: authMiddleware]
                         |                                                 |
      +------------------+------------------+             +----------------+----------------+
      |                  |                  |             |                |                |
      v                  v                  v             v                v                v
   /auth             /api-keys          /sessions     /connection     /send/* &         /events &
  (login/reg)       (gen/list)         (create/list)   (QR/pair/end)   /messages/*       /outbox
                                                                      (202 Accepted)   (poll/inspect)
                                                                           |
                                                                           v
+---------------------------------------------------------------------------------------------------+
|                                      Durable MongoDB Outbox                                       |
|   - Atomic Enqueue & Transparent Deduplication via (sessionId + idempotencyKey)                  |
|   - Job lifecycle: QUEUED -> PROCESSING -> DISPATCHED -> DELIVERED_TO_SERVER / FAILED_TERMINAL   |
+-------------------------------------------------+-------------------------------------------------+
                                                  |
                                                  v (event notification / sweep poll)
+---------------------------------------------------------------------------------------------------+
|                                           OutboxEngine                                            |
|   +-------------------------------------------------------------------------------------------+   |
|   |                         SessionRateLimiter (Sliding-Window Token Bucket)                  |   |
|   |         - OUTBOX_RATE_LIMIT_PER_MIN tokens per rolling 60s per active WhatsApp session   |   |
|   +-------------------------------------------------------------------------------------------+   |
|   |                   ChatActor (Per-JID Sequential Mailbox Workers, concurrency: 1)           |   |
|   |  [Recipient JID 1 Mailbox]      [Recipient JID 2 Mailbox]      [Recipient JID N Mailbox]  |   |
|   |  - Strict FIFO order            - Strict FIFO order            - Strict FIFO order        |   |
|   |  - Prevents Double-Ratchet      - Prevents Double-Ratchet      - Independent throughput   |   |
|   |    desynchronization               desynchronization             (No Head-of-Line block)  |   |
|   |  - Humanized Jitter &           - Humanized Jitter &           - Humanized Jitter &       |   |
|   |    Typing Presence (simulateTyping)                              Typing Presence          |   |
|   +-------------------------------------------------------------------------------------------+   |
|   - Two-Stage SERVER_ACK Tracker: Listens to message-receipt.update, unlinks staged media file    |
|   - Replay Watchdog: Re-queues on ACK timeout (OUTBOX_ACK_TIMEOUT_MS) or socket drops             |
+-------------------------------------------------+-------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                    WhatsappManager (Singleton)                                    |
|   - Map<sessionId, WhatsappService> active sockets                                                |
|   - Map<sessionId, Promise<void>> isConnecting (Inflight Concurrency Guard)                       |
|   - Cold-Start Recovery: Reconciles Session.desiredState from MongoDB on boot                     |
+-------------------------------------------------+-------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                   WhatsappService (Per Session)                                   |
|   - Baileys makeWASocket instance                                                                 |
|   - Infinite Reconnection FSM: fast backoff (RECONNECTING, 1-5) -> circuit-breaker (DEGRADED, 60s) |
|   - SSRF-protected Media URL Validator (DNS + private/reserved CIDR blacklist)                    |
+------------------------+-------------------------------------------------+------------------------+
                         |                                                 |
                         v                                                 v
+---------------------------------------------------+    +------------------------------------------+
|                 MongoDB (Mongoose)                |    |          WhatsApp Multi-Device           |
| - Users, ApiKeys, Sessions (with desiredState)    |    |             Network Servers              |
| - Outbox (Durable queue, retry counters, status)  |    |        (Noise / Signal Protocol /        |
| - Events (TTL-backed cursor polling stream)       |    |         Double-Ratchet Sessions)         |
| - Credential & KeyStore (Signal cryptographic keys)|    +------------------------------------------+
| - Log (Buffered HTTP & app logs)                  |
| - File Disk Staging: data/outbox-media/           |
+---------------------------------------------------+
```

---

## Quick Start

### 1. Running with Docker Compose (Recommended)

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd whatsapp-server
   ```

2. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

3. Launch the containerized services:
   ```bash
   docker compose up -d --build
   ```

4. Verify server health:
   ```bash
   curl http://localhost:3000/api/health
   ```

---

### 2. Running Locally with Node.js & npm

#### Prerequisites
- **Node.js**: v20.x or v22.x LTS
- **MongoDB**: v6.0+ running on `localhost:27017`

#### Installation & Development
```bash
# Install dependencies
npm install

# Setup environment variables
cp .env.example .env

# Run development server with live reload (tsx)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | Port on which the HTTP server listens (`0.0.0.0`) |
| `NODE_ENV` | No | `development` | Runtime mode (`development`, `production`, `test`) |
| `MONGODB_URL` | **Yes** | — | MongoDB connection string (e.g. `mongodb://localhost:27017/whatsapp-server`) |
| `JWT_SECRET` | **Yes** | — | Secret string used for signing and verifying administrative JWT cookies |
| `OUTBOX_RATE_LIMIT_PER_MIN` | No | `20` | Sliding-window maximum dispatch token limit per session per rolling 60 seconds |
| `OUTBOX_ACK_TIMEOUT_MS` | No | `20000` | Timeout in milliseconds to await WhatsApp server delivery receipt before replaying |
| `OUTBOX_SWEEP_INTERVAL_MS` | No | `5000` | Periodic background sweep interval (ms) for processing queued/backoff jobs |
| `OUTBOX_MAX_ATTEMPTS` | No | `6` | Maximum dispatch attempts before marking an outbox job as `FAILED_TERMINAL` |

---

## API Summary

### Platform APIs (`/api/*`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | None | Health check & list of active in-memory session IDs |
| `GET` | `/api/logs` | `CookieAuth` | Paginated application & HTTP logs |
| `POST` | `/api/auth/register` | None | Register an admin user & receive `auth_token` cookie |
| `POST` | `/api/auth/login` | None | Authenticate admin user & receive `auth_token` cookie |
| `GET` | `/api/api-keys` | `CookieAuth` | List all API keys for authenticated user |
| `POST` | `/api/api-keys/generate` | `CookieAuth` | Generate a new UUID v4 API key |
| `GET` | `/api/sessions` | `CookieAuth` | List all registered WhatsApp sessions |
| `POST` | `/api/sessions` | `CookieAuth` | Register a new WhatsApp phone number session |

### Messaging Gateway APIs (`/api/v1/*`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/connection` | `ApiKeyAuth` | Connect WhatsApp socket for a session |
| `GET` | `/api/v1/connection/:sessionId/status` | `ApiKeyAuth` | Get socket connection state (`connected`, `reconnecting`, etc.) & pairing readiness |
| `GET` | `/api/v1/connection/:sessionId/qr` | `ApiKeyAuth` | Get WhatsApp QR code string |
| `GET` | `/api/v1/connection/:sessionId/pairing-code` | `ApiKeyAuth` | Get 8-digit WhatsApp pairing code |
| `POST` | `/api/v1/connection/:sessionId/end` | `ApiKeyAuth` | Gracefully disconnect a session socket |
| `POST` | `/api/v1/send/text` | `ApiKeyAuth` | Queue text message delivery (`202 Accepted` with outbox job metadata) |
| `POST` | `/api/v1/send/typing` | `ApiKeyAuth` | Send direct typing / composing presence indicator |
| `POST` | `/api/v1/send/file` | `ApiKeyAuth` | Upload & queue binary media up to 25MB (`202 Accepted` with outbox job metadata) |
| `POST` | `/api/v1/send/media` | `ApiKeyAuth` | Queue media dispatch from public URL (`202 Accepted` with outbox job metadata) |
| `POST` | `/api/v1/send/voice` | `ApiKeyAuth` | Upload & queue PTT voice note (`202 Accepted` with outbox job metadata) |
| `GET` | `/api/v1/contacts/:phoneNumber/on-whatsapp` | `ApiKeyAuth` | Check if a phone number exists on WhatsApp |
| `POST` | `/api/v1/messages/react` | `ApiKeyAuth` | Queue emoji reaction on a message (`202 Accepted` with outbox job metadata) |
| `POST` | `/api/v1/messages/delete` | `ApiKeyAuth` | Queue message revoke/delete for everyone (`202 Accepted` with outbox job metadata) |
| `POST` | `/api/v1/messages/read` | `ApiKeyAuth` | Queue mark-as-read receipt (`202 Accepted` with outbox job metadata) |
| `GET` | `/api/v1/outbox` | `ApiKeyAuth` | Cursor-paginated listing of outbox jobs (filter by `sessionId`, `status`, `after`, `limit`) |
| `GET` | `/api/v1/outbox/:outboxId` | `ApiKeyAuth` | Retrieve single outbox job document by ID |
| `DELETE` | `/api/v1/outbox/:outboxId` | `ApiKeyAuth` | Cancel a `QUEUED` outbox job and unlink staged file (`200 OK` or `409 Conflict`) |
| `POST` | `/api/v1/outbox/:outboxId/retry` | `ApiKeyAuth` | Re-queue a `FAILED_TERMINAL` or `CANCELLED` outbox item (`202 Accepted`) |
| `GET` | `/api/v1/events` | `ApiKeyAuth` | Poll persisted WhatsApp & delivery events (`message.sent`, `message.delivered`, `message.failed`) |
| `DELETE` | `/api/v1/events` | `ApiKeyAuth` | Clear persisted events for a session |

---

## Documentation Suite

For comprehensive guides and technical deep-dives, refer to the documentation in `docs/` and `api-specs/`:

- 📖 **[API Specification & Reference](file:///root/whatsapp-server/docs/api-spec.md)**: Full endpoint reference with parameter schemas, outbox lifecycle, error codes, and cURL snippets.
- ⚙️ **[OpenAPI 3.0.3 Specification](file:///root/whatsapp-server/api-specs/openapi.yaml)**: Machine-readable OpenAPI / Swagger spec.
- 🏗️ **[System Architecture & Design](file:///root/whatsapp-server/docs/system-architecture.md)**: In-depth system design, Baileys socket lifecycle, state machines, and Mermaid diagrams.
- 🗄️ **[Data Models & Persistence](file:///root/whatsapp-server/docs/data-models.md)**: Mongoose schemas, NoSQL auth store serialization, in-memory structures, and ER diagrams.
- 🚀 **[Deployment & Operations Guide](file:///root/whatsapp-server/docs/deployment.md)**: Docker, Docker Compose, PM2, NGINX/Caddy reverse proxy setups, persistent volumes, and health monitoring.

---

## License

This project is licensed under the **ISC License**.
