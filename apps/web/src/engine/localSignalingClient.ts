// AuraDrop V26 Local-First Direct LAN Signaling Client
// Manages zero-cloud WebSocket connections to Android's embedded AuraLanServer (port 53317).
// Handles bootstrap tokens, long-lived local trust tokens, and WebRTC signal routing.

export interface LocalSignalingCallbacks {
  onConnected?: (peer: { deviceId: string; deviceName: string; ip: string; port: number }) => void;
  onDisconnected?: (deviceId: string) => void;
  onSignal?: (senderId: string, signal: any) => void;
  onTransferRequest?: (payload: any) => void;
  onTransferAccept?: (payload: any) => void;
  onTransferDecline?: (payload: any) => void;
  onTransferAck?: (payload: any) => void;
  onChatMessage?: (payload: any) => void;
}

export interface LocalBootstrapPayload {
  protocol: 'AURADROP_LOCAL_V1';
  deviceId: string;
  deviceName: string;
  hostname?: string;
  ip: string;
  port: number;
  bootstrapToken: string;
  expiresAt: number;
}

export class LocalSignalingClient {
  private static instance: LocalSignalingClient;
  private socket: WebSocket | null = null;
  private callbacks: LocalSignalingCallbacks = {};
  private activePeer: { deviceId: string; deviceName: string; ip: string; port: number; sessionToken?: string } | null = null;
  private localIdentity: { deviceId: string; deviceName: string } = { deviceId: '', deviceName: 'Desktop Chrome' };
  private pingTimer: any = null;
  private isConnecting = false;

  private constructor() {}

  public static getInstance(): LocalSignalingClient {
    if (!LocalSignalingClient.instance) {
      LocalSignalingClient.instance = new LocalSignalingClient();
    }
    return LocalSignalingClient.instance;
  }

  public setIdentity(deviceId: string, deviceName: string): void {
    this.localIdentity = { deviceId, deviceName };
  }

  public setCallbacks(callbacks: LocalSignalingCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  public isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  public getActivePeer() {
    return this.activePeer;
  }

  // ---------------------------------------------------------------------------
  // 1. HTTP HEALTH CHECK (Tests if Android LAN server is reachable)
  // ---------------------------------------------------------------------------
  public async testEndpoint(ip: string, port: number): Promise<{ ok: boolean; info?: any }> {
    try {
      const url = `http://${ip}:${port}/api/auradrop/v1/health`;
      const res = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok) {
        const data = await res.json();
        return { ok: true, info: data };
      }
      return { ok: false };
    } catch {
      return { ok: false };
    }
  }

