import { WebSocketServer, WebSocket } from 'ws';
import { PresenceService } from '../services';

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
}

export class WebSocketGateway {
  private clients = new Map<string, { ws: WebSocket; info: DevicePeerInfo }>();

  constructor(
    private wss: WebSocketServer,
    private presenceService: PresenceService
  ) {
    this.init();
  }

  private init(): void {
    this.wss.on('connection', (ws: WebSocket, req) => {
      let registeredDeviceId: string | null = null;
      const remoteIp = req.socket.remoteAddress || 'unknown';

      console.log(`[WS CONNECT] Incoming connection from ${remoteIp}`);

      ws.on('message', (data: Buffer | string) => {
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

              console.log(
                `[WS REGISTER] Device "${info.displayName}" (${devId}) [${info.platform}] from ${remoteIp} - visibility: ${info.visibility}`
              );

              // 1. Gather all other active, discoverable peers
              const otherPeers: DevicePeerInfo[] = [];
              for (const [id, client] of this.clients.entries()) {
                if (id !== devId && client.ws.readyState === WebSocket.OPEN && client.info.visibility !== 'off') {
                  otherPeers.push(client.info);
                }
              }

              // 2. Send acknowledgment and current peer list to the registering device
              ws.send(
                JSON.stringify({
                  type: 'REGISTERED',
                  deviceId: devId,
                  peers: otherPeers,
                })
              );

              console.log(`[WS REGISTERED] Sent ${otherPeers.length} active peers to ${devId}`);

              // 3. If this device is visible, announce to all other active connected devices
              if (info.visibility !== 'off') {
                const onlineNotice = JSON.stringify({
                  type: 'PEER_ONLINE',
                  peer: info,
                });

                let notifyCount = 0;
                for (const [id, client] of this.clients.entries()) {
                  if (id !== devId && client.ws.readyState === WebSocket.OPEN) {
                    client.ws.send(onlineNotice);
                    notifyCount++;
                  }
                }
                console.log(`[WS PEER_ONLINE] Broadcasted online notice for ${devId} to ${notifyCount} peers`);
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
              }
              ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
              break;
            }

            case 'SIGNAL': {
              const target = msg.targetDeviceId || msg.targetId;
              const sender = msg.senderId || msg.deviceId;

              if (!target || !this.clients.has(target)) {
                console.warn(`[WS SIGNAL] Target device ${target} offline or not found for signal from ${sender}`);
                ws.send(
                  JSON.stringify({
                    type: 'SIGNAL_TARGET_OFFLINE',
                    targetDeviceId: target,
                    senderId: sender,
                  })
                );
                break;
              }

              const targetClient = this.clients.get(target);
              if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                targetClient.ws.send(JSON.stringify(msg));

                // Send signaling acknowledgment to sender (Section 21)
                const signalType = msg.signal?.type || (msg.signal?.candidate ? 'candidate' : 'unknown');
                const ackType =
                  signalType === 'offer'
                    ? 'OFFER_FORWARDED'
                    : signalType === 'answer'
                    ? 'ANSWER_FORWARDED'
                    : 'ICE_FORWARDED';

                ws.send(
                  JSON.stringify({
                    type: ackType,
                    targetDeviceId: target,
                    timestamp: Date.now(),
                  })
                );

                console.log(`[WS SIGNAL] Relayed ${signalType} from ${sender} -> ${target}`);
              } else {
                ws.send(
                  JSON.stringify({
                    type: 'SIGNAL_TARGET_OFFLINE',
                    targetDeviceId: target,
                    senderId: sender,
                  })
                );
              }
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

              if (target && this.clients.has(target)) {
                const targetClient = this.clients.get(target);
                if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                  targetClient.ws.send(JSON.stringify(msg));
                  console.log(`[WS ${msg.type}] Relayed from ${sender} -> ${target}`);
                  break;
                }
              }

              console.warn(`[WS ${msg.type}] Target ${target} unavailable`);
              ws.send(
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

      ws.on('close', (code, reason) => {
        if (registeredDeviceId) {
          console.log(`[WS CLOSE] Device disconnected: ${registeredDeviceId} (code: ${code})`);
          this.clients.delete(registeredDeviceId);
          this.presenceService.removeDevice(registeredDeviceId);

          // Broadcast peer offline to all remaining clients
          const offlineNotice = JSON.stringify({
            type: 'PEER_OFFLINE',
            deviceId: registeredDeviceId,
          });

          for (const client of this.clients.values()) {
            if (client.ws.readyState === WebSocket.OPEN) {
              client.ws.send(offlineNotice);
            }
          }
        } else {
          console.log(`[WS CLOSE] Unregistered socket closed from ${remoteIp}`);
        }
      });

      ws.on('error', (err) => {
        console.error(`[WS SOCKET ERROR] Socket error for ${registeredDeviceId || remoteIp}:`, err);
      });
    });
  }

  getConnectedPeers(): DevicePeerInfo[] {
    return Array.from(this.clients.values()).map((c) => c.info);
  }

  sendToDevice(targetDeviceId: string, message: any): boolean {
    const client = this.clients.get(targetDeviceId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }
}
