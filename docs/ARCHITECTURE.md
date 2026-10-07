# AuraDrop V16 — Production Architecture Overview

AuraDrop is a production-grade, zero-cloud-storage, peer-to-peer file transfer system engineered for seamless cross-platform sharing between Desktop Web clients (hosted on Vercel) and native mobile applications (Android Flutter + Kotlin APK).

---

## 1. Top-Level Product Architecture

```
                                      INTERNET
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │                                               │
                 ▼                                               ▼
          Vercel Frontend                                 AuraDrop Backend
       (AuraDrop Desktop Web)                       (Signaling, Auth & Presence)
                 │                                               │
                 │                                    ┌──────────┴──────────┐
                 │                                    ▼                     ▼
                 │                             Neon PostgreSQL        Redis Cluster
                 │                          (Durable Data Model)   (Ephemeral Presence)
                 │                                               │
                 ▼                                               ▼
          Client A (Desktop) ◄─── Signaling (WebSocket) ───► Client B (Android APK)
                 │                                               │
                 │                                               │
                 └────────────── WebRTC DataChannel ─────────────┘
                               (Direct P2P / coturn TURN)
                                  [REAL FILE BYTES]
```

### Core Architecture Axioms:
1. **Zero File Storage on Servers:** The Vercel frontend, signaling cluster, and database **never** receive, store, or proxy payload file bytes.
2. **Direct P2P Data Plane:** Real file bytes travel exclusively over encrypted WebRTC DataChannels using our binary `P2PFS/1` protocol with 64 KB chunking, backpressure control, and streaming disk commits.
3. **Dual Client Topology:**
   - **Client A (Desktop):** Modern React/TypeScript Single Page Application hosted on Vercel Edge.
   - **Client B (Android Native):** High-performance Flutter application with native Kotlin background service and foreground progress notification.
4. **Resilient Control Plane:**
   - **Neon PostgreSQL:** Durable accounts, user preferences, registered devices, contacts, and transfer audit logs.
   - **Redis Cluster:** High-frequency ephemeral presence (TTL heartbeats 5–15s), horizontal WebSocket clustering via pub/sub (`auradrop:signaling`), and sliding-window rate limiting.
   - **coturn TURN/STUN:** Fallback relay for Symmetric NAT / firewall traversal when direct host candidates fail.

---

## 2. Component Specifications

### 2.1 Web Desktop (`apps/web`)
- **Framework:** React 19 + TypeScript + Vite.
- **Data Plane:** WebRTC `RTCDataChannel`, File System Access API (`showOpenFilePicker`, `showSaveFilePicker`).
- **Chunk Streamer:** `ChunkStreamer` reading chunks via `File.slice()`, computing streaming SHA-256 using Web Crypto API.
- **Backpressure:** Monitors `dataChannel.bufferedAmount` with 16 MB high-water mark and 4 MB low-water resumption mark.
- **UI & UX:** Preserved AuraDrop dark visual identity, HeroGlobe radar, 5-dot floating side rail, and non-blocking notifications.

### 2.2 Android Native APK (`apps/android`)
- **Framework:** Flutter 3.38+ (Dart 3.7+) with native Kotlin platform channel engine.
- **WebRTC:** `flutter_webrtc` binding to native WebRTC C++ core.
- **Disk I/O:** `AuraProtocol` parsing 20-byte `P2PFS/1` headers, directly writing binary chunks to Android cache/Downloads using Dart `IOSink` streams without holding whole files in RAM.
- **Background Persistence:** Foreground Android Service with notification channel `auradrop_transfers` preventing Android OS task killing during multi-gigabyte transfers.
- **Content Resolver:** `MainActivity.kt` URI resolution for Android SAF (Storage Access Framework).

### 2.3 Backend Signaling & Auth Gateway (`apps/backend`)
- **Engine:** Node.js TypeScript HTTP + WebSocket Server (`ws`).
- **Endpoints:**
  - `GET /health` & `GET /ws-health`: Cluster health and network interfaces.
  - `GET /api/turn-credentials`: Generates ephemeral coturn HMAC-SHA1 tokens.
  - `POST /auth/register` & `POST /auth/login`: Account authentication with bcryptjs.
  - `POST /auth/refresh`: Anti-replay refresh session rotation.
  - `GET /devices` & `POST /devices/register`: Device identity registry.
  - `GET /presence/active`: Distributed online peers.
- **WebSocket Gateway:**
  - Handles `REGISTER`, `PING`, `SIGNAL`, and `TRANSFER_*` messages.
  - Redis pub/sub relay across multi-instance signaling nodes.
  - Automatic DB transfer session auditing.

### 2.4 Data Tier (`packages/database`)
- **Neon PostgreSQL:** 13 production tables with indexed lookups (`users`, `devices`, `device_sessions`, `refresh_sessions`, `transfer_sessions`, etc.).
- **Automatic Migration:** Executes `migrations/001_initial_schema.sql` on initialization.
- **Graceful Fallback:** Automatic in-memory repository store when `DATABASE_URL` is omitted (local offline development & CI testing).

---

## 3. Wire Protocol & Security Highlights
- **Wire Magic:** `0x50 0x32 0x50 0x46` (`P2PF`), version `0x01`.
- **Framing:** 20-byte bit-exact binary header followed by payload.
- **Integrity:** SHA-256 calculated on-the-fly during transmission and verified before atomic disk commit.
- **Encryption:** WebRTC DTLS-SRTP mandatory transport encryption.
