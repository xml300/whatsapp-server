# WhatsApp Server System Architecture & Design

This document describes the architectural design, internal components, state lifecycle, concurrency model, security mechanisms, and data flows of the WhatsApp Server.

---

## 1. High-Level System Architecture

The WhatsApp Server acts as a bridge between standard HTTP/REST clients and the decentralized WhatsApp Multi-Device network (Noise / Signal Protocol). It incorporates a transactional MongoDB Outbox and an Actor-based concurrency engine to guarantee at-least-once message delivery, strict per-recipient sequential ordering, and resilience against process terminations.

```mermaid
flowchart TB
    subgraph Clients["Clients Layer"]
        AdminWeb["Admin UI / Web Dashboard\n(Cookie: auth_token)"]
        ExternalAPI["External Backend / Microservice\n(Header: x-api-key, Idempotency-Key)"]
    end

    subgraph ExpressApp["Express 5 HTTP Layer"]
        GlobalMW["Global Middlewares\n- loggingMiddleware\n- cookieParser\n- express.json / urlencoded\n- cors"]
        AuthMW["Authentication Guards\n- userAuthMiddleware (JWT)\n- authMiddleware (API Key)"]
        ValidationMW["Validation Engine\n(declarative pipe rules + orphan media cleanup)"]
        RoutesLayer["Route Controllers\n/auth, /api-keys, /sessions\n/connection, /send, /events, /logs"]
    end

    subgraph OutboxLayer["MongoDB Outbox & Actor Engine"]
        Engine["OutboxEngine\n- Periodic Background Sweeper (runSweep)\n- Early-ACK Registry (earlyAckSet)\n- ACK Timer Map (ackTimeouts)"]
        Limiter["SessionRateLimiter\n(Sliding Window Token Bucket)"]
        ChatActors["ChatActor Mailboxes (Per-JID)\n- Sequential FIFO (concurrency: 1)\n- Anti-Ban Jitter (300-800ms)\n- simulateTyping Presence"]
    end

    subgraph CoreServices["Core Service Layer"]
        Mgr["WhatsappManager (Singleton)\n- Socket Registry (Map)\n- Connection Lock Guard (isConnecting)"]
        Svc["WhatsappService (SessionActor)\n- Baileys makeWASocket\n- Signal Cryptography Handshake\n- Reconnection FSM & Degraded Probe"]
        SSRF["SSRF Guard (validateMediaUrl)\n- IPv4/IPv6 Private CIDR Filter\n- DNS Resolution Validator"]
    end

    subgraph StorageLayer["Storage & Staging Subsystems"]
        MongoDB[("MongoDB Database\n- Users, ApiKeys, Sessions (desiredState)\n- Outbox Collection (Two-Stage ACK)\n- Baileys Creds & KeyStore\n- System Logs & Events (TTL)")]
        DiskStaging[("Disk Media Staging\n(data/outbox-media/ UUIDs)\n25MB Ceiling & Auto-Unlink")]
        LegacyCache[("Legacy Cache File\n(data/sessions.json)\nMigrated on Startup")]
    end

    subgraph ExternalNetwork["External Infrastructure"]
        WANetwork(("WhatsApp Multi-Device Network\n(Noise / Signal Protocol Transport)"))
    end

    AdminWeb --> GlobalMW
    ExternalAPI --> GlobalMW
    GlobalMW --> AuthMW
    AuthMW --> ValidationMW
    ValidationMW --> RoutesLayer

    RoutesLayer --> DiskStaging
    RoutesLayer --> Engine
    RoutesLayer --> Mgr
    RoutesLayer --> MongoDB

    Engine --> Limiter
    Engine --> ChatActors
    Engine <--> MongoDB

    ChatActors --> Svc
    ChatActors --> DiskStaging

    Mgr --> Svc
    Svc --> SSRF
    Svc --> WANetwork
    Svc <--> MongoDB
    Mgr <--> LegacyCache
```

---

## 2. Dual-Tier Authentication Architecture

The server decouples human administrative interactions from machine-to-machine API dispatching:

