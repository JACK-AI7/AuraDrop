# AURADROP V21 — ARCHITECTURE AUDIT & PRODUCTION REBUILD SPECIFICATION

**Date:** October 8, 2026  
**Status:** In Progress — Pre-Implementation Architectural Analysis  
**Auditor:** Principal Systems, Networking, Android, and WebRTC Engineer  

---

## 1. Current Working Components

| Component | Status | Operational Details |
| :--- | :--- | :--- |
| **Neon PostgreSQL Pooling & Schema** | **WORKING** | `active_peers`, `signaling_messages`, `conversations`, `messages` schema tables with connection pooling, SSL mode handling, and non-blocking query execution. |
| **Chrome Private Network Access (PNA)** | **WORKING** | Preflight `OPTIONS` response returning `Access-Control-Allow-Private-Network: true` alongside CORS headers for browser-to-LAN communication. |
| **Direct Binary Disk Streaming (Dart & Node)** | **WORKING** | Stream-to-disk writing into temporary `.part` files with atomic rename upon verification, zero in-memory buffer bloat. |
| **Incremental SHA-256 (FIPS 180-4)** | **WORKING** | Chunk-by-chunk cryptographic hash accumulation preventing RAM spikes for large files (100 MB–5 GB). |
| **Android Release Compilation** | **WORKING** | `flutter build apk --release` generates production APK (90.5 MB) cleanly. |
| **Web Production Vite Bundling** | **WORKING** | `pnpm --filter web build` builds with 0 errors and syncs to `public/`. |
| **End-to-End Chat Persistence** | **WORKING** | Neon DB-backed direct and group conversations with disappearing message intervals. |

---

## 2. Current Broken Components & Regressions

| Component | Status | Symptom / Failure Mode |
| :--- | :--- | :--- |
| **Desktop UI Structure (V20 Regression)** | **BROKEN** | In V20, the UI was converted into an unapproved two-column dashboard layout that removed `DockedShareTray`, `FloatingSideRail`, and `GitHubStarBar`, deviating from the approved visual system. |
| **Android Production Signaling Target** | **BROKEN** | `apps/android/lib/services/aura_signaling_service.dart` hardcoded `defaultProductionSignalingUrl` to `http://192.168.0.8:5173/api/signaling` (a developer localhost IP). A standalone Android phone installing the APK could never reach the Vercel signaling server. |
| **Android Local Server Protocol** | **INCOMPLETE** | Did not follow the specified `/api/auradrop/v1/*` endpoint schema (`/info`, `/prepare-upload`, `/upload`, `/cancel`, `/health`) with per-transfer single-use expiring security tokens. Trusted IP addresses alone. |
| **Vercel API Route Coverage** | **MISSING ROUTE** | `GET /api/health` was missing, causing health checks against the deployment to return 404. |
| **Presence Heartbeat Consistency** | **DEGRADED** | Heartbeats lacked strict 5-second intervals and 15-second server-side expiry, risking ghost peer persistence. |

---

## 3. Root Cause Analysis

1. **Signaling Endpoint Disconnect:**  
   The Android client initialized its signaling service pointing to `192.168.0.8:5173` rather than resolving the production signaling URL or scanning a pairing token from the Vercel web app. Consequently, the Android app never reached the cloud control plane in real environments.

2. **UI Restructuring over Restoration:**  
   Instead of maintaining the approved single-page layout from commit `8dabf0c` and replacing the 3D globe with the authoritative device list, V20 replaced the entire layout structure, stripping the `DockedShareTray`, `FloatingSideRail`, and standard modals.

3. **Insecure Local Server Contract:**  
   The local server accepted uploads without validating a time-bounded, single-use transfer token (`oneTimeToken`, `transferId`, `fileId`, `expiresAt`, `sha256`), failing the zero-trust requirement.

---

## 4. Proposed Fixes & Implementation Plan

### Fix 1: Restore Known-Good UI from Git History (`8dabf0c`)
- Restore the visual structure of `8dabf0c`: `GitHubStarBar`, Minimal Header, Status Bar, `FloatingSideRail`, `DockedShareTray`, and Modals.
- Replace the dead-center 3D `HeroGlobe` with the **Authoritative Nearby Devices List**:
  ```text
  Nearby Devices
  ┌─────────────────────────────┐
  │  [Avatar]                   │
  │  Jaswanth's Galaxy          │
  │  Android                    │
  │                             │
  │  ● Connected                │
  │  ⚡ Direct LAN              │
  │                             │
  │  [Send Files] [Chat]        │
  └─────────────────────────────┘
  ```
- **Zero fake visuals**: NO `HeroGlobe`, NO `FluidProximityAura`, NO `ProximityRipple`, NO fake radar, NO fake Dynamic Island.

### Fix 2: Android Production Signaling & QR Pairing
- Update `AuraSignalingService` on Android to support:
  1. Default production URL setting.
  2. Immediate QR code / URL configuration from the Vercel Desktop web interface (e.g. `auradrop://pair?url=...`).
  3. Real device registration including `deviceId`, `deviceName`, `platform`, `localIp`, `localPort`, `capabilities`, `protocolVersion`, `timestamp`.
  4. 5-second heartbeats and 15-second server-side eviction.

### Fix 3: Standardize AuraDrop V1 Local Protocol in `AuraLanServer`
Implement the strict REST specification:
- `GET /api/auradrop/v1/info`
- `GET /api/auradrop/v1/health`
- `POST /api/auradrop/v1/prepare-upload` (generates and returns single-use `oneTimeToken` with 60s TTL)
- `POST /api/auradrop/v1/upload` (validates `oneTimeToken`, streams to `.part`, verifies SHA-256, renames)
- `POST /api/auradrop/v1/cancel`
- Chrome Private Network Access CORS headers (`Access-Control-Allow-Private-Network: true`).

### Fix 4: Serverless Signaling & Health APIs
- Implement `api/health.ts` for deployment diagnostics.
- Ensure `api/signaling.ts` registers full device metadata, enforces 15-second timeouts, and drains queued signaling messages.

### Fix 5: Verification Suite
- Implement `tests/test-v21-real-lan.ts` validating the `/api/auradrop/v1/*` protocol.
- Run complete test matrix and compile production release APK to `C:\Users\bjasw\Downloads\AuraDrop-release.apk`.
