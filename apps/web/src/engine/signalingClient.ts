// AuraDrop Production WebRTC Signaling Client (Section 3 & 4)
// Connects to AuraDrop Backend WebSocket Gateway for cross-device peer discovery and SDP negotiation.

import { DeviceIdentity } from './identity';
import { PeerDevice } from '../types';

export interface SignalingEventCallbacks {
  onPeerList?: (peers: PeerDevice[]) => void;
  onPeerOnline?: (peer: PeerDevice) => void;
  onPeerOffline?: (deviceId: string) => void;
  onSignal?: (senderId: string, signal: any) => void;
  onTransferRequest?: (payload: any) => void;
  onTransferResponse?: (payload: any) => void;
  onTransferAck?: (payload: any) => void;
  onConnectionStatus?: (isConnected: boolean) => void;
}

export class SignalingClient {
  private static instance: SignalingClient;
  private socket: WebSocket | null = null;
  private identity: DeviceIdentity;
  private callbacks: SignalingEventCallbacks = {};
  private heartbeatTimer: any = null;
  private reconnectTimer: any = null;
  private isConnecting = false;
  private shouldReconnect = true;

  private constructor(identity: DeviceIdentity) {
    this.identity = identity;
  }

  public static getInstance(identity: DeviceIdentity): SignalingClient {
    if (!SignalingClient.instance) {
      SignalingClient.instance = new SignalingClient(identity);
    }
    return SignalingClient.instance;
  }

  public setCallbacks(callbacks: SignalingEventCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  public connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isConnecting = true;
    const url = this.resolveSignalingUrl();

    try {
      this.socket = new WebSocket(url);

      this.socket.onopen = () => {
        this.isConnecting = false;
        this.callbacks.onConnectionStatus?.(true);

        // Register device identity immediately upon socket open
        this.send({
          type: 'REGISTER',
          deviceId: this.identity.deviceId,
          payload: {
            displayName: this.identity.displayName,
            deviceName: this.identity.deviceName,
            platform: this.identity.platform,
            visibility: this.identity.visibility,
            capabilities: { webrtc: true, directLan: true },
          },
        });

        this.startHeartbeat();
      };

      this.socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleIncomingMessage(msg);
        } catch {
          // Ignore malformed payloads
        }
      };

      this.socket.onclose = () => {
        this.isConnecting = false;
        this.stopHeartbeat();
        this.callbacks.onConnectionStatus?.(false);
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };

      this.socket.onerror = () => {
        // Handled via onclose
      };
    } catch {
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private resolveSignalingUrl(): string {
    const envUrl = (import.meta as any).env?.VITE_SIGNALING_URL;
    if (envUrl) return envUrl;

    if (typeof window !== 'undefined' && window.location) {
      const isHttps = window.location.protocol === 'https:';
      const wsProto = isHttps ? 'wss:' : 'ws:';
      const host = window.location.hostname || 'localhost';

      // If loaded through Vite dev server with proxy support
      if (window.location.port === '5173' || window.location.port === '5174') {
        return `${wsProto}//${window.location.host}/ws`;
      }

      // Standard AuraDrop backend port
      return `${wsProto}//${host}:48280`;
    }

    return 'ws://localhost:48280';
  }

  private handleIncomingMessage(msg: any): void {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'REGISTERED': {
        if (Array.isArray(msg.peers)) {
          const peerDevices: PeerDevice[] = msg.peers.map((p: any) => this.mapToPeerDevice(p));
          this.callbacks.onPeerList?.(peerDevices);
        }
        break;
      }

      case 'PEER_ONLINE': {
        if (msg.peer && msg.peer.deviceId !== this.identity.deviceId) {
          const peerDevice = this.mapToPeerDevice(msg.peer);
          this.callbacks.onPeerOnline?.(peerDevice);
        }
        break;
      }

      case 'PEER_OFFLINE': {
        if (msg.deviceId) {
          this.callbacks.onPeerOffline?.(msg.deviceId);
        }
        break;
      }

      case 'SIGNAL': {
        const sender = msg.senderId || msg.deviceId;
        if (sender && msg.signal) {
          this.callbacks.onSignal?.(sender, msg.signal);
        }
        break;
      }

      case 'TRANSFER_REQUEST': {
        this.callbacks.onTransferRequest?.(msg);
        break;
      }

      case 'TRANSFER_RESPONSE': {
        this.callbacks.onTransferResponse?.(msg);
        break;
      }

      case 'TRANSFER_ACK_COMPLETE': {
        this.callbacks.onTransferAck?.(msg);
        break;
      }
    }
  }

  private mapToPeerDevice(p: any): PeerDevice {
    return {
      id: p.deviceId,
      deviceId: p.deviceId,
      name: p.displayName || p.deviceId.substring(0, 8),
      deviceName: p.deviceName || `${p.platform?.toUpperCase() || 'DEVICE'} • WebRTC Direct`,
      platform: p.platform || 'web',
      ip: 'WebRTC P2P',
      port: 0,
      lastSeen: new Date(p.lastSeen || Date.now()),
      isTrusted: p.visibility === 'trusted',
      connectionState: 'DISCOVERED' as any,
      transport: 'WebRTC Direct',
    };
  }

  public sendSignal(targetDeviceId: string, signal: any): void {
    this.send({
      type: 'SIGNAL',
      deviceId: this.identity.deviceId,
      senderId: this.identity.deviceId,
      targetDeviceId,
      signal,
    });
  }

  public sendTransferRequest(targetDeviceId: string, payload: any): void {
    this.send({
      type: 'TRANSFER_REQUEST',
      deviceId: this.identity.deviceId,
      senderId: this.identity.deviceId,
      targetDeviceId,
      payload,
    });
  }

  public sendTransferResponse(targetDeviceId: string, payload: any): void {
    this.send({
      type: 'TRANSFER_RESPONSE',
      deviceId: this.identity.deviceId,
      senderId: this.identity.deviceId,
      targetDeviceId,
      payload,
    });
  }

  public sendTransferAck(targetDeviceId: string, payload: any): void {
    this.send({
      type: 'TRANSFER_ACK_COMPLETE',
      deviceId: this.identity.deviceId,
      senderId: this.identity.deviceId,
      targetDeviceId,
      payload,
    });
  }

  private send(data: any): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'PING', deviceId: this.identity.deviceId });
    }, 5000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2500);
  }

  public disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
