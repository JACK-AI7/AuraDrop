# AuraDrop V16 — Database Architecture (Neon PostgreSQL)

AuraDrop uses Neon Serverless PostgreSQL as its primary durable data tier, augmented with connection pooling and an in-memory repository fallback for offline/isolated execution.

---

## 1. Schema Overview

The relational model consists of 13 strongly typed, normalized tables defined in `packages/database/migrations/001_initial_schema.sql`:

```
┌──────────────┐       ┌────────────────────┐
│    users     │◄──────┤  user_preferences  │
└──────┬───────┘       └────────────────────┘
       │
       ├──────────────►┌────────────────────┐
       │               │ refresh_sessions   │
       │               └────────────────────┘
       ├──────────────►┌────────────────────┐
       │               │ verification_tokens│
       │               └────────────────────┘
       ├──────────────►┌────────────────────┐
       │               │     contacts       │
       │               └────────────────────┘
       ├──────────────►┌────────────────────┐
       │               │visibility_settings │
       │               └────────────────────┘
       ├──────────────►┌────────────────────┐
       │               │      devices       │◄─────┐
       │               └────────┬───────────┘      │
       │                        │                  │
       │                        ▼                  │
       │               ┌────────────────────┐      │
       │               │  device_sessions   │      │
       │               └────────────────────┘      │
       │                        │                  │
       │                        ▼                  │
       │               ┌────────────────────┐      │
       │               │   trusted_devices  ├──────┘
       │               └────────────────────┘
       │
       ▼
┌──────────────────────┐       ┌────────────────────┐
│  transfer_sessions   │◄──────┤   transfer_files   │
└──────────┬───────────┘       └────────────────────┘
           │
           ▼
┌──────────────────────┐       ┌────────────────────┐
│   transfer_events    │       │  security_events   │
└──────────────────────┘       └────────────────────┘
```

---

## 2. Table Specifications

### 2.1 `users`
- `id` (VARCHAR(64), PK): Unique user identifier (`usr_...`).
- `email` (VARCHAR(255), UNIQUE): User email address.
- `email_normalized` (VARCHAR(255), UNIQUE, INDEX): Lowercase trimmed email for fast lookup.
- `password_hash` (VARCHAR(255)): Salted bcryptjs hash (10 rounds).
- `display_name` (VARCHAR(100)): User visible name.
- `username` (VARCHAR(50), UNIQUE, INDEX): Canonical unique username handle.
- `avatar_url` (VARCHAR(512)): Profile avatar URI.
- `status` (VARCHAR(20)): Account status (`active`, `suspended`, `deleted`).
- `created_at`, `updated_at`, `last_login_at`, `deleted_at`: Timestamps.

### 2.2 `user_preferences`
- `user_id` (VARCHAR(64), PK, FK -> users): 1:1 user preferences mapping.
- `theme` (VARCHAR(20)): `dark`, `light`, `system`.
- `default_visibility` (VARCHAR(20)): `EVERYONE`, `CONTACTS`, `TRUSTED`, `NO_ONE`.
- `auto_accept` (BOOLEAN): Auto-accept transfers from trusted contacts.
- `notifications_enabled`, `sound_enabled`, `vibration_enabled`: Notification flags.
- `download_directory_preference` (VARCHAR(512)): Preferred save directory.

### 2.3 `devices`
- `id` (VARCHAR(64), PK): Unique device identifier (`dev_...`).
- `user_id` (VARCHAR(64), FK -> users): Owner account or NULL for anonymous device.
- `device_public_key` (VARCHAR(512)): Device cryptographic public key (X25519/Ed25519).
- `device_name` (VARCHAR(100)): Hostname / user-friendly device label.
- `platform` (VARCHAR(30)): `windows`, `macos`, `linux`, `android`, `ios`, `web`.
- `protocol_version` (VARCHAR(30)): Default `P2PFS/1`.
- `capabilities_json` (JSONB): Device capability flags.
- `last_seen_at` (TIMESTAMPTZ, INDEX): Liveness timestamp.

