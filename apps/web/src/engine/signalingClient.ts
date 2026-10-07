// AuraDrop Production WebRTC Signaling Client (V13 Forensic Hardening)
// Manages real-time WebSocket connection to signaling server with deep diagnostics,
// configurable URL override, mobile lifecycle resumption, and detailed network telemetry.

import { DeviceIdentity } from './identity';
import { PeerDevice } from '../types';

export interface SignalingEventCallbacks {
  onPeerList?: (peers: PeerDevice[]) => void;
  onPeerOnline?: (peer: PeerDevice) => void;
  onPeerOffline?: (deviceId: string) => void;
  onSignal?: (senderId: string, signal: any) => void;
  onSignalTargetOffline?: (targetDeviceId: string) => void;
  onTransferRequest?: (payload: any) => void;
  onTransferResponse?: (payload: any) => void;
  onTransferAck?: (payload: any) => void;
  onConnectionStatus?: (isConnected: boolean) => void;
  onDiagnosticsUpdate?: () => void;
}

export interface SignalingDiagnostics {
  webAppUrl: string;
  signalingUrl: string;
  customConfiguredUrl: string | null;
  wsState: 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED';
  lastWsError: string | null;
  lastWsCloseCode: number | null;
  registrationStatus: 'UNREGISTERED' | 'SENT' | 'CONFIRMED';
  connectedPeersCount: number;
  lastHeartbeat: number | null;
  reconnectAttempts: number;
  isSecureContext: boolean;
}

const STORAGE_CUSTOM_SIGNALING_KEY = 'auradrop_custom_signaling_url';

export class SignalingClient {
  private static instance: SignalingClient;
  private socket: WebSocket | null = null;
  private identity: DeviceIdentity;
  private callbacks: SignalingEventCallbacks = {};
  private heartbeatTimer: any = null;
  private reconnectTimer: any = null;
  private isConnecting = false;
  private shouldReconnect = true;

  // Diagnostics & Telemetry (Section 2 & 30)
  private activeSignalingUrl = '';
  private lastWsError: string | null = null;
  private lastWsCloseCode: number | null = null;
  private registrationStatus: 'UNREGISTERED' | 'SENT' | 'CONFIRMED' = 'UNREGISTERED';
  private connectedPeersCount = 0;
  private lastHeartbeat: number | null = null;
  private reconnectAttempts = 0;

