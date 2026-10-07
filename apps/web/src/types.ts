// AuraDrop Desktop — Production P2P Types (P2PFS/1 Engine)

export type ConnectionState =
  | 'DISCOVERING'
  | 'PEER_FOUND'
  | 'PEER_SELECTED'
  | 'SIGNALING'
  | 'CONNECTING'
  | 'DATA_CHANNEL_CONNECTING'
  | 'DATA_CHANNEL_HEALTH_CHECK'
  | 'SECURE'
  | 'WAITING_FOR_ACCEPTANCE'
  | 'READY_TO_TRANSFER'
  | 'TRANSFERRING'
  | 'FLUSHING'
  | 'VERIFYING'
  | 'DATABASE_COMMIT'
  | 'COMPLETED'
  | 'FAILED_CONNECTION'
  | 'FAILED_TRANSFER'
  | 'FAILED_INTEGRITY'
  | 'CANCELLED'
  | 'INTERRUPTED'
  | 'PAUSED';

export interface PeerDevice {
  id: string;
  deviceId: string;
  name: string;
  deviceName: string;
  platform: 'android' | 'ios' | 'macos' | 'windows' | 'linux' | 'web';
  ip: string;
  port: number;
  lastSeen: Date;
  isTrusted?: boolean;
  connectionState?: ConnectionState;
  transport?: 'BroadcastChannel' | 'WebRTC Direct' | 'LAN TCP' | 'Relay';
}

export interface PickedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  file?: File;
  sha256?: string;
}

export interface TransferFileManifest {
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
  sha256?: string;
  verifiedOffset?: number;
}

export interface TransferProgress {
  transferId: string;
  fileName: string;
  fileSize: number;
  transferredBytes: number;
  verifiedBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  state: ConnectionState;
  sha256?: string;
  isIncoming: boolean;
  peerName: string;
  currentFileIndex?: number;
  totalFilesCount?: number;
  transport?: string;
}

export interface TransferRecord {
  id: string;
  fileName: string;
  fileSize: number;
  senderName: string;
  receiverName: string;
  status: 'COMPLETED' | 'FAILED' | 'INTERRUPTED' | 'CANCELLED';
  sha256?: string;
  timestamp: string;
  speedBytesPerSec: number;
  transport: string;
  verifiedOffset?: number;
  blobUrl?: string;
}

export type VisibilityMode = 'everyone' | 'contacts' | 'off';
