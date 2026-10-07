# AuraDrop Production Deployment Guide

AuraDrop is deployed across a distributed cloud topology:
- **Frontend:** Vercel Global Edge Network.
- **Backend Signaling & Auth:** Multi-region Docker containers (AWS ECS / Fly.io / GCP Cloud Run).
- **Database:** Neon Serverless PostgreSQL with auto-scaling.
- **Realtime Cache:** Redis (Upstash / AWS ElastiCache).
- **TURN Relay:** coturn on high-bandwidth VM instances.

---

## 1. Docker Compose (Full Stack)

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  backend:
    build:
      context: .
      dockerfile: apps/backend/Dockerfile
    ports:
      - "48280:48280"
    environment:
      - PORT=48280
      - HOST=0.0.0.0
      - DATABASE_URL=postgres://user:pass@ep-cool-frost.us-east-2.aws.neon.tech/auradrop?sslmode=require
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=auradrop-production-jwt-secret-key-2026
      - TURN_SECRET=auradrop-production-coturn-shared-secret-2026
      - TURN_HOST=turn.auradrop.network
    depends_on:
      - redis
    restart: always

  redis:
    image: redis:7-alpine
    restart: always
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes

  coturn:
    image: coturn/coturn:latest
    restart: always
    network_mode: "host"
    volumes:
      - ./turnserver.conf:/etc/turnserver.conf:ro
```

---

## 2. Environment Variables Matrix

| Variable | Target | Description | Example |
|---|---|---|---|
| `DATABASE_URL` | Backend | Neon PostgreSQL connection URI | `postgres://user:pwd@neon.tech/auradrop?sslmode=require` |
| `REDIS_URL` | Backend | Redis clustering & presence URI | `redis://user:pwd@redis.auradrop.network:6379` |
| `JWT_SECRET` | Backend | 256-bit symmetric secret for access tokens | `c48f98...` |
| `TURN_SECRET` | Backend | coturn shared secret for HMAC-SHA1 tokens | `89a2b1...` |
| `TURN_HOST` | Backend | Public hostname of coturn server | `turn.auradrop.network` |
| `VITE_SIGNALING_URL` | Web | WebSocket gateway URI | `wss://api.auradrop.network` |
| `VITE_BACKEND_URL` | Web | REST API gateway URI | `https://api.auradrop.network` |

---

## 3. SSL / TLS Setup (Reverse Proxy Nginx)

```nginx
server {
    server_name api.auradrop.network;

    location / {
        proxy_pass http://127.0.0.1:48280;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    listen 443 ssl http2;
    ssl_certificate /etc/letsencrypt/live/api.auradrop.network/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.auradrop.network/privkey.pem;
}
```