  private constructor(identity: DeviceIdentity) {
    this.identity = identity;
    this.setupNetworkLifecycleListeners();
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

  private setupNetworkLifecycleListeners(): void {
    if (typeof window !== 'undefined') {
      // Re-trigger connection when mobile device reconnects to Wi-Fi (Section 33)
      window.addEventListener('online', () => {
        console.log('[AuraDrop Net] Device returned online, reconnecting signaling...');
        this.reconnectAttempts = 0;
        this.connect();
      });

      // Handle visibility changes (e.g. mobile browser tab reopened after sleep)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.log('[AuraDrop Net] Tab became visible, refreshing signaling socket...');
            this.connect();
          }
        }
      });
    }
  }

  public getDiagnostics(): SignalingDiagnostics {
    let wsState: 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED' = 'CLOSED';
    if (this.socket) {
      switch (this.socket.readyState) {
        case WebSocket.CONNECTING:
          wsState = 'CONNECTING';
          break;
        case WebSocket.OPEN:
          wsState = 'OPEN';
          break;
        case WebSocket.CLOSING:
          wsState = 'CLOSING';
          break;
        case WebSocket.CLOSED:
        default:
          wsState = 'CLOSED';
          break;
      }
    }

    return {
      webAppUrl: typeof window !== 'undefined' ? window.location.href : 'unknown',
      signalingUrl: this.activeSignalingUrl,
      customConfiguredUrl: this.getCustomSignalingUrl(),
      wsState,
      lastWsError: this.lastWsError,
      lastWsCloseCode: this.lastWsCloseCode,
      registrationStatus: this.registrationStatus,
      connectedPeersCount: this.connectedPeersCount,
      lastHeartbeat: this.lastHeartbeat,
      reconnectAttempts: this.reconnectAttempts,
      isSecureContext: typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false,
    };
  }

  public getCustomSignalingUrl(): string | null {
    try {
      return localStorage.getItem(STORAGE_CUSTOM_SIGNALING_KEY);
    } catch {
      return null;
    }
  }

  public setCustomSignalingUrl(url: string | null): void {
    try {
      if (url && url.trim()) {
        localStorage.setItem(STORAGE_CUSTOM_SIGNALING_KEY, url.trim());
      } else {
        localStorage.removeItem(STORAGE_CUSTOM_SIGNALING_KEY);
      }
    } catch (e) {
      console.warn('Failed to save custom signaling URL to storage', e);
    }

    this.disconnect();
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    this.connect();
  }

  public connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isConnecting = true;
    this.activeSignalingUrl = this.resolveSignalingUrl();
    this.lastWsError = null;
    this.registrationStatus = 'UNREGISTERED';

    console.log(`[AuraDrop Signaling] Connecting to ${this.activeSignalingUrl}`);

    try {
      this.socket = new WebSocket(this.activeSignalingUrl);

      this.socket.onopen = () => {
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.lastWsError = null;
        this.registrationStatus = 'SENT';
        this.callbacks.onConnectionStatus?.(true);
        this.callbacks.onDiagnosticsUpdate?.();

        console.log(`[AuraDrop Signaling] WebSocket OPEN to ${this.activeSignalingUrl}, sending REGISTER...`);

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

      this.socket.onclose = (e) => {
        this.isConnecting = false;
        this.lastWsCloseCode = e.code;
        this.registrationStatus = 'UNREGISTERED';
        this.stopHeartbeat();
        this.callbacks.onConnectionStatus?.(false);
        this.callbacks.onDiagnosticsUpdate?.();

        console.warn(`[AuraDrop Signaling] Socket closed (code: ${e.code}, reason: "${e.reason || 'None'}")`);

        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };

      this.socket.onerror = (e: any) => {
        this.lastWsError = 'Connection refused or unreachable';
        this.callbacks.onDiagnosticsUpdate?.();
        console.error(`[AuraDrop Signaling] Socket error on ${this.activeSignalingUrl}`, e);
      };
    } catch (err: any) {
      this.isConnecting = false;
      this.lastWsError = err?.message || 'WebSocket initialization failed';
      this.callbacks.onDiagnosticsUpdate?.();
      this.scheduleReconnect();
    }
  }

  private resolveSignalingUrl(): string {
    // 1. User manual override in UI Settings/Diagnostics (Section 3)
    const custom = this.getCustomSignalingUrl();
    if (custom) return custom;

    // 2. Vite environment variable
    const envUrl = (import.meta as any).env?.VITE_SIGNALING_URL;
    if (envUrl) return envUrl;

    if (typeof window !== 'undefined' && window.location) {
      const isHttps = window.location.protocol === 'https:';
      const wsProto = isHttps ? 'wss:' : 'ws:';
      const host = window.location.hostname || 'localhost';
      const port = window.location.port;

      // 3. If on Vercel without custom env, point to AuraDrop production signaling
      if (host.includes('vercel.app')) {
        return 'wss://api.auradrop.network/ws';
      }

      // 4. If loaded via Vite dev server proxy (port 5173/5174)
      if (port === '5173' || port === '5174') {
        return `${wsProto}//${window.location.host}/ws`;
      }

      // 5. If loaded on a direct LAN IP
      if (host !== 'localhost' && host !== '127.0.0.1') {
        return `${wsProto}//${host}:48280`;
      }

      // 6. Default backend port 48280 on local machine
      return `${wsProto}//${host}:48280`;
    }

    return 'ws://localhost:48280';
  }

  private handleIncomingMessage(msg: any): void {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'REGISTERED': {
        this.registrationStatus = 'CONFIRMED';
        if (Array.isArray(msg.peers)) {
          this.connectedPeersCount = msg.peers.length;
          const peerDevices: PeerDevice[] = msg.peers.map((p: any) => this.mapToPeerDevice(p));
          this.callbacks.onPeerList?.(peerDevices);
        }
        this.callbacks.onDiagnosticsUpdate?.();
        console.log(`[AuraDrop Signaling] Registration confirmed. Discovered ${this.connectedPeersCount} peers.`);
        break;
      }

      case 'PEER_ONLINE': {
        if (msg.peer && msg.peer.deviceId !== this.identity.deviceId) {
          this.connectedPeersCount++;
          const peerDevice = this.mapToPeerDevice(msg.peer);
          this.callbacks.onPeerOnline?.(peerDevice);
          this.callbacks.onDiagnosticsUpdate?.();
          console.log(`[AuraDrop Signaling] Remote peer joined: ${peerDevice.name} (${peerDevice.id})`);
        }
        break;
      }

      case 'PEER_OFFLINE': {
        if (msg.deviceId) {
          this.connectedPeersCount = Math.max(0, this.connectedPeersCount - 1);
          this.callbacks.onPeerOffline?.(msg.deviceId);
          this.callbacks.onDiagnosticsUpdate?.();
          console.log(`[AuraDrop Signaling] Remote peer offline: ${msg.deviceId}`);
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

      case 'SIGNAL_TARGET_OFFLINE': {
        console.warn(`[AuraDrop Signaling] Target device ${msg.targetDeviceId} is offline`);
        this.callbacks.onSignalTargetOffline?.(msg.targetDeviceId);
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

      case 'PONG': {
        this.lastHeartbeat = Date.now();
        this.callbacks.onDiagnosticsUpdate?.();
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
      ip: p.remoteIp || 'WebRTC P2P',
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
    }, 7500); // 7.5s interval (Section 14)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(10000, 1500 * Math.pow(1.4, this.reconnectAttempts));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
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
