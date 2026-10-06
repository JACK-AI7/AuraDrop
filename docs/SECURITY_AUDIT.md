# AuraDrop Security Audit & Threat Model

This document outlines the security audit, threat vectors, and defense-in-depth mitigations implemented in AuraDrop.

---

## 1. Threat Vectors & Defense Invariants

### 1.1 Path Traversal & Directory Escape
- **Threat:** A malicious sender transmits a filename like `../../../../Windows/System32/drivers/etc/hosts` or `../../../.bashrc` to overwrite critical system files.
- **Mitigation:**
  - `sanitizeFilename()` in `@auradrop/crypto` strips all relative path tokens (`../`, `..\`), slashes, backslashes, control characters, and null bytes (`\x00`).
  - Filename extraction only takes the final basename.
  - Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`) are prefixed with `file_`.
  - Target destination path is strictly prepended: files can only be written inside the configured downloads folder.
- **Audit Result:** ✅ **PASSED** (Validated in automated tests).

---

### 1.2 Man-in-the-Middle (MITM) & Eavesdropping
- **Threat:** An active attacker on the same local Wi-Fi router intercepts or tampers with file bytes.
- **Mitigation:**
  - Ephemeral **X25519** ECDH key exchange generates Perfect Forward Secrecy (PFS) session keys.
  - Symmetric cipher suite: **AES-256-GCM** with 16-byte authentication tags (AEAD).
  - Short Authentication String (SAS): Both devices compute and display a deterministic 16-digit safety code derived from the sorted public keys (e.g. `3726 9872 8519 2023`).
  - Any byte tampering immediately causes AEAD tag verification to fail, terminating the transfer.
- **Audit Result:** ✅ **PASSED** (Validated in automated tests).

---

### 1.3 Replay Attacks
- **Threat:** An attacker captures valid encrypted chunk frames and replays them to corrupt the file stream.
- **Mitigation:**
  - Each chunk uses a unique 96-bit (12-byte) initialization vector (IV) composed of a random transfer salt concatenated with an 8-byte big-endian monotonically increasing chunk counter.
  - Chunk sequence counter is bound to AES-256-GCM Additional Authenticated Data (AAD).
  - Replayed or out-of-order frames fail authentication.
- **Audit Result:** ✅ **PASSED** (Validated in automated tests).

---

### 1.4 Expired QR Pairing & Token Hijacking
- **Threat:** An attacker photographs a QR code and attempts to use it later.
- **Mitigation:**
  - QR codes encode signed payload strings `PAIR://v1/...` with an embedded expiration timestamp (`expiresAt`, default 5 minutes).
  - Nonce prevents replay.
  - `parseAndVerifyQrPairingPayload()` rejects tokens if current time > `expiresAt`.
- **Audit Result:** ✅ **PASSED** (Validated in automated tests).

---

### 1.5 Sensitive Data Leakage in Logs
- **Threat:** Private keys, encryption secrets, or confidential file contents leak into console logs or analytics.
- **Mitigation:**
  - `AnalyticsService` explicitly deletes `privateKey`, `token`, and `fileContents` prior to recording events.
  - Structured logs only record transfer IDs, byte totals, and throughput metrics.
- **Audit Result:** ✅ **PASSED**.
