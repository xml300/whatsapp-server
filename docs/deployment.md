# WhatsApp Server Deployment & Operations Guide

This guide covers deployment strategies, environment configurations, reverse proxy setups, and operational best practices for deploying the WhatsApp Server in production.

---

## 1. Environment Variables Reference

| Variable | Type | Required | Default | Description |
|---|---|---|---|---|
| `PORT` | Integer | Optional | `3000` | Port on which the HTTP server listens (`0.0.0.0`). |
| `NODE_ENV` | String | Optional | `development` | Runtime environment (`development`, `production`, `test`). |
| `MONGODB_URL` | String | **Required** | None | MongoDB URI connection string. Example: `mongodb://mongo:27017/whatsapp-server` |
| `JWT_SECRET` | String | **Required** | None | 64-char random secret used for signing and verifying administrative JWT session cookies. |

---

## 2. Docker & Docker Compose Deployment (Recommended)

### 2.1 Multi-Stage Dockerfile Overview
The project includes a hardened multi-stage `Dockerfile`:
- **Builder Stage (`node:alpine`)**: Compiles TypeScript, runs `node-prune`, and removes unnecessary development dependencies.
- **Runner Stage (`alpine:3.21` + `nodejs`)**: Executes the compiled bundle (`dist/index.js`) as an unprivileged user (`appuser:appgroup`), exposing port `3000`.

### 2.2 Production `docker-compose.yml`
Create a `docker-compose.yml` file in your deployment directory:

```yaml
version: '3.8'

services:
  whatsapp-server:
    build:
      context: .
      dockerfile: Dockerfile
    image: whatsapp-server:latest
    container_name: whatsapp-server
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - NODE_ENV=production
      - MONGODB_URL=mongodb://mongo:27017/whatsapp-server
      - JWT_SECRET=change_this_to_a_secure_random_64_character_string
    volumes:
      # Persistent volume for auto-reconnect session cache (data/sessions.json)
      - whatsapp_session_data:/app/data
      - whatsapp_logs:/app
    depends_on:
      mongo:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

  mongo:
    image: mongo:7.0-jammy
    container_name: whatsapp-mongo
    restart: unless-stopped
    volumes:
      - mongo_data:/data/db
    ports:
      - "127.0.0.1:27017:27017"
    healthcheck:
      test: echo 'db.runCommand("ping").ok' | mongosh localhost:27017/test --quiet
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  whatsapp_session_data:
  whatsapp_logs:
  mongo_data:
```

### 2.3 Starting the Containers
```bash
# Build and start services in background
docker compose up -d --build

# Inspect running logs
docker compose logs -f whatsapp-server
```

---

## 3. Bare-Metal / PM2 Process Manager Deployment

For direct virtual machine (VM) or dedicated server deployments without Docker:

### 3.1 Prerequisites
- Node.js 20.x or 22.x LTS
- MongoDB 6.0+ or 7.0+ instance running locally or on MongoDB Atlas
- PM2 installed globally: `npm install -g pm2`

### 3.2 Build & Execution Steps
```bash
# 1. Clone and install dependencies
cd /root/whatsapp-server
npm ci

# 2. Compile TypeScript
npm run build

# 3. Create .env configuration file
cp .env.example .env
nano .env

# 4. Ensure data directory exists for state persistence
mkdir -p data
```

### 3.3 PM2 Ecosystem Configuration (`ecosystem.config.cjs`)
Create an `ecosystem.config.cjs` file:

```javascript
module.exports = {
  apps: [
    {
      name: "whatsapp-server",
      script: "dist/index.js",
      instances: 1, // Single instance mode required due to in-memory socket manager
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      },
      kill_timeout: 10000, // 10 seconds to allow graceful session serialization and log buffer flush
      listen_timeout: 5000,
      max_memory_restart: "1G"
    }
  ]
};
```

Launch with PM2:
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

---

## 4. Reverse Proxy Setup (NGINX & Caddy)

Since event delivery operates over standard HTTP polling (`/api/v1/events`), reverse proxies no longer require persistent 24-hour streaming connections or disabled proxy buffering. Standard proxying handles all traffic reliably.

### 4.1 NGINX Configuration
Add the following block to `/etc/nginx/sites-available/whatsapp-server.conf`:

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    # Maximum payload size for media/file uploads (matches 25MB Multer ceiling)
    client_max_body_size 30M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 4.2 Caddy Configuration (`Caddyfile`)
```caddy
api.yourdomain.com {
    request_body {
        max_size 30MB
    }

    reverse_proxy 127.0.0.1:3000 {
        # Flush SSE chunks immediately
        flush_interval -1
    }
}
```

---

## 5. Persistent Storage & Backup Strategy

1. **MongoDB Data Directory**:
   - Contains all credentials, user logins, and Signal encryption keys (`Credential` & `KeyStore`).
   - Run regular automated backups using `mongodump`:
     ```bash
     mongodump --uri="mongodb://localhost:27017/whatsapp-server" --out=/backups/$(date +%F)
     ```
2. **Session Cache (`data/sessions.json`)**:
   - Ensure the `data/` directory is mapped to a persistent volume so cold restarts correctly restore active sessions.

---

## 6. Health Checks & Monitoring

### 6.1 Health Endpoint
The server exposes `GET /api/health`:
```bash
curl -f http://localhost:3000/api/health || exit 1
```

### 6.2 Log Rotation & Monitoring
- **MongoDB Logs Collection**: Application events are batched and inserted into the `logs` collection. Query via `GET /api/logs?page=1&limit=50`.
- **Docker Logs**: `docker logs --tail 100 -f whatsapp-server`
- **PM2 Logs**: `pm2 logs whatsapp-server`

---

## 7. Troubleshooting & FAQ

| Issue | Root Cause | Resolution |
|---|---|---|
| `Pairing code expired` | WhatsApp pairing codes expire after ~60 seconds. | Re-fetch a fresh pairing code via `GET /api/v1/connection/:sessionId/pairing-code`. |
| `QR code string null` | QR code was already scanned, session already open, or socket is initializing. | Check `GET /api/v1/connection/:sessionId/status` first to confirm `isConnected` is false. |
| `Logged out error (401)` | User unlinked device from WhatsApp Mobile app. | Call `POST /api/v1/connection/:sessionId/end` and re-initiate connection via `POST /api/v1/connection`. |
| `File too large error (400)` | Uploaded file exceeds Multer's 25MB memory limit. | Compress media or split documents before dispatching. |
| `SSE connection drops after 60s` | Reverse proxy idle timeout severed the connection. | Ensure `proxy_read_timeout 86400s;` and `proxy_buffering off;` are enabled in Nginx. |
