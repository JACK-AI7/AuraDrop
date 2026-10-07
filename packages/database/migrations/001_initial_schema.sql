-- AuraDrop Production Database Schema (Neon PostgreSQL)
-- Section 9: Durable Application Data Model

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  email_normalized VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  email_verified_at TIMESTAMPTZ,
  display_name VARCHAR(100) NOT NULL,
  username VARCHAR(50) NOT NULL UNIQUE,
  avatar_url VARCHAR(512),
  bio TEXT DEFAULT '',
  country_code VARCHAR(8),
  language VARCHAR(10) DEFAULT 'en',
  timezone VARCHAR(50) DEFAULT 'UTC',
  status VARCHAR(20) DEFAULT 'active', -- active, suspended, deleted
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email_normalized ON users(email_normalized);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 2. User Preferences Table
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme VARCHAR(20) DEFAULT 'dark', -- dark, light, system
  language VARCHAR(10) DEFAULT 'en',
  auto_accept BOOLEAN DEFAULT FALSE,
  default_visibility VARCHAR(20) DEFAULT 'EVERYONE', -- EVERYONE, CONTACTS, TRUSTED, NO_ONE
  notifications_enabled BOOLEAN DEFAULT TRUE,
  sound_enabled BOOLEAN DEFAULT TRUE,
  vibration_enabled BOOLEAN DEFAULT TRUE,
  download_directory_preference VARCHAR(512),
  allow_background_transfers BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Devices Table
CREATE TABLE IF NOT EXISTS devices (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  device_public_key VARCHAR(512) NOT NULL,
  device_name VARCHAR(100) NOT NULL,
  platform VARCHAR(30) NOT NULL, -- windows, macos, linux, android, ios, web
  platform_version VARCHAR(50),
  app_version VARCHAR(30) DEFAULT '16.0.0',
  protocol_version VARCHAR(30) DEFAULT 'P2PFS/1',
  device_model VARCHAR(100),
  capabilities_json JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'active', -- active, revoked, inactive
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen_at ON devices(last_seen_at);

-- 4. Device Sessions Table
CREATE TABLE IF NOT EXISTS device_sessions (
  id VARCHAR(64) PRIMARY KEY,
  device_id VARCHAR(64) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  connection_id VARCHAR(64) NOT NULL,
  session_token_hash VARCHAR(128) NOT NULL,
  ip_hash VARCHAR(128),
  user_agent_hash VARCHAR(128),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_device_id ON device_sessions(device_id);

-- 5. Trusted Devices Table
CREATE TABLE IF NOT EXISTS trusted_devices (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id VARCHAR(64) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  trusted_device_id VARCHAR(64) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  trust_level VARCHAR(20) DEFAULT 'trusted', -- trusted, permanent, pairing
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(user_id, device_id, trusted_device_id)
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_id ON trusted_devices(user_id);

-- 6. Contacts Table
CREATE TABLE IF NOT EXISTS contacts (
  id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname VARCHAR(100),
  relationship VARCHAR(30) DEFAULT 'contact', -- contact, friend, family, blocked
  trust_level VARCHAR(20) DEFAULT 'standard',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(owner_user_id, contact_user_id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_owner_user_id ON contacts(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_contact_user_id ON contacts(contact_user_id);

-- 7. Visibility Settings Table
CREATE TABLE IF NOT EXISTS visibility_settings (
  user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode VARCHAR(20) NOT NULL DEFAULT 'EVERYONE', -- EVERYONE, CONTACTS, TRUSTED, NO_ONE
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Transfer Sessions Table
CREATE TABLE IF NOT EXISTS transfer_sessions (
  id VARCHAR(64) PRIMARY KEY,
  sender_user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  sender_device_id VARCHAR(64) NOT NULL,
  receiver_user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  receiver_device_id VARCHAR(64) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'REQUESTED', -- REQUESTED, ACCEPTED, DECLINED, TRANSFERRING, COMPLETED, FAILED, CANCELLED
  direction VARCHAR(10) NOT NULL DEFAULT 'outgoing', -- outgoing, incoming
  file_count INT NOT NULL DEFAULT 1,
  total_bytes BIGINT NOT NULL,
  transferred_bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_code VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_transfer_sessions_sender_user ON transfer_sessions(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_transfer_sessions_receiver_user ON transfer_sessions(receiver_user_id);
CREATE INDEX IF NOT EXISTS idx_transfer_sessions_created_at ON transfer_sessions(created_at);

-- 9. Transfer Files Table
CREATE TABLE IF NOT EXISTS transfer_files (
  id VARCHAR(64) PRIMARY KEY,
  transfer_session_id VARCHAR(64) NOT NULL REFERENCES transfer_sessions(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size BIGINT NOT NULL,
  sha256 VARCHAR(64) NOT NULL,
  verified_offset BIGINT NOT NULL DEFAULT 0,
  transferred_bytes BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, STREAMING, VERIFYING, COMPLETED, FAILED
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_transfer_files_session_id ON transfer_files(transfer_session_id);

-- 10. Transfer Events Table
CREATE TABLE IF NOT EXISTS transfer_events (
  id VARCHAR(64) PRIMARY KEY,
  transfer_session_id VARCHAR(64) NOT NULL REFERENCES transfer_sessions(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  metadata_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_events_session_id ON transfer_events(transfer_session_id);

-- 11. Refresh Sessions Table
CREATE TABLE IF NOT EXISTS refresh_sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id VARCHAR(64) NOT NULL,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_sessions_user_id ON refresh_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_sessions_token_hash ON refresh_sessions(token_hash);

-- 12. Verification Tokens Table
CREATE TABLE IF NOT EXISTS verification_tokens (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  token_type VARCHAR(30) NOT NULL, -- email_verification, password_reset
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_verification_tokens_user_id ON verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_verification_tokens_hash ON verification_tokens(token_hash);

-- 13. Security Events Table
CREATE TABLE IF NOT EXISTS security_events (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  device_id VARCHAR(64),
  event_type VARCHAR(50) NOT NULL, -- login_failure, password_reset, token_revocation, suspicious_rate
  severity VARCHAR(20) NOT NULL DEFAULT 'low', -- low, medium, high, critical
  metadata_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at);
