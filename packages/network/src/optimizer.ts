import * as net from 'node:net';
import { DeviceInfo, TransportType, TransportDisplayInfo } from '@auradrop/types';
import { ITransport, TcpTransport } from './transport';

export interface NetworkOptimizerOptions {
  allowRelayFallback?: boolean;
  probeTimeoutMs?: number;
}

export interface OptimizedConnectionResult {
  transport: ITransport;
  transportType: TransportType;
  displayInfo: TransportDisplayInfo;
  remoteAddress: string;
  remotePort: number;
}

/**
 * Section 11: NetworkOptimizer
 * Intelligently probes and selects the fastest, most direct transport path.
 */
export class NetworkOptimizer {
  constructor(private options: NetworkOptimizerOptions = {}) {}

  /**
   * Determine whether an IP address belongs to Wi-Fi Direct (e.g. Android P2P 192.168.49.x)
   */
  static isDirectWifiAddress(ip: string): boolean {
    return ip.startsWith('192.168.49.') || ip.startsWith('10.0.88.');
  }

  /**
   * Automatically select best available transport by probing candidate endpoints
   */
  async connectToPeer(
    peer: DeviceInfo,
    forcedTransport?: TransportType
  ): Promise<OptimizedConnectionResult> {
    const addresses = peer.addresses || [];
    const port = peer.port;
    const timeoutMs = this.options.probeTimeoutMs || 3000;

    // 1. Direct Wi-Fi / P2P priority
    for (const ip of addresses) {
      if (NetworkOptimizer.isDirectWifiAddress(ip)) {
        try {
          const socket = await this.probeTcpConnection(ip, port, timeoutMs);
          const transport = new TcpTransport(socket, 'DIRECT_WIFI_P2P');
          return {
            transport,
            transportType: 'DIRECT_WIFI_P2P',
            displayInfo: transport.getDisplayInfo(),
            remoteAddress: ip,
            remotePort: port,
          };
        } catch {
          // Probe failed, continue down priority list
        }
      }
    }

    // 2. Same Local Network (LAN TCP) priority
    for (const ip of addresses) {
      try {
        const socket = await this.probeTcpConnection(ip, port, timeoutMs);
        const transport = new TcpTransport(socket, 'LOCAL_NETWORK');
        return {
          transport,
          transportType: 'LOCAL_NETWORK',
          displayInfo: transport.getDisplayInfo(),
          remoteAddress: ip,
          remotePort: port,
        };
      } catch {
        // Probe failed, try next address
      }
    }

    // 3. Fallback: Relay only when explicitly allowed
    if (this.options.allowRelayFallback) {
      throw new Error(
        'Direct local connections failed. Relay fallback requested but requires configured relay server.'
      );
    }

    throw new Error(
      `Could not establish direct connection to ${peer.name} (${peer.id}) on addresses: [${addresses.join(', ')}]:${port}`
    );
  }

  private probeTcpConnection(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let hasTimedOut = false;

      const timer = setTimeout(() => {
        hasTimedOut = true;
        socket.destroy();
        reject(new Error(`TCP probe timed out to ${host}:${port}`));
      }, timeoutMs);

      socket.connect(port, host, () => {
        clearTimeout(timer);
        if (!hasTimedOut) {
          resolve(socket);
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timer);
        socket.destroy();
        reject(err);
      });
    });
  }
}
