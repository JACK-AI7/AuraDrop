import * as dgram from 'node:dgram';
import * as os from 'node:os';
import { EventEmitter } from 'node:events';
import {
  DEFAULT_DISCOVERY_UDP_PORT,
  DEFAULT_TRANSFER_PORT,
  DEFAULT_MULTICAST_GROUP,
  DISCOVERY_BROADCAST_INTERVAL_MS,
  PEER_DISCOVERY_TTL_MS,
  PROTOCOL_VERSION,
} from '@auradrop/config';
import { DeviceInfo, PlatformType, VisibilityMode } from '@auradrop/types';

export interface DiscoveryEngineOptions {
  deviceId: string;
  deviceName: string;
  platform: PlatformType;
  publicKeyHex: string;
  transferPort?: number;
  discoveryPort?: number;
  visibilityMode?: VisibilityMode;
  trustedPublicKeys?: Set<string>;
}

export interface BeaconPayload {
  type: 'AURADROP_BEACON' | 'AURADROP_GOODBYE';
  protocol: string;
  deviceId: string;
  name: string;
  platform: PlatformType;
  publicKey: string;
  transferPort: number;
  visibilityMode: VisibilityMode;
  timestamp: number;
  capabilities: {
    protocolVersion: string;
    supportsFolder: boolean;
    supportsResume: boolean;
    maxChunkSize: number;
  };
}

export class DiscoveryEngine extends EventEmitter {
  private socket?: dgram.Socket;
  private isRunning: boolean = false;
  private broadcastTimer?: NodeJS.Timeout;
  private pruneTimer?: NodeJS.Timeout;
  private temporaryVisibilityTimer?: NodeJS.Timeout;

  public visibilityMode: VisibilityMode;
  public temporaryVisibilityExpiresAt?: number;
  public peers: Map<string, DeviceInfo> = new Map();

  constructor(private options: DiscoveryEngineOptions) {
    super();
    this.visibilityMode = options.visibilityMode || 'everyone';
  }

  /**
   * Start advertising and scanning
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    return new Promise((resolve, reject) => {
      try {
        this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        this.socket.on('error', (err) => {
          this.emit('error', err);
        });

        this.socket.on('message', (msg, rinfo) => {
          this.handleIncomingMessage(msg, rinfo);
        });

        const port = this.options.discoveryPort || DEFAULT_DISCOVERY_UDP_PORT;

        this.socket.bind(port, () => {
          try {
            this.socket?.setBroadcast(true);
            try {
              this.socket?.addMembership(DEFAULT_MULTICAST_GROUP);
            } catch {
              // Multicast group join might not be permitted on some interfaces, broadcast will work
            }

            this.isRunning = true;
            this.startBroadcasting();
            this.startPeerPruning();
            this.emit('started');
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Stop discovery and broadcast goodbye
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.sendGoodbye();
    this.isRunning = false;

    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    if (this.temporaryVisibilityTimer) clearTimeout(this.temporaryVisibilityTimer);

    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Ignored
      }
      this.socket = undefined;
    }

    this.peers.clear();
    this.emit('stopped');
  }

  /**
   * Set visibility mode ('off' | 'contacts' | 'everyone')
   */
  setVisibility(mode: VisibilityMode, temporaryDurationMs?: number): void {
    this.visibilityMode = mode;

    if (this.temporaryVisibilityTimer) {
      clearTimeout(this.temporaryVisibilityTimer);
      this.temporaryVisibilityTimer = undefined;
      this.temporaryVisibilityExpiresAt = undefined;
    }

    if (temporaryDurationMs && temporaryDurationMs > 0) {
      this.temporaryVisibilityExpiresAt = Date.now() + temporaryDurationMs;
      this.temporaryVisibilityTimer = setTimeout(() => {
        // Revert to 'contacts' or 'off'
        this.visibilityMode = 'contacts';
        this.temporaryVisibilityExpiresAt = undefined;
        this.emit('visibility_changed', this.visibilityMode);
        this.sendBeacon();
      }, temporaryDurationMs);
    }

    this.emit('visibility_changed', this.visibilityMode);
    if (mode === 'off') {
      this.sendGoodbye();
    } else {
      this.sendBeacon();
    }
  }

  /**
   * Get all active nearby devices
   */
  getDiscoveredDevices(): DeviceInfo[] {
    return Array.from(this.peers.values());
  }

  private startBroadcasting(): void {
    this.sendBeacon();
    this.broadcastTimer = setInterval(() => {
      this.sendBeacon();
    }, DISCOVERY_BROADCAST_INTERVAL_MS);
  }

