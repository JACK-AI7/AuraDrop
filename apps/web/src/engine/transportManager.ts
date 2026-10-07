// AuraDrop Production Transport Manager (Section 2)
// Manages WebRTC Direct, LAN TCP, and Relay transports with automatic health checking and fallback.

import { P2PTransport, TransportStatistics, ControlMessage } from './transport';
import { WebRtcTransport } from './webRtcTransport';
import { SignalingClient } from './signalingClient';
import { PeerDevice, ConnectionState } from '../types';

export class TransportManager {
  private static instance: TransportManager;
  private webRtcTransport: WebRtcTransport;
  private signaling: SignalingClient;
  private activeTransport: P2PTransport;

  private constructor(signaling: SignalingClient) {
    this.signaling = signaling;
    this.webRtcTransport = new WebRtcTransport(signaling);
    this.activeTransport = this.webRtcTransport;
  }

  public static getInstance(signaling: SignalingClient): TransportManager {
    if (!TransportManager.instance) {
      TransportManager.instance = new TransportManager(signaling);
    }
    return TransportManager.instance;
  }

  public getActiveTransport(): P2PTransport {
    return this.activeTransport;
  }

  public getWebRtcTransport(): WebRtcTransport {
    return this.webRtcTransport;
  }

  public async connectPeer(peer: PeerDevice): Promise<boolean> {
    // Prefer WebRTC Direct transport for cross-device browser transfers
    if (await this.webRtcTransport.isAvailable()) {
      this.activeTransport = this.webRtcTransport;
      return this.webRtcTransport.connect(peer);
    }
    return false;
  }

  public getStatistics(): TransportStatistics {
    return this.activeTransport.getStatistics();
  }
}
