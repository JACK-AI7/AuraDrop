import { z } from 'zod';

export const PlatformSchema = z.enum(['web', 'android', 'ios', 'windows', 'macos', 'linux']);

export const AuthMessageSchema = z.object({
  type: z.literal('AUTH'),
  deviceId: z.string().min(3).max(128),
  displayName: z.string().max(128).default('AuraDrop Device'),
  deviceName: z.string().max(128).default('AuraDrop Device'),
  platform: PlatformSchema.default('web'),
  appVersion: z.string().max(32).optional(),
  avatarUrl: z.string().max(512).optional(),
  visibility: z.enum(['everyone', 'contacts', 'off']).default('everyone'),
  localIp: z.string().max(64).optional(),
  localPort: z.number().int().min(1).max(65535).optional(),
  capabilities: z.array(z.string()).optional(),
  trustedPeers: z.array(z.string()).optional(),
  timestamp: z.number().optional(),
});

export const HeartbeatMessageSchema = z.object({
  type: z.literal('HEARTBEAT'),
  deviceId: z.string().min(3).max(128),
  visibility: z.enum(['everyone', 'contacts', 'off']).default('everyone'),
  localIp: z.string().max(64).optional(),
  localPort: z.number().int().min(1).max(65535).optional(),
  timestamp: z.number().optional(),
});

export const SignalPayloadSchema = z.object({
  type: z.string().optional(),
  sdp: z.string().optional(),
  candidate: z.any().optional(),
  connectionId: z.string().optional(),
  epoch: z.number().optional(),
}).passthrough();

export const SignalMessageSchema = z.object({
  type: z.literal('SIGNAL'),
  senderId: z.string().optional(),
  senderDeviceId: z.string().optional(),
  targetDeviceId: z.string().optional(),
  targetId: z.string().optional(),
  connectionId: z.string().optional(),
  epoch: z.number().optional(),
  signalType: z.string().optional(),
  signal: z.any().optional(),
  payload: z.any().optional(),
  timestamp: z.number().optional(),
}).passthrough().transform((d) => {
  const senderId = d.senderId || d.senderDeviceId || 'unknown';
  const targetDeviceId = d.targetDeviceId || d.targetId || '';
  const signal = d.signal || d.payload || (d.signalType ? { type: d.signalType } : {});
  return {
    ...d,
    senderId,
    targetDeviceId,
    signal,
  };
});

export const ChatMessageSchema = z.object({
  type: z.literal('CHAT'),
  conversationId: z.string().min(3).max(128),
  senderId: z.string().min(3).max(128),
  targetDeviceId: z.string().min(3).max(128).optional(),
  text: z.string().min(1).max(65536),
  messageType: z.enum(['text', 'system', 'media']).default('text'),
  replyToId: z.string().optional(),
  disappearingSeconds: z.number().int().min(0).optional(),
  timestamp: z.number().optional(),
});

export const TransferRequestSchema = z.object({
  type: z.literal('TRANSFER_REQUEST'),
  transferId: z.string().min(3).max(128),
  senderId: z.string().min(3).max(128),
  senderName: z.string().max(128).optional(),
  targetDeviceId: z.string().min(3).max(128),
  fileName: z.string().min(1).max(512),
  totalBytes: z.number().int().min(0),
  totalFiles: z.number().int().min(1).default(1),
  sha256: z.string().max(128).optional(),
  files: z.array(z.any()).optional(),
  timestamp: z.number().optional(),
});

export const TransferResponseSchema = z.object({
  type: z.enum(['TRANSFER_ACCEPT', 'TRANSFER_DECLINE']),
  transferId: z.string().min(3).max(128),
  senderId: z.string().min(3).max(128),
  targetDeviceId: z.string().min(3).max(128),
  reason: z.string().optional(),
  timestamp: z.number().optional(),
});

export const PairCreateRequestSchema = z.object({
  initiatorDeviceId: z.string().min(3).max(128),
  initiatorName: z.string().max(128).default('AuraDrop Client'),
  platform: PlatformSchema.optional(),
});

export const PairJoinRequestSchema = z.object({
  joinerDeviceId: z.string().min(3).max(128),
  joinerName: z.string().max(128).default('AuraDrop Peer'),
  pairingCode: z.string().min(6).max(8),
  platform: PlatformSchema.optional(),
});

export const TurnCredentialsRequestSchema = z.object({
  deviceId: z.string().min(3).max(128),
});

export type AuthMessage = z.infer<typeof AuthMessageSchema>;
export type HeartbeatMessage = z.infer<typeof HeartbeatMessageSchema>;
export type SignalMessage = z.infer<typeof SignalMessageSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type TransferRequest = z.infer<typeof TransferRequestSchema>;
export type TransferResponse = z.infer<typeof TransferResponseSchema>;
