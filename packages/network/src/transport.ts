import * as net from 'node:net';
import { EventEmitter } from 'node:events';
import { TransportType, TransportDisplayInfo } from '@auradrop/types';

export interface ITransport extends EventEmitter {
  send(data: Buffer): Promise<void>;
  close(): Promise<void>;
  getType(): TransportType;
  getDisplayInfo(): TransportDisplayInfo;
  isAlive(): boolean;
}

/**
 * High-performance streaming TCP Transport
 */
export class TcpTransport extends EventEmitter implements ITransport {
  private alive: boolean = true;
  public bytesSent: number = 0;
  public bytesReceived: number = 0;

  constructor(
    private socket: net.Socket,
    private transportType: TransportType = 'LOCAL_NETWORK'
  ) {
    super();

    this.socket.setNoDelay(true); // Disable Nagle's algorithm for immediate frame dispatch

    this.socket.on('data', (chunk: Buffer) => {
      this.bytesReceived += chunk.length;
      this.emit('data', chunk);
    });

    this.socket.on('error', (err: Error) => {
      this.alive = false;
      this.emit('error', err);
    });

    this.socket.on('close', (hadError: boolean) => {
      this.alive = false;
      this.emit('close', hadError);
    });

    this.socket.on('end', () => {
      this.emit('end');
    });
  }

  async send(data: Buffer): Promise<void> {
    if (!this.alive || this.socket.destroyed) {
      throw new Error('TCP Socket is closed or destroyed');
    }

    this.bytesSent += data.length;

    return new Promise((resolve, reject) => {
      const canContinue = this.socket.write(data, (err) => {
        if (err) return reject(err);
      });

      if (!canContinue) {
        // Backpressure: wait for kernel buffer to drain
        this.socket.once('drain', () => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  async close(): Promise<void> {
    this.alive = false;
    return new Promise((resolve) => {
      if (this.socket.destroyed) {
        resolve();
        return;
      }
      this.socket.end(() => {
        this.socket.destroy();
        resolve();
      });
    });
  }

  getType(): TransportType {
    return this.transportType;
  }

  getDisplayInfo(): TransportDisplayInfo {
    switch (this.transportType) {
      case 'DIRECT_WIFI_P2P':
        return {
          type: 'DIRECT_WIFI_P2P',
          label: 'Connected directly',
          isLocal: true,
          color: '#10B981', // Emerald
        };
      case 'LOCAL_NETWORK':
        return {
          type: 'LOCAL_NETWORK',
          label: 'Using local network',
          isLocal: true,
          color: '#00F2FE', // Aura Cyan
        };
      case 'WEBRTC_DATA':
        return {
          type: 'WEBRTC_DATA',
          label: 'Using WebRTC direct',
          isLocal: true,
          color: '#818CF8', // Indigo
        };
      case 'RELAY_FALLBACK':
      default:
        return {
          type: 'RELAY_FALLBACK',
          label: 'Using relay',
          isLocal: false,
          color: '#F59E0B', // Amber warning (leaves local network)
        };
    }
  }

  isAlive(): boolean {
    return this.alive && !this.socket.destroyed;
  }

  getSocket(): net.Socket {
    return this.socket;
  }
}
