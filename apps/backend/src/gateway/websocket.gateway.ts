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
    | 'PING'
    | 'PONG'
    | 'TRANSFER_REQUEST'
    | 'TRANSFER_RESPONSE'
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
    this.wss.on('connection', (ws: WebSocket) => {
      let registeredDeviceId: string | null = null;

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
                lastSeen: Date.now(),
              };

              this.clients.set(devId, { ws, info });
              this.presenceService.recordHeartbeat(devId, devId);

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

              // 3. If this device is visible, announce to all other active connected devices
              if (info.visibility !== 'off') {
                const onlineNotice = JSON.stringify({
                  type: 'PEER_ONLINE',
                  peer: info,
                });

                for (const [id, client] of this.clients.entries()) {
                  if (id !== devId && client.ws.readyState === WebSocket.OPEN) {
                    client.ws.send(onlineNotice);
                  }
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
              }
              ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
              break;
            }

            case 'SIGNAL': {
              const target = msg.targetDeviceId || msg.targetId;
              if (target && this.clients.has(target)) {
                const targetClient = this.clients.get(target);
                if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                  targetClient.ws.send(JSON.stringify(msg));
                }
              }
              break;
            }

            case 'TRANSFER_REQUEST':
            case 'TRANSFER_RESPONSE':
            case 'TRANSFER_ACK_COMPLETE':
            case 'TRANSFER_ALERT': {
              const target = msg.targetDeviceId || msg.targetId;
              if (target && this.clients.has(target)) {
                const targetClient = this.clients.get(target);
                if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
                  targetClient.ws.send(JSON.stringify(msg));
                }
              }
              break;
            }
          }
        } catch {
          // Ignore malformed JSON
        }
      });

      ws.on('close', () => {
        if (registeredDeviceId) {
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
        }
      });
    });
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