```mermaid
sequenceDiagram
    autonumber
    participant Admin as Admin / Web Client
    participant API as Express Router
    participant DB as MongoDB
    participant App as External Integrator

    rect rgb(240, 248, 255)
        Note over Admin,DB: Tier 1: User & Session Provisioning (JWT Cookie)
        Admin->>API: POST /api/auth/login { username, password }
        API->>DB: Query User & verify bcrypt hash
        DB-->>API: User verified
        API-->>Admin: Set-Cookie: auth_token=<JWT>; HttpOnly
        Admin->>API: POST /api/api-keys/generate (with auth_token)
        API->>DB: Insert new ApiKey (UUID v4)
        DB-->>API: Created
        API-->>Admin: { apiKey: "9b1deb4d-..." }
        Admin->>API: POST /api/sessions { phoneNumber }
        API->>DB: Store Session record (id: SHA256(userId + phone), desiredState: DISCONNECTED)
        API-->>Admin: { sessionId: "e3b0c44..." }
    end

    rect rgb(245, 255, 250)
        Note over App,DB: Tier 2: Programmatic WhatsApp Operations (API Key + Idempotency)
        App->>API: POST /api/v1/send/text (Header: x-api-key, Idempotency-Key)
        API->>DB: Validate x-api-key in ApiKey collection
        DB-->>API: Valid user ID
        API->>DB: Upsert Outbox record (status: QUEUED)
        API-->>App: 202 Accepted { outboxId, messageId, status: "queued", deduplicated: false }
    end
```

---

## 3. Actor Hierarchy & Anti-Ban Rate Limiting

### 3.1 Why Traditional Queues Fail in WhatsApp Multi-Device (Baileys)

Common background job patterns (e.g., global Redis/BullMQ queues or multi-threaded worker pools) fail when integrated with the WhatsApp Multi-Device protocol:

1. **Session Affinity & Socket Ownership**:
   - Baileys maintains a persistent, stateful WebSocket connection held in local process memory (`makeWASocket`).
   - If arbitrary workers dequeue jobs concurrently, they lack direct access to the active socket instance without complex inter-process RPC or sticky routing.
2. **Signal Protocol Double-Ratchet State Corruption**:
   - WhatsApp end-to-end encryption relies on the Signal Protocol's Double Ratchet algorithm. Each incoming and outgoing message advances the cryptographic ratchet keys sequentially.
   - If multiple concurrent worker threads attempt to transmit messages for the same WhatsApp session simultaneously, they read identical baseline ratchet states from the database, generate conflicting encrypted stanzas, and write back interleaved key states. This causes irreversible cryptographic key desynchronization. The recipient's phone encounters permanent decryption failures (manifested as `"Waiting for this message. This may take a while"`).
3. **Head-of-Line (HoL) Blocking**:
   - A single FIFO queue per session introduces Head-of-Line blocking: if a large video transmission or a message to a slow recipient stalls, all subsequent messages to completely unrelated contacts are blocked behind it.

### 3.2 The Actor Model Solution

The WhatsApp Server resolves these issues by adopting the **Actor Model** across two distinct layers:

```mermaid
flowchart TD
    subgraph SessionLayer["SessionActor Layer (Per Session)"]
        SA["SessionActor (WhatsappService)\n- Owns Baileys WebSocket instance\n- Maintains Connection FSM (CONNECTED / RECONNECTING / DEGRADED)\n- Houses SessionRateLimiter\n- Enforces withKeyLock Cryptographic Mutex"]
    end

    subgraph ChatLayer["ChatActor Layer (Per JID Mailbox)"]
        CA1["ChatActor (JID 1 Mailbox)\n- concurrency: 1 (Sequential FIFO)\n- 300-800ms Jitter\n- Optional simulateTyping"]
        CA2["ChatActor (JID 2 Mailbox)\n- concurrency: 1 (Sequential FIFO)\n- 300-800ms Jitter\n- Optional simulateTyping"]
        CA3["ChatActor (JID 3 Mailbox)\n- concurrency: 1 (Sequential FIFO)\n- 300-800ms Jitter\n- Optional simulateTyping"]
    end

    SA --> CA1
    SA --> CA2
    SA --> CA3
```