### 2.4 `device_sessions`
- `id` (VARCHAR(64), PK): Session identifier.
- `device_id` (VARCHAR(64), FK -> devices): Target device.
- `connection_id` (VARCHAR(64)): WebSocket client identifier.
- `session_token_hash` (VARCHAR(128)): Session authentication token hash.
- `connected_at`, `last_heartbeat_at`, `disconnected_at`: Liveness lifecycle.

### 2.5 `trusted_devices`
- `id` (VARCHAR(64), PK)
- `user_id` (VARCHAR(64), FK -> users)
- `device_id` (VARCHAR(64), FK -> devices)
- `trusted_device_id` (VARCHAR(64), FK -> devices)
- `trust_level` (VARCHAR(20)): `trusted`, `permanent`, `pairing`.
- UNIQUE constraint on `(user_id, device_id, trusted_device_id)`.

### 2.6 `contacts`
- `id` (VARCHAR(64), PK)
- `owner_user_id` (VARCHAR(64), FK -> users)
- `contact_user_id` (VARCHAR(64), FK -> users)
- `nickname` (VARCHAR(100))
- `relationship` (VARCHAR(30)): `contact`, `friend`, `family`, `blocked`.

### 2.7 `visibility_settings`
- `user_id` (VARCHAR(64), PK, FK -> users)
- `mode` (VARCHAR(20)): Current discovery visibility (`EVERYONE`, `CONTACTS`, `TRUSTED`, `NO_ONE`).

### 2.8 `transfer_sessions`
- `id` (VARCHAR(64), PK): Unique transfer ID (`tx_...`).
- `sender_device_id`, `receiver_device_id`: Device endpoints.
- `status` (VARCHAR(30)): `REQUESTED`, `ACCEPTED`, `DECLINED`, `TRANSFERRING`, `COMPLETED`, `FAILED`, `CANCELLED`.
- `total_bytes` (BIGINT), `transferred_bytes` (BIGINT).
- `file_count` (INT).
- `created_at`, `started_at`, `completed_at`, `failed_at`, `failure_code`.

### 2.9 `transfer_files`
- `id` (VARCHAR(64), PK)
- `transfer_session_id` (VARCHAR(64), FK -> transfer_sessions)
- `file_name` (VARCHAR(255))
- `file_size` (BIGINT)
- `mime_type` (VARCHAR(100))
- `sha256` (VARCHAR(64)): Hex SHA-256 integrity checksum.
- `verified_offset` (BIGINT): Last verified byte for resuming.

### 2.10 `transfer_events`
- `id` (VARCHAR(64), PK)
- `transfer_session_id` (VARCHAR(64), FK -> transfer_sessions)
- `event_type` (VARCHAR(50)): `REQUESTED`, `ACCEPTED`, `CHUNK_VERIFIED`, etc.
- `metadata_json` (JSONB)

### 2.11 `refresh_sessions`
- `id` (VARCHAR(64), PK)
- `user_id` (VARCHAR(64), FK -> users)
- `token_hash` (VARCHAR(128), UNIQUE, INDEX): SHA-256 hash of refresh token.
- `expires_at` (TIMESTAMPTZ)
- `revoked_at` (TIMESTAMPTZ)

### 2.12 `verification_tokens`
- Email verification and password reset token hashes with expiration.

### 2.13 `security_events`
- Audit log of security alerts (`login_failure`, `token_revocation`, `rate_limit_exceeded`).

---

## 3. Connection Pooling & Environment Setup

Neon PostgreSQL uses TLS connection strings:
```bash
DATABASE_URL="postgres://auradrop_user:secret@ep-cool-frost-12345.us-east-2.aws.neon.tech/auradrop?sslmode=require"
```

The database client (`NeonDatabaseClient` in `packages/database/src/neon-client.ts`) automatically configures:
- Connection pool max: 20
- Idle timeout: 30,000 ms
- Connection timeout: 5,000 ms
- SSL: `{ rejectUnauthorized: false }` for Neon serverless compatibility.
