export interface PeerDevice {
  id: string;
  name: string;
  deviceName: string;
  platform: 'android' | 'ios' | 'macos' | 'windows' | 'linux' | 'web';
  ip: string;
  port: number;
  lastSeen: Date;
  isTrusted?: boolean;
}

export interface PickedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  file?: File;
}

export interface TransferProgress {
  transferId: string;
  fileName: string;
  fileSize: number;
  transferredBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  state: 'idle' | 'waiting' | 'transferring' | 'completed' | 'failed';
  sha256?: string;
  isIncoming: boolean;
  peerName: string;
}

export type VisibilityMode = 'everyone' | 'contacts' | 'off';