- **`SessionActor` (`WhatsappService` / `WhatsappManager`)**:
  - Owns the physical WebSocket connection and the connection finite state machine.
  - Controls access to Signal keys via the `withKeyLock` asynchronous mutex, ensuring atomic cryptographic mutations.
  - Enforces a sliding-window token bucket (`SessionRateLimiter`, default 20 operations per minute per session) to prevent session-level throttling from WhatsApp servers.
- **`ChatActor` (Per-JID Mailbox)**:
  - Dynamically instantiated per `${sessionId}:${recipientJid}` tuple via `OutboxEngine.runningActors` and `actorPending`.
  - Guarantees strict sequential execution (`concurrency: 1`) for that specific recipient, eliminating race conditions while allowing independent recipients to be processed concurrently without Head-of-Line blocking.
  - Applies anti-ban pacing:
    - **Jitter**: Introduces a randomized delay of 300–800ms before message transmission.
    - **Presence Simulation**: When `simulateTyping: true` is requested, transmits an initial `sendTyping` presence stanza, waits 1000–2000ms, transmits `sendTypingPaused`, and finally dispatches the payload. This emulates natural human conversation cadence and avoids automated heuristic bans.

---

## 4. WhatsApp Multi-Device Lifecycle & Connection State Machine

Each WhatsApp connection is managed by an isolated `WhatsappService` instance encapsulating `@whiskeysockets/baileys`.

### 4.1 Connection State Machine

```mermaid
stateDiagram-v2
    [*] --> Idle: Session Provisioned

    Idle --> Connecting: POST /connection or Startup Recovery
    note right of Connecting
        isConnecting Lock acquired
        useNoSQLAuthState loaded
        withKeyLock initialized
        makeWASocket initialized
    end note

    Connecting --> PairingPending: Credentials Missing / Expired
    PairingPending --> QRReady: QR code emitted
    PairingPending --> CodeReady: 8-digit pairing code requested

    QRReady --> Authenticated: User scans QR in WhatsApp app
    CodeReady --> Authenticated: User enters 8-digit Pairing Code

    Connecting --> Authenticated: Valid Credentials in DB
    
    Authenticated --> Connected: connection.update (open)
    note right of Connected
        desiredState = "CONNECTED" in MongoDB
        retries reset to 0
        isConnecting Lock released
        OutboxEngine.kickSession() triggered
    end note

    Connected --> Reconnecting: Socket Dropped (status != 401, attempts 1-5)
    note right of Reconnecting
        Exponential Backoff:
        min(30s, 2s * 2^(retries-1)) + jitter
        Inflight DISPATCHED jobs revert to QUEUED
    end note
    Reconnecting --> Connected: Socket Restored (open)

    Reconnecting --> Degraded: Socket Dropped (attempt 6+)
    note right of Degraded
        Self-Healing Circuit Breaker:
        Probe connection every 60s + jitter
        Prevents rapid infinite reconnect loops
    end note
    Degraded --> Connected: Self-healing probe succeeds (open)

    Connected --> LoggedOut: WhatsApp Web Logged Out (status == 401)
    note right of LoggedOut
        Terminal Logout:
        desiredState = "DISCONNECTED" in MongoDB
        clearUserKeys(phoneNumber) unlinks Credential & KeyStore
        OutboxEngine.failAllForSession() terminally fails pending jobs
    end note
    LoggedOut --> Idle: Auth state cleared

    Connected --> Disconnected: POST /connection/:id/end or DELETE /sessions/:id
    note right of Disconnected
        Explicit Disconnect Cleanup:
        desiredState = "DISCONNECTED" in MongoDB
        Socket gracefully closed & removed from registry
        OutboxEngine.failAllForSession() marks pending jobs as FAILED_TERMINAL
    end note
    Disconnected --> [*]
```

### 4.2 Reconnection Strategy & Self-Healing Circuit Breaker
1. **Exponential Backoff (Attempts 1–5)**:
   - When a socket drops unexpectedly with a non-401 status code, the connection transitions to `RECONNECTING`.
   - Reconnection delay scales exponentially: `min(30000ms, 2000ms * 2^(retries - 1)) + randomJitter(0-1000ms)`.