  private sendBeacon(): void {
    if (!this.socket || !this.isRunning || this.visibilityMode === 'off') return;

    const payload: BeaconPayload = {
      type: 'AURADROP_BEACON',
      protocol: PROTOCOL_VERSION,
      deviceId: this.options.deviceId,
      name: this.options.deviceName,
      platform: this.options.platform,
      publicKey: this.options.publicKeyHex,
      transferPort: this.options.transferPort || DEFAULT_TRANSFER_PORT,
      visibilityMode: this.visibilityMode,
      timestamp: Date.now(),
      capabilities: {
        protocolVersion: PROTOCOL_VERSION,
        supportsFolder: true,
        supportsResume: true,
        maxChunkSize: 1024 * 1024,
      },
    };

    const buffer = Buffer.from(JSON.stringify(payload), 'utf8');
    const port = this.options.discoveryPort || DEFAULT_DISCOVERY_UDP_PORT;

    // Broadcast to local subnet
    try {
      this.socket.send(buffer, 0, buffer.length, port, '255.255.255.255');
    } catch {
      // Ignored
    }

    // Multicast to group
    try {
      this.socket.send(buffer, 0, buffer.length, port, DEFAULT_MULTICAST_GROUP);
    } catch {
      // Ignored
    }
  }

  private sendGoodbye(): void {
    if (!this.socket) return;
    const payload: BeaconPayload = {
      type: 'AURADROP_GOODBYE',
      protocol: PROTOCOL_VERSION,
      deviceId: this.options.deviceId,
      name: this.options.deviceName,
      platform: this.options.platform,
      publicKey: this.options.publicKeyHex,
      transferPort: this.options.transferPort || DEFAULT_TRANSFER_PORT,
      visibilityMode: 'off',
      timestamp: Date.now(),
      capabilities: {
        protocolVersion: PROTOCOL_VERSION,
        supportsFolder: true,
        supportsResume: true,
        maxChunkSize: 1024 * 1024,
      },
    };
    const buffer = Buffer.from(JSON.stringify(payload), 'utf8');
    const port = this.options.discoveryPort || DEFAULT_DISCOVERY_UDP_PORT;
    try {
      this.socket.send(buffer, 0, buffer.length, port, '255.255.255.255');
    } catch {
      // Ignored
    }
  }

  private handleIncomingMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    try {
      const payload: BeaconPayload = JSON.parse(msg.toString('utf8'));

      // Filter self
      if (payload.deviceId === this.options.deviceId) return;
      if (payload.protocol !== PROTOCOL_VERSION) return;

      if (payload.type === 'AURADROP_GOODBYE') {
        if (this.peers.has(payload.deviceId)) {
          const removed = this.peers.get(payload.deviceId)!;
          this.peers.delete(payload.deviceId);
          this.emit('peer_disappeared', removed);
        }
        return;
      }

      // Check remote visibility
      if (payload.visibilityMode === 'off') return;

      // Check contacts mode filtering
      const isTrusted = this.options.trustedPublicKeys?.has(payload.publicKey);
      if (this.visibilityMode === 'contacts' && !isTrusted) return;
      if (payload.visibilityMode === 'contacts' && !isTrusted) return;

      const existing = this.peers.get(payload.deviceId);
      const isNew = !existing;

      const addresses = existing ? Array.from(new Set([...existing.addresses, rinfo.address])) : [rinfo.address];

      const deviceInfo: DeviceInfo = {
        id: payload.deviceId,
        name: payload.name,
        platform: payload.platform,
        publicKey: payload.publicKey,
        addresses,
        port: payload.transferPort,
        discoveryTransport: 'udp-multicast',
        lastSeen: Date.now(),
        visibilityMode: payload.visibilityMode,
        pairingStatus: isTrusted ? 'paired' : 'unpaired',
        signalStrength: 95, // Local LAN signal
        capabilities: payload.capabilities,
      };

      this.peers.set(payload.deviceId, deviceInfo);

      if (isNew) {
        this.emit('peer_discovered', deviceInfo);
      } else {
        this.emit('peer_updated', deviceInfo);
      }
    } catch {
      // Ignore malformed packets
    }
  }

  private startPeerPruning(): void {
    this.pruneTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, peer] of this.peers.entries()) {
        if (now - peer.lastSeen > PEER_DISCOVERY_TTL_MS) {
          this.peers.delete(id);
          this.emit('peer_disappeared', peer);
        }
      }
    }, PEER_DISCOVERY_TTL_MS / 2);
  }

  /**
   * Get all local network IPv4 addresses
   */
  static getLocalIpAddresses(): string[] {
    const interfaces = os.networkInterfaces();
    const addresses: string[] = [];

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          addresses.push(iface.address);
        }
      }
    }
    return addresses;
  }
}