  // ---------------------------------------------------------------------------
  // 2. HTTP PAIR HANDSHAKE (Validates QR bootstrap token & exchanges session token)
  // ---------------------------------------------------------------------------
  public async pair(
    ip: string,
    port: number,
    bootstrapToken: string
  ): Promise<{ success: boolean; sessionToken?: string; deviceId?: string; deviceName?: string; error?: string }> {
    try {
      const url = `http://${ip}:${port}/api/auradrop/v1/pair`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: this.localIdentity.deviceId,
          deviceName: this.localIdentity.deviceName,
          bootstrapToken,
        }),
        signal: AbortSignal.timeout(3000),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        return { success: false, error: errData.error || 'Pairing HTTP request rejected' };
      }

      const data = await res.json();
      if (data.success) {
        return {
          success: true,
          sessionToken: data.sessionToken,
          deviceId: data.deviceId,
          deviceName: data.deviceName,
        };
      }
      return { success: false, error: 'Pairing response returned false' };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to contact phone on LAN' };
    }
  }

  // ---------------------------------------------------------------------------
  // 3. WEBSOCKET CONNECTION (Direct zero-cloud signaling over LAN)
  // ---------------------------------------------------------------------------
  public async connectWebSocket(
    ip: string,
    port: number,
    token?: string
  ): Promise<boolean> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      if (this.activePeer?.ip === ip && this.activePeer?.port === port) {
        return true;
      }
      this.disconnect();
    }

    if (this.isConnecting) return false;
    this.isConnecting = true;

    return new Promise<boolean>((resolve) => {
      const wsUrl = `ws://${ip}:${port}/ws`;
      console.log(`[LocalSignaling] Connecting direct LAN WebSocket to ${wsUrl}...`);

      let resolved = false;
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.isConnecting = false;
          console.warn('[LocalSignaling] WebSocket connection timed out');
          resolve(false);
        }
      }, 4000);

      try {
        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
          console.log('[LocalSignaling] Local WebSocket connected, sending AUTH...');
          this.socket?.send(
            JSON.stringify({
              type: 'AUTH',
              deviceId: this.localIdentity.deviceId,
              deviceName: this.localIdentity.deviceName,
              token: token || '',
            })
          );
        };

        this.socket.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            this.handleMessage(msg, ip, port, () => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeoutId);
                this.isConnecting = false;
                this.startPing();
                resolve(true);
              }
            });
          } catch (e) {
            console.warn('[LocalSignaling] Error parsing WS message:', e);
          }
        };

        this.socket.onclose = () => {
          console.log('[LocalSignaling] Local WebSocket closed');
          this.isConnecting = false;
          this.stopPing();
          const oldDeviceId = this.activePeer?.deviceId;
          this.activePeer = null;
          this.socket = null;
          if (oldDeviceId) {
            this.callbacks.onDisconnected?.(oldDeviceId);
          }
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            resolve(false);
          }
        };

        this.socket.onerror = (e) => {
          console.warn('[LocalSignaling] Local WebSocket error:', e);
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            this.isConnecting = false;
            resolve(false);
          }
        };
      } catch (err) {
        console.warn('[LocalSignaling] Failed to create WebSocket:', err);
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          this.isConnecting = false;
          resolve(false);
        }
      }
    });
  }

  private handleMessage(msg: any, ip: string, port: number, onAuthOk: () => void): void {
    const type = msg?.type;

    if (type === 'AUTH_OK') {
      console.log(`[LocalSignaling] Authenticated with phone: ${msg.deviceName} (${msg.deviceId})`);
      this.activePeer = {
        deviceId: msg.deviceId,
        deviceName: msg.deviceName,
        ip,
        port,
        sessionToken: msg.sessionToken,
      };
      this.callbacks.onConnected?.(this.activePeer);
      onAuthOk();
    } else if (type === 'AUTH_FAIL') {
      console.error('[LocalSignaling] Local authentication failed:', msg.error);
      this.disconnect();
    } else if (type === 'SIGNAL') {
      const senderId = msg.senderId || this.activePeer?.deviceId;
      if (senderId && msg.signal) {
        this.callbacks.onSignal?.(senderId, msg.signal);
      }
    } else if (type === 'TRANSFER_REQUEST') {
      this.callbacks.onTransferRequest?.(msg);
    } else if (type === 'TRANSFER_ACCEPT') {
      this.callbacks.onTransferAccept?.(msg);
    } else if (type === 'TRANSFER_DECLINE') {
      this.callbacks.onTransferDecline?.(msg);
    } else if (type === 'TRANSFER_ACK') {
      this.callbacks.onTransferAck?.(msg);
    } else if (type === 'CHAT') {
      this.callbacks.onChatMessage?.(msg);
    } else if (type === 'PING') {
      this.sendMessage({ type: 'PONG', timestamp: Date.now() });
    }
  }

  // ---------------------------------------------------------------------------
  // 4. SIGNAL & MESSAGE SENDING
  // ---------------------------------------------------------------------------
  public sendSignal(targetDeviceId: string, signal: any): boolean {
    if (!this.isConnected()) return false;
    return this.sendMessage({
      type: 'SIGNAL',
      senderId: this.localIdentity.deviceId,
      targetDeviceId,
      signal,
      timestamp: Date.now(),
    });
  }

  public sendMessage(payload: any): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.socket.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.isConnected()) {
        this.sendMessage({ type: 'PING', timestamp: Date.now() });
      }
    }, 15000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  public disconnect(): void {
    this.stopPing();
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
    }
    const oldDeviceId = this.activePeer?.deviceId;
    this.activePeer = null;
    this.isConnecting = false;
    if (oldDeviceId) {
      this.callbacks.onDisconnected?.(oldDeviceId);
    }
  }
}