2. **Degraded State Circuit Breaker (Attempt 6+)**:
   - If the connection fails after 5 successive attempts, the state transitions to `DEGRADED`.
   - Instead of aggressive retries that trigger IP bans or CPU spikes, the system engages a low-frequency self-healing probe: attempts occur once every 60 seconds (plus 0–5000ms randomized jitter) until connectivity is re-established.
3. **Terminal Logout & Explicit Disconnect Cleanup**:
   - **401 Unauthorized (`DisconnectReason.loggedOut`)**: The session has been revoked from the WhatsApp mobile device. The server clears the session's credentials from `Credential` and `KeyStore`, sets `Session.desiredState = "DISCONNECTED"`, emits `'logged.out'`, and terminates all pending outbox jobs (`failAllForSession`).
   - **Explicit Disconnect**: When an operator issues a disconnect request, `WhatsappManager` sets `desiredState = "DISCONNECTED"`, closes the socket, and triggers `failAllForSession`, ensuring queued and in-flight outbox items transition to `FAILED_TERMINAL` rather than remaining in limbo.

### 4.3 Inflight Concurrency Guard (`isConnecting`)
To prevent duplicate socket instantiation when concurrent requests target the same session:
1. `WhatsappManager` maintains an in-memory `Map<string, Promise<void>>` (`isConnecting`).
2. Concurrent callers await the in-flight connection promise.
3. Once the socket establishes or terminates, the promise resolves and is removed from the map.

---

## 5. Outbox Message Lifecycle & Two-Stage `SERVER_ACK` Verification

The messaging pipeline uses a persistent MongoDB Outbox pattern to guarantee at-least-once delivery, full idempotency, and cryptographic verification of message transit.

### 5.1 Outbox State Machine

```mermaid
stateDiagram-v2
    [*] --> QUEUED: POST /api/v1/send/* (202 Accepted)
    
    QUEUED --> PROCESSING: ChatActor picks next eligible job
    note right of PROCESSING
        Token acquired from SessionRateLimiter
        Anti-ban jitter / simulateTyping executed
    end note

    PROCESSING --> DISPATCHED: socket.sendMessage executed
    note right of DISPATCHED
        waMessageId registered
        20s ACK timer armed in ackTimeouts
        message.sent event persisted
    end note

    PROCESSING --> DELIVERED_TO_SERVER: Early ACK race (waMessageId in earlyAckSet)
    
    DISPATCHED --> DELIVERED_TO_SERVER: WhatsApp emits SERVER_ACK
    note right of DELIVERED_TO_SERVER
        ACK timer cancelled
        Staged media file unlinked
        message.delivered event persisted
    end note

    DISPATCHED --> QUEUED: 20s ACK Timeout or Socket Disconnect (attempts < maxAttempts)
    note right of QUEUED
        Re-queued for replay
        Replayed with IDENTICAL waMessageId
    end note

    PROCESSING --> QUEUED: Transient Error or Socket Disconnect (attempts < maxAttempts)
    
    PROCESSING --> FAILED_TERMINAL: Terminal validation error OR attempts >= maxAttempts
    DISPATCHED --> FAILED_TERMINAL: ACK Timeout with attempts >= maxAttempts
    QUEUED --> FAILED_TERMINAL: Session Disconnected / Logged Out (failAllForSession)
    
    FAILED_TERMINAL --> [*]: Staged media unlinked & message.failed event persisted
    DELIVERED_TO_SERVER --> [*]
    
    QUEUED --> CANCELLED: Explicit cancellation
    CANCELLED --> [*]
```

### 5.2 Two-Stage Delivery Sequence

