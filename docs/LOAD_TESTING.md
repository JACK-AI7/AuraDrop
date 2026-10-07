# AuraDrop 1,000-Device High-Concurrency Load Benchmark

This document details the test methodology, execution parameters, and performance results of the 1,000 concurrent device load test executed against the AuraDrop signaling gateway (`tests/load-test-1000-devices.ts`).

---

## 1. Test Architecture

The load test simulates 1,000 simultaneous distinct physical devices connected via WebSocket:
- Platform mix: 50% Android, 50% Windows Desktop.
- Ramp stages: 100 → 250 → 500 → 750 → 1,000 devices.
- Batching: 40 devices/batch with 25 ms inter-batch spacing to prevent TCP `somaxconn` exhaustion on Windows/Linux host sockets.
- Each device registers, joins the distributed presence registry, executes heartbeat pings, and verifies bidirectional WebRTC signaling relay.

---

## 2. Empirical Benchmark Results

### 2.1 Connection Ramp Time & Memory Delta

| Concurrent Devices | Ramp Duration | Process RSS | Memory Delta | Heap Used |
|---|---|---|---|---|
| **Baseline (0)** | 0.00s | 89.44 MB | 0.00 MB | 19.23 MB |
| **100 Devices** | 0.52s | 97.60 MB | +8.16 MB | 18.01 MB |
| **250 Devices** | 0.61s | 99.14 MB | +9.71 MB | 14.87 MB |
| **500 Devices** | 1.03s | 117.00 MB | +27.56 MB | 18.96 MB |
| **750 Devices** | 1.42s | 119.61 MB | +30.17 MB | 21.21 MB |
| **1,000 Devices** | 1.24s | 122.40 MB | **+32.96 MB** | **19.10 MB** |

**Summary:** Total ramp time for 1,000 devices was **4.82 seconds**, consuming only **32.96 MB of RAM** (+33 KB per active WebSocket connection).

### 2.2 Heartbeat Ping/Pong Latency (Sampled at 1,000 Peers)

| Metric | Measured Value | Threshold | Status |
|---|---|---|---|
| Min Latency | 17.21 ms | < 50 ms | PASS |
| Average Latency | **18.06 ms** | < 100 ms | **PASS** |
| 95th Percentile | **19.09 ms** | < 150 ms | **PASS** |
| Max Latency | 19.12 ms | < 250 ms | PASS |

### 2.3 WebRTC Signaling Relay Latency
- Sender: Device 0 (`dev_sim_0000`).
- Target: Device 999 (`dev_sim_0999`).
- Relay Duration: **0.79 ms** (sub-millisecond across full 1,000-device registry).
- Socket Drops / Disconnects: **0** (100% connection retention).

---

## 3. Running the Benchmark

```bash
pnpm test:load
```
