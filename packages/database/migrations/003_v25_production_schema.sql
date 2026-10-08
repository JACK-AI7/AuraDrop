-- ============================================================================
-- AURADROP V25 PRODUCTION SCHEMA MIGRATION
-- Durable Neon PostgreSQL Schema for Trusted Device Ecosystem & Real P2P
-- ============================================================================

-- 1. Ensure 'devices' supports anonymous/unauthenticated devices with display_name & avatar
ALTER TABLE devices ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE devices ALTER COLUMN device_public_key DROP NOT NULL;
ALTER TABLE devices ALTER COLUMN device_public_key SET DEFAULT '';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS display_name VARCHAR(128);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_type VARCHAR(64) DEFAULT 'desktop';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 2. Create 'trusted_device_pairs' table (Durable bilateral device pairing)
CREATE TABLE IF NOT EXISTS trusted_device_pairs (
  pair_id VARCHAR(128) PRIMARY KEY,
  device_a_id VARCHAR(128) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  device_b_id VARCHAR(128) NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT unique_device_pair UNIQUE (device_a_id, device_b_id)
);

CREATE INDEX IF NOT EXISTS idx_trusted_pair_a ON trusted_device_pairs(device_a_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_trusted_pair_b ON trusted_device_pairs(device_b_id) WHERE revoked_at IS NULL;

-- 3. Also allow 'trusted_devices' to have nullable user_id for legacy compatibility
ALTER TABLE trusted_devices ALTER COLUMN user_id DROP NOT NULL;

-- 4. Create 'disappearing_message_settings' table
CREATE TABLE IF NOT EXISTS disappearing_message_settings (
  conversation_id VARCHAR(128) PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  ttl_seconds INTEGER NOT NULL DEFAULT 86400,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  set_by VARCHAR(128) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 5. Create 'audit_events' table (or alias from security_events)
CREATE TABLE IF NOT EXISTS audit_events (
  id VARCHAR(128) PRIMARY KEY,
  device_id VARCHAR(128) REFERENCES devices(id) ON DELETE SET NULL,
  user_id VARCHAR(128) REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(64) NOT NULL,
  severity VARCHAR(32) NOT NULL DEFAULT 'INFO',
  ip_address VARCHAR(64),
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_device ON audit_events(device_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);

-- 6. Ensure transfers table or view
CREATE OR REPLACE VIEW transfers AS
SELECT 
  id AS transfer_id,
  sender_device_id,
  receiver_device_id,
  status,
  total_bytes,
  transferred_bytes AS completed_bytes,
  NULL::VARCHAR AS sha256,
  created_at,
  started_at AS updated_at,
  completed_at
FROM transfer_sessions;