```mermaid
sequenceDiagram
    autonumber
    participant Client as REST Client
    participant API as Express Controller
    participant DB as MongoDB (Outbox)
    participant Engine as OutboxEngine / ChatActor
    participant Svc as WhatsappService (Socket)
    participant WA as WhatsApp Binary Gateway
    participant FS as Disk Staging (data/outbox-media)

    rect rgb(240, 248, 255)
        Note over Client,API: Stage 1: Ingestion & 202 Accepted
        Client->>API: POST /api/v1/send/file (Header: Idempotency-Key, File Payload)
        API->>FS: Stage file to data/outbox-media/{uuid}.ext
        API->>DB: Upsert Outbox record (status: QUEUED, waMessageId: generateMessageIDV2())
        DB-->>API: Created Outbox Document
        API-->>Client: 202 Accepted { outboxId, messageId, status: "queued", deduplicated: false }
        API->>Engine: notify(sessionId, recipientJid)
    end

    rect rgb(245, 255, 250)
        Note over Engine,WA: Stage 2: Actor Processing & Dispatch
        Engine->>Engine: Acquire ChatActor mailbox for (sessionId:recipientJid)
        Engine->>DB: findOneAndUpdate({ status: QUEUED }) -> PROCESSING
        Engine->>Engine: RateLimiter.acquireToken(sessionId)
        Engine->>Svc: simulateTyping or 300-800ms jitter
        Engine->>Svc: socket.sendMessage(jid, content, { messageId: waMessageId })
        Svc->>WA: Noise transport message stanza
        Engine->>DB: updateOne({ status: DISPATCHED, dispatchedAt: now })
        Engine->>Engine: Arm 20s ACK timeout timer in ackTimeouts
    end

    rect rgb(255, 250, 240)
        Note over WA,FS: Stage 3: Two-Stage SERVER_ACK & Media Cleanup
        WA-->>Svc: Stanza Receipt / ACK (status >= 2)
        Svc->>Engine: handleAck(sessionId, waMessageId)
        Engine->>Engine: Clear 20s timeout from ackTimeouts
        Engine->>DB: updateOne({ status: DELIVERED_TO_SERVER, completedAt: now })
        Engine->>FS: unlink(filePath) staged media file
        Engine->>DB: Insert message.delivered Event
    end

    rect rgb(255, 240, 245)
        Note over Engine,WA: Stage 4: Timeout & Replay Fallback (if ACK missed)
        alt 20s Timer Fires or Socket Drops before ACK
            Engine->>DB: updateOne({ status: QUEUED, nextAttemptAt: now })
            Engine->>Engine: Re-trigger ChatActor mailbox
            Engine->>Svc: socket.sendMessage(jid, content, { messageId: waMessageId })
            Note over Svc,WA: Replays with IDENTICAL waMessageId (deduplicated over-the-air by WhatsApp)
        end
    end
```

### 5.3 Over-the-Air Idempotency & Replay Semantics
- **Deterministic Message IDs**: Every outbox item pre-allocates a Baileys `waMessageId` (`generateMessageIDV2()`) upon insertion into MongoDB.
- **Replay Safety**: If a message is dispatched to the network but the server socket drops or the 20-second ACK timeout expires before receiving confirmation, the message transitions back to `QUEUED`. When replayed, it transmits with the **exact same `waMessageId`**. WhatsApp edge servers recognize the duplicate message ID and suppress duplicate delivery to the recipient's handset while returning the missing server acknowledgement.
- **Early ACK Protection (`earlyAckSet`)**: In high-speed network conditions, WhatsApp's receipt ACK stanza may arrive before the local database write marking `DISPATCHED` completes. The engine buffers incoming receipt IDs in an in-memory `earlyAckSet` (retained for 10 seconds), ensuring out-of-order ACKs immediately promote the message directly to `DELIVERED_TO_SERVER`.

---

## 6. Signal Protocol Key Store Mutex & Concurrency Guard

The Signal Protocol relies on strict transactional integrity during Double-Ratchet key derivation. Simultaneous read/write access to cryptographic keys causes session desynchronization.

### 6.1 Per-Phone Async Mutex Lock (`withKeyLock`)
In `src/lib/auth.ts`, all operations against Baileys credentials and cryptographic keys are synchronized using a per-phone mutex:

```typescript
const keyLocks = new Map<string, Promise<unknown>>();

async function withKeyLock<T>(phoneNumber: string, fn: () => Promise<T>): Promise<T> {
    const current = keyLocks.get(phoneNumber) ?? Promise.resolve();
    let resolveLock!: () => void;
    const next = new Promise<void>((resolve) => { resolveLock = resolve; });
    keyLocks.set(phoneNumber, next);

    try {
        await current.catch(() => {});
        return await fn();
    } finally {
        resolveLock();
        if (keyLocks.get(phoneNumber) === next) {
            keyLocks.delete(phoneNumber);
        }
    }
}
```

