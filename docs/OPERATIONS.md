# AuraDrop Production Operations & SRE Runbook

This guide contains operational commands, health check monitoring endpoints, logging standards, and incident response procedures for AuraDrop production infrastructure.

---

## 1. Health Checks & Monitoring Endpoints

| Endpoint | Protocol | Purpose | Expected Status |
|---|---|---|---|
| `/health` | HTTP GET | Node health, LAN IPs, active peer count | `200 OK` (`status: "healthy"`) |
| `/ws-health` | HTTP GET | WebSocket gateway liveness | `200 OK` (`websocketReady: true`) |
| `/presence/active` | HTTP GET | Active Redis presence peer count | `200 OK` |
| `/api/turn-credentials` | HTTP GET | coturn credential generation check | `200 OK` |

### Automated Health Check Probe (Curl):
```bash
curl -f -s http://127.0.0.1:48280/health | grep '"status":"healthy"' || exit 1
```

---

## 2. Metrics & Telemetry

Production instances output structured JSON logs:
- `[WS CONNECT]`: Inbound socket connection with remote IP.
- `[WS REGISTER]`: Device registration with platform and visibility.
- `[WS REDIS-RELAY]`: Inter-cluster message routing via Redis pub/sub.
- `[WS SIGNAL]`: Relayed WebRTC offers/answers with duration.
- `[WS CLOSE]`: Socket disconnection and presence eviction.

Recommended Prometheus metrics:
- `auradrop_active_websocket_connections`: Gauge tracking `wss.clients.size`.
- `auradrop_signaling_messages_total`: Counter tracking message types.
- `auradrop_signaling_latency_seconds`: Histogram of offer/answer forwarding latency.

---

## 3. Incident Runbooks

### Incident A: Peer Discovery Not Showing Nearby Devices
1. Verify signaling gateway liveness:
   ```bash
   curl http://<gateway-ip>:48280/health
   ```
2. Verify Redis presence keys:
   ```bash
   redis-cli keys "presence:*"
   ```
3. Ensure client visibility is set to `everyone` (not `off`).

### Incident B: Direct WebRTC Fails to Connect
1. Verify both devices can contact STUN/TURN servers.
2. Check `/api/turn-credentials` endpoint response.
3. Test coturn relay on port 3478/5349:
   ```bash
   turnutils_uclient -u test -w pass -s turn.auradrop.network -p 3478
   ```

### Incident C: High Memory / TCP Backlog Spikes
1. The WebSocket gateway implements safe sending with buffer limits:
   ```typescript
   ws.bufferedAmount < 2 * 1024 * 1024
   ```
2. Rate-limiter drops excess registration spam (`ratelimit:reg:<ip>`).
3. If memory grows beyond 512 MB, trigger rolling restart of backend container instances behind load balancer.
