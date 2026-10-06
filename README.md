# ⚡ AuraDrop — Next-Gen Peer-to-Peer File Sharing

> **"Select → Nearby device → Accept → Transfer → Done."**  
> A production-grade cross-platform peer-to-peer file sharing application engineered for Android, iOS, Windows, macOS, and Linux with a completely original visual identity, custom networking stack, and zero cloud dependency for local transfers.

---

## 🌟 Key Highlights

- ⚡ **Direct Device-to-Device (Zero Cloud):** Files stream directly across local sockets using the custom `P2PFS/1` protocol. File contents never touch the cloud.
- 🔒 **End-to-End Cryptography:** Ephemeral **X25519** ECDH key exchange, **HKDF-SHA256** key derivation, and authenticated **AES-256-GCM** chunk encryption with replay protection.
- 🛡️ **Short Authentication String (SAS):** 16-digit safety fingerprint (e.g. `3726 9872 8519 2023`) derived deterministically from public keys to prevent MITM attacks.
- 📡 **Universal Discovery Engine:** Multi-transport discovery engine utilizing UDP multicast (`239.255.48.29:48290`), mDNS broadcast, and local subnet discovery.
- 🎛️ **Granular Device Visibility:** Choose between *Everyone Nearby*, *Contacts Only*, or *Invisible*, with temporary discovery timers (5, 10, or 30 minutes).
- 📷 **QR Fallback Pairing:** Secure temporary tokens formatted as `PAIR://v1/...` for instantaneous pairing without common network setup friction.
- 📦 **Streaming Chunked I/O:** Multi-gigabyte file transfers (100 MB, 1 GB, 5 GB, 10 GB+) without memory buffering. Includes byte-offset pause/resume checkpointing.
- 🎯 **Smart Network Selection:** `NetworkOptimizer` selects the fastest transport path (Direct Wi-Fi → Same LAN → Local Transport → Relay Fallback) with clear visual badges.
- 📱 **Complete 18-Screen Experience:** Splash, Home (with pulsing Aura radar), Nearby Devices, File Picker, Recipient Selection, Send Confirmation, Receiver Request modal, Transfer Preparation, Active Transfer, Completed celebration, Transfer History, Device Profile, Settings, Privacy Center, Security Center, Pairing, QR Pairing, and Help & Diagnostics.

---

## 📁 Monorepo Structure

```
airdrop/
├── apps/
│   ├── mobile/            # React Native / TypeScript mobile app (18 screens, state machine)
│   ├── backend/           # NestJS / Node.js backend (auth, presence, pairing, telemetry)
│   └── desktop/           # Desktop companion (P2P engine + Web GUI on localhost:48288)
├── packages/
│   ├── config/            # Protocol constants, ports, timeouts, chunk sizes
│   ├── types/             # Universal TypeScript types, 13 transfer states, protocol frames
│   ├── crypto/            # X25519, Ed25519, HKDF, AES-256-GCM AEAD, sanitizers
│   ├── protocol/          # P2PFS/1 binary framing encoder, stream decoder, 9-step handshake
│   ├── discovery/         # DiscoveryEngine (UDP multicast 48290, presence heartbeats)
│   ├── network/           # TcpTransport, WebSocketTransport, NetworkOptimizer
│   ├── transfer-engine/   # Streaming FileSender, FileReceiver, SpeedCalculator, Checkpoints
│   ├── database/          # Prisma schema (PostgreSQL) + LocalTransferHistoryStore
│   └── ui/                # Aura design tokens, glassmorphism, original vector icons, motion presets
├── tests/                 # End-to-end automated test suite
├── docs/                  # Architecture & protocol specification
├── pnpm-workspace.yaml    # Monorepo configuration
└── package.json           # Root scripts and build pipelines
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v20+ or v22+
- **pnpm** v10+

### Installation & Build

```bash
# 1. Install all dependencies across the monorepo
pnpm install

# 2. Build all packages and applications cleanly
pnpm build
```

---

## 🧪 Automated Test Suite

AuraDrop includes an end-to-end automated test suite that validates real cryptographic key exchange, streaming socket file transfers, chunked AEAD encryption, and path traversal security:

```bash
pnpm test:e2e
```

**Test Coverage Verified:**
- ✅ X25519 ECDH shared secret derivation
- ✅ HKDF-SHA256 session key derivation
- ✅ AEAD AES-256-GCM chunk encryption / decryption roundtrip
- ✅ AEAD rejection of tampered ciphertext
- ✅ Short Authentication String (SAS) safety fingerprint calculation
- ✅ QR code `PAIR://v1/...` generation and signature verification
- ✅ Path traversal & malicious filename neutralization (`../../etc/passwd`, Windows `CON`, illegal chars)
- ✅ `P2PFS/1` binary framing stream decoder reassembly
- ✅ **Real TCP Socket P2P File Transfer:** Direct socket connection, streaming encrypted chunks, disk write, and full-file SHA-256 byte-for-byte verification.

---

## 💻 Running the Applications

### 1. Desktop Client & Web Companion GUI

Launch the desktop client which starts the local P2P transfer server, UDP discovery announcer, and web interface:

```bash
cd apps/desktop
pnpm start
# Open http://localhost:48288 in your browser
```

Features active in the Desktop GUI:
- Pulsing Aura Radar displaying discovered nearby devices
- Drag & Drop file selection with automatic chunking
- Real-time progress bar with speed in MB/s and ETA calculation
- Incoming transfer approval modal with Accept / Decline
- Transfer history and QR pairing code display

### 2. Backend Server

Launch the NestJS-compatible backend services and WebSocket presence gateway:

```bash
cd apps/backend
pnpm start
# Server listens on http://localhost:48280
```

Provides the 10 core API modules:
- `/auth` (JWT authentication)
- `/users` (Profiles & contacts)
- `/devices` (Device registry & public keys)
- `/presence` (Active device heartbeats)
- `/sessions` (Signaling sessions)
- `/pairing` (Trusted pairing records)
- `/notifications` (Incoming transfer alerts)
- `/transfer-metadata` (Audit records without file contents)
- `/settings` (User privacy preferences)
- `/analytics` (Zero-PII throughput & reliability telemetry)

### 3. Mobile Application

```bash
cd apps/mobile
pnpm build
```

All 18 primary screens are implemented in `@auradrop/mobile` with strong typing, Reanimated-inspired motion physics, and reactive state store binding.

---

## 🔒 Security & Privacy Guarantees

1. **No Cloud Staging:** Local transfers flow strictly peer-to-peer over LAN or direct Wi-Fi.
2. **Authenticated Encryption:** All chunks are encrypted with AES-256-GCM and verified using 16-byte authentication tags.
3. **Strict Path Sanitization:** File paths received from remote peers are stripped of any directory traversal patterns to ensure downloads remain confined to the user's approved storage directory.
4. **Consent-First:** Transfers are never automatically accepted from unknown devices.
5. **No Key Logging:** Sensitive keys, credentials, and file contents are strictly prevented from appearing in diagnostics or logs.

---

## 📜 Protocol Specification

Refer to [`docs/ARCHITECTURE.md`](file:///c:/Users/bjasw/Downloads/airdrop/docs/ARCHITECTURE.md) for full protocol frame definitions, sequence diagrams, and cryptographic handshake state machines.