### 6.2 Atomic `KeyStore.bulkWrite`
During connection synchronization, Baileys emits batch key updates. Instead of individual sequential updates that could interleave with other operations, updates are grouped into a single atomic MongoDB `bulkWrite`:
- **Upserts**: Applied via `{ updateOne: { filter: { phoneNumber, key }, update: { $set: entry }, upsert: true } }`.
- **Deletions**: Applied via `{ deleteMany: { filter: { phoneNumber, key: { $in: toDeleteKeys } } } }`.
- Guaranteed atomicity across pre-keys, sender keys, and app state sync keys prevents Double-Ratchet state corruption.

---

## 7. Real-Time Message Streaming (SSE & Events)

Incoming messages and status events received over the WhatsApp binary transport are persisted into MongoDB as structured events and retrieved by clients via cursor-based polling (`GET /api/v1/events`).

```mermaid
sequenceDiagram
    autonumber
    participant App as External Integrator
    participant API as GET /api/v1/events
    participant Svc as WhatsappService
    participant WA as WhatsApp Multi-Device
    participant DB as MongoDB (Events)

    WA->>Svc: Encrypted Signal Protocol Message
    Svc->>Svc: Decrypt & parse messages.upsert
    Svc->>DB: Events.create({ userId, sessionId, eventType: "message", payload })
    
    App->>API: GET /api/v1/events?sessionId=...&after=<cursor>
    API->>DB: Query events (userId, sessionId, _id > after)
    DB-->>API: List of events + lastCursor
    API-->>App: 200 OK { events, count, lastCursor }
```

Event categories recorded in the `events` collection include:
- `message`: Incoming and outgoing chat messages.
- `message.update`: Status updates (sent, delivered, read receipts).
- `message.sent`: Dispatched to WhatsApp edge servers.
- `message.delivered`: Two-stage `SERVER_ACK` received from WhatsApp.
- `message.failed`: Terminal delivery failure with error details.
- `connection`: Status transitions (`CONNECTING`, `CONNECTED`, `RECONNECTING`, `DEGRADED`, `DISCONNECTED`).
- `qr`: Fresh QR code authentication strings.

---

## 8. Security & SSRF Protection Subsystem

When handling media uploads and remote URLs, the server implements strict defenses against Server-Side Request Forgery (SSRF), disk exhaustion, and unauthorized data leakage.

### 8.1 SSRF Defense-in-Depth Pipeline (`validateMediaUrl`)
1. **Protocol Restriction**: Restricts URLs strictly to `http:` and `https:`.
2. **DNS Resolution**: Resolves target hostnames using system DNS before executing HTTP requests.
3. **CIDR IP Blacklisting**: Evaluates resolved IP addresses against private, loopback, link-local, and reserved CIDR ranges:
   - **IPv4**: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `0.0.0.0/8`, `100.64.0.0/10`, `224.0.0.0/4`, `240.0.0.0/4`.
   - **IPv6**: `::1/128`, `fc00::/7` (ULA), `fe80::/10` (Link-Local), `::ffff:0:0/96` (IPv4-Mapped), `ff00::/8` (Multicast).

### 8.2 Disk Staging & Orphan File Cleanup (`data/outbox-media/`)
1. **Multer Disk Staging**: Incoming media file uploads are written directly to disk at `data/outbox-media/` with unique UUID filenames (`${randomUUID()}${ext}`) to prevent collisions, memory exhaustion, and path traversal attacks.
2. **25MB Size Ceiling**: File uploads enforce a strict 25MB ceiling (`limits: { fileSize: 25 * 1024 * 1024 }`).
3. **Automatic Orphan Cleanup in `validate.ts`**: If an incoming multipart request fails declarative validation rules (e.g., missing required fields, invalid phone number format), the validation middleware immediately calls `unlink(req.file.path)` prior to returning HTTP 400, ensuring no stranded files accumulate on disk.
4. **Lifecycle Deletion**:
   - Staged files are unlinked upon receiving `SERVER_ACK` (`DELIVERED_TO_SERVER`).
   - Staged files are unlinked if the job exceeds `maxAttempts` or encounters a terminal error (`FAILED_TERMINAL`).
   - If an incoming request matches an existing idempotency key with a new staged file, the superseded file is immediately unlinked.

