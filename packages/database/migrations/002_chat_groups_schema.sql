-- AuraDrop Production Database Schema (Neon PostgreSQL)
-- Migration 002: Real-time Chat, Group Conversations, Disappearing Messages, and Media Attachments

-- 1. Conversations Table
CREATE TABLE IF NOT EXISTS conversations (
  id VARCHAR(64) PRIMARY KEY,
  type VARCHAR(20) NOT NULL DEFAULT 'DIRECT', -- 'DIRECT', 'GROUP'
  title VARCHAR(150),
  avatar_url VARCHAR(512),
  created_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  disappearing_seconds INT NOT NULL DEFAULT 0, -- 0 = Off, 30, 60, 120 (2m), 300, 600, 3600, 86400, 604800
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_last_msg ON conversations(last_message_at DESC);

-- 2. Conversation Members Table
CREATE TABLE IF NOT EXISTS conversation_members (
  id VARCHAR(64) PRIMARY KEY,
  conversation_id VARCHAR(64) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'MEMBER', -- 'OWNER', 'ADMIN', 'MEMBER'
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleared_at TIMESTAMPTZ, -- for "Clear Chat for me"
  is_muted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_members_user ON conversation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_conv_members_conv ON conversation_members(conversation_id);

-- 3. Messages Table
CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(64) PRIMARY KEY,
  conversation_id VARCHAR(64) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_msg_id VARCHAR(64),
  text TEXT DEFAULT '',
  type VARCHAR(20) NOT NULL DEFAULT 'TEXT', -- 'TEXT', 'FILE', 'IMAGE', 'SYSTEM'
  reply_to_id VARCHAR(64) REFERENCES messages(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ, -- for disappearing messages
  is_deleted_everyone BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_client_id ON messages(client_msg_id);

-- 4. Message Attachments Table
CREATE TABLE IF NOT EXISTS message_attachments (
  id VARCHAR(64) PRIMARY KEY,
  message_id VARCHAR(64) NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  mime_type VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
  file_hash VARCHAR(128),
  file_url VARCHAR(512),
  transfer_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_msg ON message_attachments(message_id);

-- 5. Message Receipts Table (Delivered / Read per recipient)
CREATE TABLE IF NOT EXISTS message_receipts (
  id VARCHAR(64) PRIMARY KEY,
  message_id VARCHAR(64) NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'DELIVERED', -- 'DELIVERED', 'READ'
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_receipts_msg ON message_receipts(message_id);

-- 6. User Media & Avatar Storage Table (Metadata for real avatars & uploads)
CREATE TABLE IF NOT EXISTS user_media (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_type VARCHAR(30) NOT NULL DEFAULT 'AVATAR', -- 'AVATAR', 'CHAT_MEDIA', 'GROUP_AVATAR'
  file_name VARCHAR(255) NOT NULL,
  file_size INT NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  storage_path VARCHAR(512) NOT NULL,
  public_url VARCHAR(512) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_media_user ON user_media(user_id);
