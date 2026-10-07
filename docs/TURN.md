# AuraDrop coturn & NAT Traversal Architecture

When devices are behind Symmetric NATs, enterprise firewalls, or carrier-grade NAT (CGNAT), direct P2P connections cannot bind. AuraDrop deploys `coturn` as a high-throughput TURN relay fallback.

---

## 1. Production `turnserver.conf`

```ini
# /etc/turnserver.conf - AuraDrop Production Configuration

# Network bindings
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0

# External Public IP of TURN server
external-ip=198.51.100.1

# Realm & Auth Mechanism
realm=auradrop.network
use-auth-secret
static-auth-secret=auradrop-production-coturn-shared-secret-2026

# Relay UDP port range (Open in Security Group / Firewall)
min-port=49152
max-port=65535

# Fingerprint in TURN messages
fingerprint

# Longevity & performance
total-quota=100000
bps-capacity=0
stale-nonce=600
no-loopback-peers
no-multicast-peers

# TLS certificates (Let's Encrypt)
cert=/etc/letsencrypt/live/turn.auradrop.network/fullchain.pem
pkey=/etc/letsencrypt/live/turn.auradrop.network/privkey.pem
```

---

## 2. Ephemeral Credential Generation (REST API)

Clients never receive the master TURN secret. The backend exposes `GET /api/turn-credentials`, generating short-lived HMAC-SHA1 tokens according to RFC 5766:

```typescript
function generateTurnCredentials(userId: string, ttlSeconds = 86400) {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiry}:${userId}`;
  const hmac = crypto.createHmac('sha1', process.env.TURN_SECRET!);
  hmac.update(username);
  const credential = hmac.digest('base64');

  return {
    username,
    credential,
    ttl: ttlSeconds,
    urls: [
      'stun:turn.auradrop.network:3478',
      'turn:turn.auradrop.network:3478?transport=udp',
      'turn:turn.auradrop.network:3478?transport=tcp',
      'turns:turn.auradrop.network:5349?transport=tcp',
    ],
  };
}
```

---

## 3. Verification & Diagnostic Commands

Test TURN connectivity using `turnutils_uclient`:

```bash
# 1. Test UDP TURN Relay
turnutils_uclient -u "1791468694:jaswanth" -w "<base64_hmac>" -s turn.auradrop.network -p 3478

# 2. Test TCP Encrypted TURNS Relay
turnutils_uclient -u "1791468694:jaswanth" -w "<base64_hmac>" -s turn.auradrop.network -p 5349 -t -T
```
