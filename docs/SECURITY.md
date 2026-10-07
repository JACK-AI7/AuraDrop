# AuraDrop Security & Cryptography Architecture

Security in AuraDrop is based on cryptographic trust, end-to-end transport isolation, and zero-knowledge cloud principles.

---

## 1. Threat Model & Security Posture

### 1.1 Zero File Data Exposure
- File content bytes are **never** uploaded to, processed by, or cached on the backend signaling cluster or Vercel edge.
- All file chunks travel exclusively point-to-point over DTLS-SRTP encrypted WebRTC DataChannels.

### 1.2 Man-in-the-Middle (MitM) Resistance
- Signaling is performed over TLS / WSS.
- WebRTC peers exchange cryptographic fingerprints via SDP offers and answers.
- Direct DTLS 1.2/1.3 handshakes establish ephemeral symmetric session keys directly between peers.

### 1.3 Anti-Replay & Refresh Token Protection
- Refresh tokens are single-use (`rotate` on every refresh call).
- Stored exclusively as SHA-256 hashes in `refresh_sessions`.
- Replaying a consumed refresh token immediately invalidates all active sessions for the compromised user account.

---

## 2. Integrity Verification (Incremental SHA-256)

To prevent file corruption and malicious tampering:
1. The sender calculates an initial SHA-256 checksum during file preparation.
2. The checksum is included in the signed `FILE_START` frame.
3. The receiver feeds every incoming 64 KB chunk into an incremental SHA-256 digest engine as it writes to disk.
4. When `FILE_END` arrives, the final calculated digest is compared against the header.
5. If the hash fails:
   - The file is deleted immediately.
   - A `TRANSFER_ERROR` alert is broadcast.
   - The transfer is logged as `FAILED` in the security audit table.

---

## 3. Strict HTTP Security Headers
Every HTTP response from the backend enforces OWASP-recommended headers:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`

---

## 4. Rate Limiting
- `POST /auth/register`: 10 requests / minute per IP.
- `POST /auth/login`: 20 requests / minute per IP.
- Sliding window counters backed by Redis prevent credential stuffing and brute-force attacks.
