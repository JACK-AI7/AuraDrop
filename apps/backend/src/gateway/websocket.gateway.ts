import { WebSocketServer, WebSocket } from 'ws';
import { PresenceService } from '../services';

export interface SignalingMessage {
  type: 'REGISTER' | 'SIGNAL' | 'PING' | 'PONG' | 'TRANSFER_ALERT';
  deviceId: string;
  targetDeviceId?: string;
  payload?: any;
}

export class WebSocketGateway {
  private clients = new Map<string, WebSocket>();

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
            case 'REGISTER':
              registeredDeviceId = msg.deviceId;
              this.clients.set(msg.deviceId, ws);
              this.presenceService.recordHeartbeat(msg.deviceId, msg.deviceId);
              ws.send(JSON.stringify({ type: 'REGISTERED', deviceId: msg.deviceId }));
              break;

            case 'PING':
              if (registeredDeviceId) {
                this.presenceService.recordHeartbeat(registeredDeviceId, registeredDeviceId);
              }
              ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
              break;

            case 'SIGNAL':
            case 'TRANSFER_ALERT':
              if (msg.targetDeviceId && this.clients.has(msg.targetDeviceId)) {
                const targetWs = this.clients.get(msg.targetDeviceId);
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                  targetWs.send(JSON.stringify(msg));
                }
              }
              break;
          }
        } catch {
          // Ignore malformed JSON
        }
      });

      ws.on('close', () => {
        if (registeredDeviceId) {
          this.clients.delete(registeredDeviceId);
          this.presenceService.removeDevice(registeredDeviceId);
        }
      });
    });
  }

  sendToDevice(targetDeviceId: string, message: any): boolean {
    const ws = this.clients.get(targetDeviceId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }
}