---

## 9. Crash-Proof Startup & Cold-Start Recovery

To ensure resilient operation across intentional deployments, server reboots, and abrupt OS termination (`SIGKILL` / OOM events), the server couples MongoDB state persistence with automatic recovery routines.

```mermaid
flowchart TD
    subgraph Shutdown["Graceful Shutdown (SIGINT / SIGTERM / SIGUSR2)"]
        S1["Capture OS Signal"] --> S2["outboxEngine.stop() clears sweep & timers"]
        S2 --> S3["Flush in-memory logBuffer to MongoDB"]
        S3 --> S4["whatsappService.clearAll() ends active sockets"]
        S4 --> S5["Close HTTP Listener & Exit 0"]
    end

    subgraph Startup["Cold-Start Recovery (handleStartup)"]
        U1["Server listens on PORT"] --> U2["outboxEngine.start()"]
        U2 --> U3["Reset orphaned PROCESSING jobs -> QUEUED"]
        U3 --> U4["Check for legacy data/sessions.json"]
        U4 -- Found --> U5["Migrate legacy IDs to desiredState: CONNECTED in MongoDB"]
        U5 --> U6["Unlink data/sessions.json"]
        U4 -- Not Found --> U7["Query MongoDB: Session.find({ desiredState: CONNECTED })"]
        U6 --> U7
        U7 --> U8["Trigger whatsappService.connect(sessionId) for each"]
        U8 --> U9["Trigger outboxEngine.kickSession(sessionId)"]
        U9 --> U10["Server Ready for HTTP Requests"]
    end
```

### 9.1 `Session.desiredState` vs. Legacy Disk Caching
- **The Problem with Ephemeral Disk Cache (`data/sessions.json`)**: Legacy implementations wrote active session IDs to disk only during graceful shutdown hooks (`SIGINT`, `SIGTERM`). In events such as container OOM kills, kernel panics, or sudden power termination (`SIGKILL`), shutdown handlers never execute, resulting in total loss of active session context upon restart.
- **MongoDB `Session.desiredState`**:
  - `Session` documents persist an explicit `desiredState: "CONNECTED" | "DISCONNECTED"`.
  - When a session successfully connects, `desiredState` is atomically marked `"CONNECTED"`.
  - When an explicit disconnect or 401 terminal logout occurs, `desiredState` is set to `"DISCONNECTED"`.
  - Upon startup, `handleStartup()` restores all sessions marked `"CONNECTED"`.
- **Backward Compatibility**: On startup, `handleStartup()` checks if a legacy `data/sessions.json` file is present. If found, it migrates each listed session to `desiredState: "CONNECTED"` in MongoDB and unlinks the legacy file.
- **Orphan Job Re-queuing**: `OutboxEngine.start()` automatically detects any jobs stranded in `status: "PROCESSING"` (from an ungraceful shutdown during message execution) and resets them to `"QUEUED"` with `nextAttemptAt = now`, guaranteeing no messages are permanently lost.

---

## 10. Known System Characteristics & Considerations

1. **In-Memory Session Map & Horizontal Scaling**:
   - `WhatsappManager` maintains active Baileys socket connections in process memory (`sockets: Map<string, WhatsappService>`).
   - In horizontally scaled multi-worker deployments (e.g., Kubernetes pods or PM2 cluster mode), requests targeting a specific `sessionId` must use **sticky sessions** or route to the specific worker node maintaining that session's WebSocket.
2. **Phone Number Normalization**:
   - The current validator assumes phone numbers conform to Nigerian telecom formats (`080...` -> `23480...`). International numbers outside this prefix pattern require format adjustment in `src/utils/format.ts`.
3. **Database Indexing**:
   - All critical query paths in `Session`, `Outbox`, `Credential`, `KeyStore`, and `Event` are protected by compound and unique indexes to maintain sub-millisecond query latencies under high transaction volumes.
