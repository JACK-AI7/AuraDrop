# AuraDrop Architecture & P2PFS/1 Specification

AuraDrop is a production-grade cross-platform peer-to-peer file-sharing system inspired by the simplicity and polish of modern nearby-sharing experiences, engineered from the ground up with a completely original visual identity, custom networking stack, and zero cloud dependency for local transfers.

---

## 1. Core Architectural Principle

```
DEVICE A (Sender)
   │
   ▼  [1. UDP Multicast / mDNS Beacon (48290)]
Discovery
   │
   ▼  [2. X25519 ECDH + Ed25519 Handshake]
Secure Authenticated Handshake
   │
   ▼  [3. Direct TCP / Wi-Fi Direct (48291)]
Direct P2P Stream Connection
   │
   ▼  [4. AEAD AES-256-GCM + SHA-256 Streaming Chunks]
Encrypted File Stream
   │
   ▼  [5. Atomic Checksum Validation & Verification]
DEVICE B (Receiver)
```

Normal local transfers **never** touch any cloud or relay server. The backend is strictly utilized for user profiles, device registry, optional contact discovery, and push alerts.

---

## 2. Universal Transfer Protocol (P2PFS/1)

The AuraDrop protocol `P2PFS/1` operates as a binary framed streaming protocol designed for high throughput and authenticated integrity.

### 2.1 Binary Framing Structure

Every protocol frame starts with a fixed 20-byte header:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                      Magic: 'P2PF' (4 bytes)                  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Version (0x01)| FrameType (1B)|         Flags (2 bytes)       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Payload Length (4 bytes uint32)           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
+                 Sequence Number (8 bytes uint64)              +
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Payload (N bytes)                         |
|                             ...                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|            Optional AEAD Authentication Tag (16 bytes)        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### 2.2 9-Step Handshake Lifecycle

1. **Device Discovery:** Periodic UDP beacon on `239.255.48.29:48290` / mDNS.
2. **Capability Exchange:** Negotiate chunk sizes (64KB - 1MB), protocol version, resume support.
3. **Public-Key Exchange:** Ephemeral X25519 ECDH key generation.
4. **Authentication:** Ed25519 cryptographic signatures verify nonces and prevent impersonation.
5. **Session Establishment:** HKDF-SHA256 expands shared secret into 256-bit symmetric session key with deterministic IV.
6. **Transfer Negotiation:** Sender presents manifest (filenames, sizes, MIME types, full-file SHA-256 digests). Receiver UI prompts user with **Accept** or **Decline**.
7. **Encrypted Stream:** Files read in streaming chunks, encrypted with AES-256-GCM AEAD, and pushed over TCP.
8. **Integrity Verification:** Receiver decrypts chunks into `.part` temporary file, continuously calculating streaming SHA-256 digest. Upon `FILE_END`, checksum is checked before atomic rename.
9. **Completion Acknowledgement:** Both devices receive `TRANSFER_COMPLETE` and log to local encrypted history.

---

## 3. Cryptography & Security Architecture

- **Authenticated Encryption (AEAD):** AES-256-GCM encrypts every discrete chunk with a 96-bit unique nonce constructed from a random transfer salt and monotonically increasing chunk counter.
- **Perfect Forward Secrecy (PFS):** Fresh ephemeral X25519 keypairs are generated for every transfer session.
- **Short Authentication String (SAS):** Both devices display an identical 16-digit safety code (e.g. `3726 9872 8519 2023`) derived from the sorted public keys to verify against Man-in-the-Middle (MITM) attacks.
- **Path Traversal Protection:** All incoming filenames are rigorously sanitized (`sanitizeFilename`), stripping directory separators (`../`, `..\`), Windows reserved device handles (`CON`, `PRN`, `AUX`, `NUL`), control characters, and null bytes.
- **Zero Sensitive Logging:** Private keys, plaintext file bytes, and session tokens are strictly excluded from logging.

---

## 4. Smart Network Selection (NetworkOptimizer)

The `NetworkOptimizer` selects the fastest available transport path according to strict priority:

1. **Priority 1: Direct Wi-Fi / P2P** (Local hotspot / Wi-Fi Direct interfaces e.g. `192.168.49.x`).
2. **Priority 2: Same Local Network (LAN TCP)** (Direct socket probes over the local router/switch).
3. **Priority 3: WebRTC DataChannel** (Local peer-to-peer connection).
4. **Priority 4: Relay Fallback** (Only engaged when explicitly enabled by user settings with clear UI labeling).

The UI explicitly displays the active transport mode:
- *"Connected directly"* (Emerald indicator)
- *"Using local network"* (Aura Cyan indicator)
- *"Using relay"* (Amber warning indicator)

---

## 5. Streaming & Large File Handling

Multi-gigabyte files (100MB, 1GB, 5GB, 10GB+) are transferred with constant minimal memory usage (under 50 MB RAM) by streaming chunked I/O:
- Chunk size defaults to 256 KB.
- Files written to `${DownloadDir}/${SanitizedFilename}.part` during active transfer.
- Checkpoints saved in `.auradrop_checkpoints` allowing resumption from the exact byte offset where an interrupted connection dropped.
- Exponential Moving Average (EWMA, $\alpha = 0.25$) calculates smooth transfer speeds (MB/s) and estimated time of arrival (ETA).
