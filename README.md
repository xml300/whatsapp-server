# WhatsApp Gateway Server

[![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-blue.svg)](https://www.typescriptlang.org)
[![Express](https://img.shields.io/badge/Express-5.2.1-lightgrey.svg)](https://expressjs.com)
[![Baileys](https://img.shields.io/badge/Baileys-7.0.0--rc.9-green.svg)](https://github.com/WhiskeySockets/Baileys)
[![License: ISC](https://img.shields.io/badge/License-ISC-yellow.svg)](https://opensource.org/licenses/ISC)

A production-ready, multi-session WhatsApp Gateway REST API server built with **Express 5**, **TypeScript**, **MongoDB**, and **@whiskeysockets/baileys**. It enables seamless integration of WhatsApp messaging, media dispatch, and real-time event streaming into your backend services and workflows.

---

## Key Features

- 📱 **Multi-Session & Multi-Device Management**: Run and manage multiple concurrent WhatsApp client sessions on a single server instance.
- 🔐 **Dual-Tier Authentication**:
  - **Admin Web Tier**: Secure JWT cookie-based auth (`auth_token`) for user registration, session provisioning, and API key generation.
  - **Programmatic Gateway Tier**: Header-based API key auth (`x-api-key`) for automated bot or microservice communication.
- ⚡ **Flexible WhatsApp Linking**:
  - **QR Code**: Retrieve real-time QR code strings for app scanning.
  - **8-Digit Pairing Code**: Link WhatsApp Web via phone number without scanning a QR code.
- 💬 **Rich Messaging & Dispatch**:
  - Send plain text messages.
  - Broadcast typing / composing presence indicators.
  - Upload & dispatch binary media files (images, audio, video, documents) up to 25MB via `multipart/form-data`.
- 📥 **Durable Event Storage & Polling**: Persist incoming WhatsApp messages, updates, and connection status events to MongoDB with automatic TTL pruning, retrievable via cursor-based polling (`/api/v1/events`).
- 🛡️ **SSRF Media Protection**: Built-in DNS resolver and private/reserved IPv4 & IPv6 CIDR blacklist to guard against Server-Side Request Forgery.
- 💾 **MongoDB Auth & Key Store**: Custom NoSQL Baileys auth store persisting Signal Protocol cryptographic keys and multi-device credentials.
- 🔄 **Cold-Start Recovery & Graceful Shutdown**: Automatic state serialization (`data/sessions.json`) and session re-hydration across server restarts.

---

## Architecture Overview

```
+-----------------------------------------------------------------------------------+
|                                  HTTP Clients                                     |
|             (Admin / Web UI via JWT Cookie | Service / API via x-api-key)         |
+----------------------------------------+------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                             Express 5 HTTP Layer                                  |
|   - loggingMiddleware (latency & HTTP status colorized logging)                   |
|   - cookieParser, express.json, express.urlencoded, cors                          |
|   - validate Middleware (declarative rule engine with regex & type checks)        |
+--------------------+-------------------------------------+------------------------+
                     |                                     |
    [Cookie JWT Auth: userAuthMiddleware]        [API Key Auth: authMiddleware]
                     |                                     |
     +---------------+---------------+        +------------+-------------+
     |               |               |        |            |             |
     v               v               v        v            v             v
  /auth         /api-keys        /sessions  /connection  /send/*      /events
 (login/reg)   (gen/list)       (create/list) (QR/pair) (txt/file)  (poll/cursor)
     +---------------+---------------+        +------------+-------------+
                     |                                     |
                     v                                     v
+-----------------------------------------------------------------------------------+
|                        WhatsappManager (Singleton)                                |
|   - Map<sessionId, WhatsappService> sockets                                       |
|   - Map<sessionId, Promise<void>> isConnecting (Inflight Concurrency Guard)       |
+------------------------------------+----------------------------------------------+
                                     |
                                     v
+-----------------------------------------------------------------------------------+
|                        WhatsappService (Per Session)                              |
|   - Baileys makeWASocket instance                                                 |
|   - Auto-reconnect exponential backoff (up to 5 retries)                          |
|   - SSRF-protected Media URL Validator (DNS + CIDR checks)                       |
+--------------------+-------------------------------------+------------------------+
                     |                                     |
                     v                                     v
+-----------------------------+               +-----------------------------+
|    MongoDB (Mongoose)       |               |     WhatsApp Multi-Device   |
| - Users, ApiKeys, Sessions  |               |       Network (Noise /      |
| - Credential (Baileys creds)|               |       Signal Protocol)      |
| - KeyStore (Signal keys)    |               +-----------------------------+
| - Log (batched db logs)     |
+-----------------------------+
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
| `GET` | `/api/v1/connection/:sessionId/status` | `ApiKeyAuth` | Get socket connection & pairing readiness status |
| `GET` | `/api/v1/connection/:sessionId/qr` | `ApiKeyAuth` | Get WhatsApp QR code string |
| `GET` | `/api/v1/connection/:sessionId/pairing-code` | `ApiKeyAuth` | Get 8-digit WhatsApp pairing code |
| `POST` | `/api/v1/connection/:sessionId/end` | `ApiKeyAuth` | Gracefully disconnect a session socket |
| `POST` | `/api/v1/send/text` | `ApiKeyAuth` | Send text message to a WhatsApp recipient |
| `POST` | `/api/v1/send/typing` | `ApiKeyAuth` | Send typing / composing presence indicator |
| `POST` | `/api/v1/send/file` | `ApiKeyAuth` | Upload & send binary media (images, docs, video, audio) up to 25MB |
| `GET` | `/api/v1/events` | `ApiKeyAuth` | Poll persisted WhatsApp events using cursor-based pagination |
| `DELETE` | `/api/v1/events` | `ApiKeyAuth` | Clear/acknowledge persisted events for a session |

---

## Documentation Suite

For comprehensive guides and technical deep-dives, refer to the documentation in `docs/` and `api-specs/`:

- 📖 **[API Specification & Reference](file:///root/whatsapp-server/docs/api-spec.md)**: Full endpoint reference with parameter schemas, error codes, and cURL snippets.
- ⚙️ **[OpenAPI 3.0.3 Specification](file:///root/whatsapp-server/api-specs/openapi.yaml)**: Machine-readable OpenAPI / Swagger spec.
- 🏗️ **[System Architecture & Design](file:///root/whatsapp-server/docs/system-architecture.md)**: In-depth system design, Baileys socket lifecycle, state machines, and Mermaid diagrams.
- 🗄️ **[Data Models & Persistence](file:///root/whatsapp-server/docs/data-models.md)**: Mongoose schemas, NoSQL auth store serialization, in-memory structures, and ER diagrams.
- 🚀 **[Deployment & Operations Guide](file:///root/whatsapp-server/docs/deployment.md)**: Docker, Docker Compose, PM2, NGINX/Caddy reverse proxy setups, persistent volumes, and health monitoring.

---

## License

This project is licensed under the **ISC License**.
