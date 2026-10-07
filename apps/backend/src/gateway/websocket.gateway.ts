import { WebSocketServer, WebSocket } from 'ws';
import { PresenceService } from '../services';
import { RedisRealtimeService, PresencePayload } from '../redis/redis.service';
import { NeonDatabaseClient } from '@auradrop/database';

export interface DevicePeerInfo {
  deviceId: string;
  displayName: string;
  deviceName: string;
  platform: string;
  visibility: 'everyone' | 'trusted' | 'off';
  capabilities?: {
    webrtc: boolean;
    directLan: boolean;
  };
  remoteIp?: string;
  lastSeen: number;
}

export interface SignalingMessage {
  type:
    | 'REGISTER'
    | 'REGISTERED'
    | 'PEER_ONLINE'
    | 'PEER_OFFLINE'
    | 'PEER_LIST'
    | 'SIGNAL'
    | 'SIGNAL_TARGET_OFFLINE'
    | 'OFFER_FORWARDED'
    | 'ANSWER_FORWARDED'
    | 'ICE_FORWARDED'
    | 'PING'
    | 'PONG'
    | 'TRANSFER_REQUEST'
    | 'TRANSFER_RESPONSE'
    | 'TRANSFER_ACCEPT'
    | 'TRANSFER_DECLINE'
    | 'TRANSFER_COMPLETE'
    | 'TRANSFER_ACK_COMPLETE'
    | 'TRANSFER_ALERT';
  deviceId: string;
  targetDeviceId?: string;
  senderId?: string;
  targetId?: string;
  payload?: any;
  signal?: any;
  peers?: DevicePeerInfo[];
  peer?: DevicePeerInfo;
  _originInstance?: string;
}

export class WebSocketGateway {
  private clients = new Map<string, { ws: WebSocket; info: DevicePeerInfo }>();

  constructor(
    private wss: WebSocketServer,
    private presenceService: PresenceService,
    private redisService?: RedisRealtimeService,
    private db?: NeonDatabaseClient
  ) {
    this.init();
    this.setupRedisClusterRelay();
  }

