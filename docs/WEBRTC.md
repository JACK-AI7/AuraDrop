# AuraDrop WebRTC Data Plane Architecture

AuraDrop uses WebRTC DataChannels (`RTCDataChannel`) configured for high-speed, reliable SCTP binary transport.

---

## 1. PeerConnection Configuration

```typescript
export const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    // Production coturn TURN credentials fetched dynamically from /api/turn-credentials
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};
```

---

## 2. DataChannel Configuration

DataChannels are created with **strict reliability** for lossless file streaming:
```typescript
const dataChannel = peerConnection.createDataChannel('auradrop-data-v1', {
  ordered: true,                 // Guaranteed in-order chunk delivery
  maxRetransmits: null,          // Unlimited retransmits (lossless)
  protocol: 'P2PFS/1',           // Universal wire protocol identifier
  binaryType: 'arraybuffer',     // Zero-copy binary buffer
});
```

---

## 3. Backpressure Flow Control Algorithm

WebRTC DataChannels queue packets in an internal native send buffer. If the application pushes data faster than the physical Wi-Fi/NIC link can transmit, unbounded buffering will crash the browser/process with `OutOfMemoryError`.

AuraDrop implements a strict hysteresis controller:

```typescript
const HIGH_WATER_MARK = 16 * 1024 * 1024; // 16 MB
const LOW_WATER_MARK = 4 * 1024 * 1024;   // 4 MB

async function sendChunk(channel: RTCDataChannel, chunk: Uint8Array): Promise<void> {
  // Check send buffer
  if (channel.bufferedAmount > HIGH_WATER_MARK) {
    await new Promise<void>((resolve) => {
      channel.bufferedAmountLowThreshold = LOW_WATER_MARK;
      const onLow = () => {
        channel.removeEventListener('bufferedamountlow', onLow);
        resolve();
      };
      channel.addEventListener('bufferedamountlow', onLow);
    });
  }

  channel.send(chunk);
}
```

---

## 4. Connection State Machine

```
   ┌───────────┐
   │    NEW    │
   └─────┬─────┘
         │ createOffer() / createAnswer()
         ▼
   ┌───────────┐
   │ CHECKING  │◄─── ICE Candidate Exchange (host, srflx, relay)
   └─────┬─────┘
         │ Direct LAN or STUN match
         ▼
   ┌───────────┐
   │ CONNECTED │─── DataChannel 'open' event
   └─────┬─────┘
         │ Physical link intact
         ▼
   ┌───────────┐
   │ STREAMING │─── 64 KB chunk loop with SHA-256 verification
   └─────┬─────┘
         │ File End & Hash Match
         ▼
   ┌───────────┐
   │ COMPLETED │─── Atomic file commit & UI success notice
   └───────────┘
```

If state transitions to `FAILED` or `DISCONNECTED`, the engine automatically renegotiates ICE or falls back to TURN relay.
