# AuraDrop V16 — Authentication & Session Architecture

AuraDrop implements a modern token rotation authentication flow with device identity binding and offline capability.

---

## 1. Authentication Flow

```
Client                             Backend Gateway                    Neon PostgreSQL
  │                                       │                                  │
  │─── POST /auth/register ──────────────►│                                  │
  │    (email, username, password)        │─── Hash password (bcryptjs) ────►│
  │                                       │─── Create user + preferences ───►│
  │                                       │─── Create refresh_session ──────►│
  │◄── { accessToken, refreshToken } ─────│                                  │
  │                                       │                                  │
  │─── GET /auth/me (Bearer token) ──────►│                                  │
  │                                       │─── Verify HS256 JWT signature    │
  │◄── { user, preferences } ─────────────│                                  │
  │                                       │                                  │
  │─── POST /auth/refresh ───────────────►│                                  │
  │    (refreshToken)                     │─── SHA-256 hash lookup ─────────►│
  │                                       │─── Rotate token in DB ──────────►│
  │◄── { newAccessToken, newRefreshToken }│                                  │
```

---

## 2. Password Security & Hashing
- **Algorithm:** `bcryptjs` with salt rounds = 10.
- Passwords are never logged or stored in plain text.
- Normalized email index (`email_normalized`) ensures case-insensitive uniqueness without table scans.

---

## 3. Token Strategy

### 3.1 Access Tokens
- **Format:** JSON Web Token (JWT) signed with HMAC-SHA256 (`HS256`).
- **Lifespan:** 15 minutes (900 seconds).
- **Payload:**
  ```json
  {
    "userId": "usr_...",
    "username": "jaswanth",
    "email": "jaswanth@example.com",
    "deviceId": "dev_...",
    "exp": 1791383195
  }
  ```
- **Verification:** Evaluated statelessly using `crypto.createHmac('sha256', JWT_SECRET)` on the backend.

### 3.2 Refresh Tokens
- **Format:** Cryptographically secure 256-bit random hex string (`rt_<64 hex chars>`).
- **Lifespan:** 30 days.
- **Storage:** Only the SHA-256 hash of the token is stored in the database (`refresh_sessions` table).
- **Rotation:** Every time `/auth/refresh` is called:
  1. The provided token's SHA-256 hash is located in `refresh_sessions`.
  2. If expired or already revoked, the request is rejected with `401 Unauthorized`.
  3. A new refresh token is generated, hashed, and replaces the old token in the database.
  4. If an old, already-rotated refresh token is ever presented again (token replay attack), all sessions for the user can be revoked.

---

## 4. REST Auth Endpoints

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/auth/register` | Create account (email, username, password, display_name) | No (Rate-limited: 10/min) |
| `POST` | `/auth/login` | Authenticate with email/username + password | No (Rate-limited: 20/min) |
| `POST` | `/auth/refresh` | Rotate refresh token and get fresh 15m access token | No |
| `POST` | `/auth/logout` | Revoke current refresh token session | No |
| `GET` | `/auth/me` | Fetch authenticated user profile & preferences | Bearer JWT |
| `GET` | `/devices` | List registered devices belonging to user | Bearer JWT |
| `POST` | `/devices/register` | Register new device identity | Optional Bearer JWT |
| `DELETE` | `/devices/:id` | Revoke device access | Bearer JWT |