  private safeSend(ws: WebSocket, data: string): boolean {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 2 * 1024 * 1024) {
      try {
        ws.send(data);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  private setupRedisClusterRelay(): void {
    if (!this.redisService) return;

    this.redisService.subscribeSignaling('auradrop:signaling', (msg: SignalingMessage) => {
      const target = msg.targetDeviceId || msg.targetId;
      if (target && this.clients.has(target)) {
        const client = this.clients.get(target);
        if (client) {
          this.safeSend(client.ws, JSON.stringify(msg));
        }
      } else if (msg.type === 'PEER_ONLINE' && msg.peer) {
        // Broadcast remote peer online to local clients (limit burst)
        const notice = JSON.stringify({ type: 'PEER_ONLINE', peer: msg.peer });
        let count = 0;
        for (const [id, c] of this.clients.entries()) {
          if (id !== msg.peer.deviceId) {
            this.safeSend(c.ws, notice);
            if (++count > 100) break; // Cap broadcast fanout
          }
        }
      } else if (msg.type === 'PEER_OFFLINE' && msg.deviceId) {
        const notice = JSON.stringify({ type: 'PEER_OFFLINE', deviceId: msg.deviceId });
        let count = 0;
        for (const [id, c] of this.clients.entries()) {
          if (id !== msg.deviceId) {
            this.safeSend(c.ws, notice);
            if (++count > 100) break;
          }
        }
      }
    });
  }

  private init(): void {
    this.wss.on('connection', (ws: WebSocket, req) => {
      let registeredDeviceId: string | null = null;
      const remoteIp = req.socket.remoteAddress || 'unknown';

      ws.on('message', async (data: Buffer | string) => {
        try {
          const msg: SignalingMessage = JSON.parse(data.toString());

          switch (msg.type) {
            case 'REGISTER': {
              const devId = msg.deviceId;
              registeredDeviceId = devId;

              const payload = msg.payload || {};
              const info: DevicePeerInfo = {
                deviceId: devId,
                displayName: payload.displayName || `Device ${devId.substring(devId.length - 4)}`,
                deviceName: payload.deviceName || payload.platform || 'Unknown Device',
                platform: payload.platform || 'web',
                visibility: payload.visibility || 'everyone',
                capabilities: payload.capabilities || { webrtc: true, directLan: true },
                remoteIp,
                lastSeen: Date.now(),
              };

              this.clients.set(devId, { ws, info });
              this.presenceService.recordHeartbeat(devId, devId);

              // Update Redis presence
              if (this.redisService) {
                await this.redisService.setPresence({
                  ...info,
                  instanceId: this.redisService.getInstanceId(),
                }, 15);
              }

              // Update Database
              if (this.db) {
                this.db.devices.register({
                  id: devId,
                  deviceName: info.displayName,
                  platform: info.platform,
                  devicePublicKey: payload.publicKey || devId,
                  capabilitiesJson: info.capabilities,
                }).catch(() => {});
              }

              // Gather active discoverable peers (capped at 50 to avoid megabyte JSON overhead)
              let peerList: DevicePeerInfo[] = [];
              if (this.redisService) {
                const redisPeers = await this.redisService.getActivePeers(devId);
                peerList = redisPeers.slice(0, 50).map((p) => ({
                  deviceId: p.deviceId,
                  displayName: p.displayName,
                  deviceName: p.deviceName,
                  platform: p.platform,
                  visibility: p.visibility,
                  capabilities: p.capabilities,
                  remoteIp: p.remoteIp,
                  lastSeen: p.lastSeen,
                }));
              } else {
                for (const [id, client] of this.clients.entries()) {
                  if (id !== devId && client.ws.readyState === WebSocket.OPEN && client.info.visibility !== 'off') {
                    peerList.push(client.info);
                    if (peerList.length >= 50) break;
                  }
                }
              }

              // Send acknowledgment & current peer list
              this.safeSend(
                ws,
                JSON.stringify({
                  type: 'REGISTERED',
                  deviceId: devId,
                  peers: peerList,
                })
              );

              // Broadcast online announcement to connected devices (capped at 50 peers)
              if (info.visibility !== 'off') {
                const onlineNotice = JSON.stringify({
                  type: 'PEER_ONLINE',
                  peer: info,
                });

                let notifyCount = 0;
                for (const [id, client] of this.clients.entries()) {
                  if (id !== devId) {
                    if (this.safeSend(client.ws, onlineNotice)) {
                      notifyCount++;
                      if (notifyCount >= 50) break;
                    }
                  }
                }

                // Publish to cluster
                if (this.redisService) {
                  await this.redisService.publishSignaling('auradrop:signaling', {
                    type: 'PEER_ONLINE',
                    peer: info,
                  });
                }
              }
              break;
            }

            case 'PING': {
              if (registeredDeviceId) {
                const client = this.clients.get(registeredDeviceId);
                if (client) {
                  client.info.lastSeen = Date.now();
                }
                this.presenceService.recordHeartbeat(registeredDeviceId, registeredDeviceId);
                if (this.redisService) {
                  this.redisService.refreshPresence(registeredDeviceId, 15).catch(() => {});
                }
              }
              this.safeSend(ws, JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
              break;
            }

            case 'SIGNAL': {
              const target = msg.targetDeviceId || msg.targetId;
              const sender = msg.senderId || msg.deviceId;

              // Check if target is local
              if (target && this.clients.has(target)) {
                const targetClient = this.clients.get(target);
                if (targetClient && this.safeSend(targetClient.ws, JSON.stringify(msg))) {
                  const signalType = msg.signal?.type || (msg.signal?.candidate ? 'candidate' : 'unknown');
                  const ackType =
                    signalType === 'offer'
                      ? 'OFFER_FORWARDED'
                      : signalType === 'answer'
                      ? 'ANSWER_FORWARDED'
                      : 'ICE_FORWARDED';

                  this.safeSend(
                    ws,
                    JSON.stringify({
                      type: ackType,
                      targetDeviceId: target,
                      timestamp: Date.now(),
                    })
                  );
                  break;
                }
              }

              // If not local, relay via Redis cluster
              if (this.redisService && target) {
                await this.redisService.publishSignaling('auradrop:signaling', msg);
                const signalType = msg.signal?.type || (msg.signal?.candidate ? 'candidate' : 'unknown');
                const ackType =
                  signalType === 'offer'
                    ? 'OFFER_FORWARDED'
                    : signalType === 'answer'
                    ? 'ANSWER_FORWARDED'
                    : 'ICE_FORWARDED';

                this.safeSend(
                  ws,
                  JSON.stringify({
                    type: ackType,
                    targetDeviceId: target,
                    timestamp: Date.now(),
                  })
                );
                break;
              }

              // Target offline
              this.safeSend(
                ws,
                JSON.stringify({
                  type: 'SIGNAL_TARGET_OFFLINE',
                  targetDeviceId: target,
                  senderId: sender,
                })
              );
              break;
            }

            case 'TRANSFER_REQUEST':
            case 'TRANSFER_RESPONSE':
            case 'TRANSFER_ACCEPT':
            case 'TRANSFER_DECLINE':
            case 'TRANSFER_COMPLETE':
            case 'TRANSFER_ACK_COMPLETE':
            case 'TRANSFER_ALERT': {
              const target = msg.targetDeviceId || msg.targetId;
              const sender = msg.senderId || msg.deviceId;

              // Database audit tracking
              if (this.db) {
                if (msg.type === 'TRANSFER_REQUEST' && msg.payload) {
                  this.db.transfers.createSession({
                    id: msg.payload.transferId || `tx_${Date.now()}`,
                    senderDeviceId: sender,
                    receiverDeviceId: target || 'unknown',
                    direction: 'outgoing',
                    fileCount: msg.payload.totalFiles || 1,
                    totalBytes: msg.payload.totalBytes || 0,
                  }).catch(() => {});
                } else if (msg.type === 'TRANSFER_ACCEPT' && msg.payload?.transferId) {
                  this.db.transfers.updateStatus(msg.payload.transferId, 'ACCEPTED').catch(() => {});
                } else if (msg.type === 'TRANSFER_COMPLETE' && msg.payload?.transferId) {
                  this.db.transfers.updateStatus(msg.payload.transferId, 'COMPLETED', msg.payload.transferredBytes).catch(() => {});
                }
              }

              // Check if target is local
              if (target && this.clients.has(target)) {
                const targetClient = this.clients.get(target);
                if (targetClient && this.safeSend(targetClient.ws, JSON.stringify(msg))) {
                  break;
                }
              }

              // If not local, publish to Redis cluster
              if (this.redisService && target) {
                await this.redisService.publishSignaling('auradrop:signaling', msg);
                break;
              }

              this.safeSend(
                ws,
                JSON.stringify({
                  type: 'SIGNAL_TARGET_OFFLINE',
                  targetDeviceId: target,
                  senderId: sender,
                })
              );
              break;
            }
          }
        } catch (err) {
          console.error(`[WS ERROR] Error processing message from ${remoteIp}:`, err);
        }
      });

      ws.on('close', async (code, reason) => {
        if (registeredDeviceId) {
          this.clients.delete(registeredDeviceId);
          this.presenceService.removeDevice(registeredDeviceId);

          if (this.redisService) {
            await this.redisService.removePresence(registeredDeviceId);
            await this.redisService.publishSignaling('auradrop:signaling', {
              type: 'PEER_OFFLINE',
              deviceId: registeredDeviceId,
            });
          }

          const offlineNotice = JSON.stringify({
            type: 'PEER_OFFLINE',
            deviceId: registeredDeviceId,
          });

          let count = 0;
          for (const client of this.clients.values()) {
            if (this.safeSend(client.ws, offlineNotice)) {
              count++;
              if (count >= 50) break;
            }
          }
        }
      });

      ws.on('error', () => {
        // Suppress socket reset spam during client termination
      });
    });
  }

  getConnectedPeers(): DevicePeerInfo[] {
    return Array.from(this.clients.values()).map((c) => c.info);
  }

  sendToDevice(targetDeviceId: string, message: any): boolean {
    const client = this.clients.get(targetDeviceId);
    if (client) {
      return this.safeSend(client.ws, JSON.stringify(message));
    }
    return false;
  }
}
