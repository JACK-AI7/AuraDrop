// AuraDrop Production Transport Abstraction (Section 2 & P2PFS/1 Specification)

import { PeerDevice, ConnectionState } from '../types';

export interface ControlMessage {
  type:
    | 'TRANSFER_REQUEST'
    | 'TRANSFER_RESPONSE'
    | 'HEALTH_CHECK_PING'
    | 'HEALTH_CHECK_PONG'
    | 'ACK_COMPLETE'
    | 'PAUSE'
    | 'RESUME'
    | 'CANCEL';
  transferId?: string;
  senderId?: string;
  targetId?: string;
  payload?: any;
  timestamp?: number;
}

export interface TransportStatistics {
  transportName: string;
  iceState: string;
  connectionState: string;
  dataChannelState: string;
  rttMs: number;
  bytesSent: number;
  bytesReceived: number;
  bufferedAmount: number;
  localCandidateType?: string;
  remoteCandidateType?: string;
  packetLossPercent?: number;
}

export interface P2PTransport {
  name: string;
  isAvailable(): Promise<boolean>;
  connect(peer: PeerDevice): Promise<boolean>;
  sendControl(message: ControlMessage): Promise<void>;
  sendFrame(frame: Uint8Array): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  close(): Promise<void>;
  getStatistics(): TransportStatistics;
  onFrameReceived(cb: (frame: Uint8Array) => void): void;
  onControlReceived(cb: (message: ControlMessage) => void): void;
  onStateChanged(cb: (state: ConnectionState) => void): void;
}
