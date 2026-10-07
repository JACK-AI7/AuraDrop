# AuraDrop Universal Transfer Protocol Specification (P2PFS/1)

The AuraDrop Universal Wire Protocol (`P2PFS/1`) defines the binary framing and state machine for direct, zero-cloud peer-to-peer file transfer over WebRTC DataChannels and local sockets.

---

## 1. Bit-Exact 20-Byte Wire Frame Header

Every packet transmitted across the data channel starts with a fixed-length 20-byte binary header, followed by an arbitrary payload:

```text
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Magic ('P2PF')                          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|    Version    |   Frame Type  |             Flags             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Payload Length                         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
+                    Sequence Number (64-bit)                   +
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Payload Bytes...                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Field Definitions:
1. **Magic Number (4 Bytes, Offset 0):** ASCII string `'P2PF'` (`0x50 0x32 0x50 0x46`). Validates that the receiver is reading an authentic AuraDrop stream.
2. **Protocol Version (1 Byte, Offset 4):** Constant `0x01` (`P2PFS/1`).
3. **Frame Type (1 Byte, Offset 5):** Enum identifying the packet type (see Section 2).
4. **Flags (2 Bytes, Offset 6, Big-Endian):**
   - Bit 0 (`0x0001`): `JSON_PAYLOAD` (payload is UTF-8 JSON text).
   - Bit 1 (`0x0002`): `BINARY_DATA` (payload is raw binary chunk).
   - Bit 2 (`0x0004`): `COMPRESSED` (payload is zlib compressed).
   - Bit 3 (`0x0008`): `ENCRYPTED` (payload contains AEAD auth tag).
   - Bit 4 (`0x0010`): `LAST_CHUNK` (final chunk of current file).
5. **Payload Length (4 Bytes, Offset 8, Big-Endian uint32):** Length in bytes of the following payload (0 to 16,777,216).
6. **Sequence Number (8 Bytes, Offset 12, Big-Endian uint64):** Monotonically increasing sequence ID for packet order verification and reordering detection.

---

## 2. Frame Types

```typescript
export enum FrameType {
  // Handshake & Authentication (0x01 - 0x0F)
  HANDSHAKE_INIT         = 0x01,
  HANDSHAKE_RESP         = 0x02,
  AUTH_CHALLENGE         = 0x03,
  AUTH_VERIFY            = 0x04,
  CAPABILITIES_EXCHANGE  = 0x05,

  // Transfer Negotiation & Consent (0x10 - 0x1F)
  NEGOTIATION_REQUEST    = 0x10,
  NEGOTIATION_RESPONSE   = 0x11,

  // File Data Streaming (0x20 - 0x2F)
  FILE_START             = 0x20,
  CHUNK_DATA             = 0x21,
  CHUNK_ACK              = 0x22,
  FILE_END               = 0x23,
  TRANSFER_COMPLETE      = 0x24,

  // Stream Flow Control (0x30 - 0x3F)
  TRANSFER_PAUSE         = 0x30,
  TRANSFER_RESUME        = 0x31,
  TRANSFER_CANCEL        = 0x32,
  TRANSFER_ERROR         = 0x33,

  // Liveness Check (0xF0 - 0xFF)
  PING                   = 0xF0,
  PONG                   = 0xF1,
}
```

---

## 3. Transfer Lifecycle

```
Sender                                                         Receiver
  │                                                               │
  │─── Frame: NEGOTIATION_REQUEST ───────────────────────────────►│
  │    { transferId, files: [{ id, name, size, checksum }] }      │
  │                                                               │
  │◄── Frame: NEGOTIATION_RESPONSE ───────────────────────────────│
  │    { transferId, accepted: true, resumeOffsets: { ... } }     │
  │                                                               │
  │─── Frame: FILE_START ────────────────────────────────────────►│
  │    { fileId, filename, size, checksum }                       │
  │                                                               │
  │─── Frame: CHUNK_DATA (64 KB) ────────────────────────────────►│ (Disk stream write)
  │─── Frame: CHUNK_DATA (64 KB) ────────────────────────────────►│
  │    ...                                                        │
  │─── Frame: CHUNK_DATA (flags: LAST_CHUNK) ────────────────────►│
  │                                                               │
  │─── Frame: FILE_END ──────────────────────────────────────────►│
  │                                                               │ (Compute SHA-256)
  │                                                               │ (Verify against header)
  │◄── Frame: CHUNK_ACK / TRANSFER_COMPLETE ──────────────────────│ (Atomic commit)
```

---

## 4. Backpressure & Chunk Sizing
- **Default Chunk Size:** 64 KB (65,536 bytes).
- **High-Water Buffer Threshold:** 16 MB. When `dataChannel.bufferedAmount > 16 MB`, transmission halts.
- **Low-Water Resumption Threshold:** 4 MB. When `bufferedAmount <= 4 MB`, streaming resumes.
- **Memory Consumption:** Stays under 30 MB regardless of file size (tested up to 50 GB).
