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
  onChatMessage?: (payload: any) => void;
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

  // Inter-tab Broadcast Mesh
  private broadcastChannel: BroadcastChannel | null = null;
  private localMeshPeers = new Map<string, PeerDevice>();
  private networkDiscoveredPeers: any[] = [];

  // Serverless HTTP Signaling Polling
  private httpPollTimer: any = null;
  private isHttpPolling = false;
  private lastHttpPollTime: number | null = null;
  private serverlessApiUrl = '';

  private constructor(identity: DeviceIdentity) {
    this.identity = identity;
    this.serverlessApiUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/signaling` : '';
    this.setupNetworkLifecycleListeners();
    this.setupBroadcastMesh();
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
    } else if (this.lastHttpPollTime && Date.now() - this.lastHttpPollTime < 8000) {
      wsState = 'OPEN';
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
      lastHeartbeat: this.lastHeartbeat || this.lastHttpPollTime,
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
    this.shouldReconnect = true;
    this.startHttpPolling();

    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.activeSignalingUrl = this.resolveSignalingUrl();
    this.lastWsError = null;

    // If activeSignalingUrl is HTTP / Serverless (e.g. Vercel deployment), rely on HTTP polling
    if (!this.activeSignalingUrl.startsWith('ws://') && !this.activeSignalingUrl.startsWith('wss://')) {
      console.log(`[AuraDrop Signaling] Using Serverless Wi-Fi Signaling: ${this.activeSignalingUrl}`);
      this.isConnecting = false;
      this.registrationStatus = 'CONFIRMED';
      this.callbacks.onConnectionStatus?.(true);
      this.callbacks.onDiagnosticsUpdate?.();
      return;
    }

    this.isConnecting = true;
    console.log(`[AuraDrop Signaling] Connecting WebSocket to ${this.activeSignalingUrl}`);

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
        this.stopHeartbeat();

        if (!this.lastHttpPollTime || Date.now() - this.lastHttpPollTime > 8000) {
          this.registrationStatus = 'UNREGISTERED';
          this.callbacks.onConnectionStatus?.(false);
        }
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

  private startHttpPolling(): void {
    if (this.isHttpPolling || !this.serverlessApiUrl) return;
    this.isHttpPolling = true;

    // 1. Initial Device Registration via Serverless API
    const regPayload = {
      action: 'register',
      deviceId: this.identity.deviceId,
      displayName: this.identity.displayName,
      deviceName: this.identity.deviceName,
      platform: this.identity.platform,
      visibility: this.identity.visibility,
    };

    fetch(`${this.serverlessApiUrl}?action=register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regPayload),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.peers)) {
          this.lastHttpPollTime = Date.now();
          this.registrationStatus = 'CONFIRMED';
          this.callbacks.onConnectionStatus?.(true);
          this.handleDiscoveredPeers(data.peers);
        }
      })
      .catch(() => {});

    // 2. Periodic Long/Fast-Poll Loop
    const pollLoop = async () => {
      if (!this.shouldReconnect) {
        this.isHttpPolling = false;
        return;
      }

      try {
        const pollUrl = `${this.serverlessApiUrl}?action=poll&deviceId=${encodeURIComponent(this.identity.deviceId)}&name=${encodeURIComponent(this.identity.displayName)}`;
        const res = await fetch(pollUrl);
        if (res.ok) {
          const data = await res.json();
          this.lastHttpPollTime = Date.now();
          this.registrationStatus = 'CONFIRMED';
          this.callbacks.onConnectionStatus?.(true);

          if (Array.isArray(data.peers)) {
            this.handleDiscoveredPeers(data.peers);
          }

          if (Array.isArray(data.messages) && data.messages.length > 0) {
            for (const msg of data.messages) {
              this.handleIncomingMessage(msg);
            }
          }
        }
      } catch {
        // Transient network switch
      } finally {
        if (this.shouldReconnect) {
          this.httpPollTimer = setTimeout(pollLoop, 1200);
        } else {
          this.isHttpPolling = false;
        }
      }
    };

    this.httpPollTimer = setTimeout(pollLoop, 600);
  }

  private stopHttpPolling(): void {
    if (this.httpPollTimer) {
      clearTimeout(this.httpPollTimer);
      this.httpPollTimer = null;
    }
    this.isHttpPolling = false;
  }

  private setupBroadcastMesh(): void {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;

    try {
      this.broadcastChannel = new BroadcastChannel('auradrop_tab_mesh_v1');
      this.broadcastChannel.onmessage = (event) => {
        const msg = event.data;
        if (!msg || typeof msg !== 'object') return;

        if (msg.senderDeviceId && msg.senderDeviceId !== this.identity.deviceId) {
          if (msg.type === 'TAB_PRESENCE') {
            const peer = this.mapToPeerDevice(msg.peer);
            this.localMeshPeers.set(peer.id, peer);
            this.emitCombinedPeers();
          } else if (msg.type === 'TAB_LEAVE') {
            this.localMeshPeers.delete(msg.senderDeviceId);
            this.emitCombinedPeers();
          } else if (msg.targetDeviceId === this.identity.deviceId) {
            this.handleIncomingMessage(msg.payload || msg);
          }
        }
      };

      const broadcastPresence = () => {
        if (!this.broadcastChannel) return;
        this.broadcastChannel.postMessage({
          type: 'TAB_PRESENCE',
          senderDeviceId: this.identity.deviceId,
          peer: {
            deviceId: this.identity.deviceId,
            displayName: this.identity.displayName,
            deviceName: `${this.identity.deviceName} (Local Tab)`,
            platform: this.identity.platform,
            clientIp: '127.0.0.1',
            lastSeen: Date.now(),
            visibility: this.identity.visibility,
          },
        });
      };

      broadcastPresence();
      setInterval(broadcastPresence, 1200);

      window.addEventListener('beforeunload', () => {
        try {
          this.broadcastChannel?.postMessage({
            type: 'TAB_LEAVE',
            senderDeviceId: this.identity.deviceId,
          });
        } catch {}
      });
    } catch (e) {
      console.warn('[AuraDrop] BroadcastChannel notice:', e);
    }
  }

  private handleDiscoveredPeers(peers: any[]): void {
    this.networkDiscoveredPeers = Array.isArray(peers) ? peers : [];
    this.emitCombinedPeers();
  }

  private emitCombinedPeers(): void {
    const combined = new Map<string, PeerDevice>();

    // 1. Add local mesh peers from BroadcastChannel (same machine tabs/windows)
    for (const [id, peer] of this.localMeshPeers) {
      if (id !== this.identity.deviceId) {
        combined.set(id, peer);
      }
    }

    // 2. Add network peers from Serverless API / Neon DB / WebSocket
    for (const p of this.networkDiscoveredPeers) {
      const id = p.deviceId || p.id;
      if (id && id !== this.identity.deviceId && !combined.has(id)) {
        combined.set(id, this.mapToPeerDevice(p));
      }
    }

    const peerDevices = Array.from(combined.values());
    this.connectedPeersCount = peerDevices.length;
    this.callbacks.onPeerList?.(peerDevices);
    this.callbacks.onDiagnosticsUpdate?.();
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

      // 3. In web browser on Vercel or cloud web host, use the serverless API on current origin
      if (host.includes('vercel.app') || !port || port === '80' || port === '443') {
        return `${window.location.origin}/api/signaling`;
      }

      // 4. If loaded via Vite dev server proxy (port 5173/5174)
      if (port === '5173' || port === '5174') {
        return `${wsProto}//${window.location.host}/ws`;
      }

      // 5. If loaded on a direct LAN IP
      if (host !== 'localhost' && host !== '127.0.0.1') {
        return `${wsProto}//${host}:48280`;
      }

      // 6. Default to serverless signaling API on current origin
      return `${window.location.origin}/api/signaling`;
    }

    return 'ws://localhost:48280';
  }

  private handleIncomingMessage(msg: any): void {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'REGISTERED': {
        this.registrationStatus = 'CONFIRMED';
        if (Array.isArray(msg.peers)) {
          this.handleDiscoveredPeers(msg.peers);
        }
        this.callbacks.onDiagnosticsUpdate?.();
        console.log(`[AuraDrop Signaling] Registration confirmed. Discovered ${this.connectedPeersCount} peers.`);
        break;
      }

      case 'PEER_ONLINE': {
        const peer = msg.peer || msg;
        if (peer && (peer.deviceId || peer.id) !== this.identity.deviceId) {
          this.connectedPeersCount++;
          const peerDevice = this.mapToPeerDevice(peer);
          this.callbacks.onPeerOnline?.(peerDevice);
          this.callbacks.onDiagnosticsUpdate?.();
          console.log(`[AuraDrop Signaling] Remote peer joined: ${peerDevice.name} (${peerDevice.id})`);
        }
        break;
      }

      case 'PEER_OFFLINE': {
        const devId = msg.deviceId || msg.id;
        if (devId) {
          this.connectedPeersCount = Math.max(0, this.connectedPeersCount - 1);
          this.callbacks.onPeerOffline?.(devId);
          this.callbacks.onDiagnosticsUpdate?.();
          console.log(`[AuraDrop Signaling] Remote peer offline: ${devId}`);
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

      case 'TRANSFER_ACCEPT':
      case 'TRANSFER_DECLINE':
      case 'TRANSFER_RESPONSE': {
        const isAccept = msg.type === 'TRANSFER_ACCEPT' || msg.payload?.accepted === true || msg.accepted === true;
        const normalized = {
          ...msg,
          type: 'TRANSFER_RESPONSE',
          payload: {
            ...(msg.payload || {}),
            transferId: msg.transferId || msg.payload?.transferId,
            accepted: isAccept,
            verifiedOffset: msg.verifiedOffset || msg.payload?.verifiedOffset || 0,
          },
        };
        this.callbacks.onTransferResponse?.(normalized);
        break;
      }

      case 'TRANSFER_ACK_COMPLETE':
      case 'TRANSFER_COMPLETE': {
        this.callbacks.onTransferAck?.(msg);
        break;
      }

      case 'PONG': {
        this.lastHeartbeat = Date.now();
        this.callbacks.onDiagnosticsUpdate?.();
        break;
      }

      case 'CHAT_MESSAGE': {
        const payload = msg.payload || msg;
        this.callbacks.onChatMessage?.(payload);
        break;
      }
    }
  }

  private mapToPeerDevice(p: any): PeerDevice {
    const id = p.deviceId || p.id || '';
    return {
      id,
      deviceId: id,
      name: p.displayName || p.name || id.substring(0, 8),
      deviceName: p.deviceName || `${p.platform?.toUpperCase() || 'DEVICE'} • WebRTC Direct`,
      platform: p.platform || 'web',
      ip: p.clientIp || p.remoteIp || p.ip || 'WebRTC P2P',
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
      transferId: payload.transferId,
      payload,
    });
  }

  public sendTransferResponse(targetDeviceId: string, payload: any): void {
    const isAccepted = payload.accepted === true;
    this.send({
      type: isAccepted ? 'TRANSFER_ACCEPT' : 'TRANSFER_DECLINE',
      deviceId: this.identity.deviceId,
      senderId: this.identity.deviceId,
      targetDeviceId,
      transferId: payload.transferId,
      accepted: isAccepted,
      payload,
    });
    this.send({
      type: 'TRANSFER_RESPONSE',
      deviceId: this.identity.deviceId,
      senderId: this.identity.deviceId,
      targetDeviceId,
      transferId: payload.transferId,
      payload,
    });
  }

  public sendTransferAck(targetDeviceId: string, payload: any): void {
    this.send({
      type: 'TRANSFER_ACK_COMPLETE',
      deviceId: this.identity.deviceId,
      senderId: this.identity.deviceId,
      targetDeviceId,
      transferId: payload.transferId,
      payload,
    });
  }

  public sendChatMessage(targetDeviceId: string, payload: any): void {
    this.send({
      type: 'CHAT_MESSAGE',
      deviceId: this.identity.deviceId,
      senderId: this.identity.deviceId,
      targetDeviceId,
      payload,
    });
  }

  private send(data: any): void {
    const outgoing = {
      ...data,
      senderId: data.senderId || this.identity.deviceId,
      deviceId: data.deviceId || this.identity.deviceId,
    };

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(outgoing));
    }

    // Forward to local mesh tabs if broadcast channel is active
    if (this.broadcastChannel && data.targetDeviceId) {
      try {
        this.broadcastChannel.postMessage({
          senderDeviceId: this.identity.deviceId,
          targetDeviceId: data.targetDeviceId,
          payload: outgoing,
        });
      } catch {}
    }

    // Mirror to Serverless Signaling if targetDeviceId is present
    if (typeof window !== 'undefined' && this.serverlessApiUrl && data.targetDeviceId) {
      fetch(`${this.serverlessApiUrl}?action=send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          ...outgoing,
        }),
      }).catch((e) => {
        console.warn('[AuraDrop Signaling] Serverless send notice:', e);
      });
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
    this.stopHttpPolling();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
