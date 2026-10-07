import * as os from 'node:os';
import { BackendServer } from './server';

async function bootstrap() {
  const server = new BackendServer();
  const port = parseInt(process.env.PORT || '48280', 10);
  const host = process.env.HOST || '0.0.0.0';

  await server.listen(port, host);
  console.log(`================================================================`);
  console.log(`🚀 AURADROP SIGNALING & PRESENCE BACKEND V13 ACTIVE`);
  console.log(`================================================================`);
  console.log(`[AuraDrop Backend] Listening on ${host}:${port}`);
  console.log(`[AuraDrop Backend] Local Loopback: http://localhost:${port}`);

  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (addrs) {
      for (const a of addrs) {
        if (a.family === 'IPv4' && !a.internal) {
          console.log(`[AuraDrop Backend] LAN IP (${name}): http://${a.address}:${port}`);
          console.log(`[AuraDrop Backend] Mobile Health: http://${a.address}:${port}/health`);
          console.log(`[AuraDrop Backend] Mobile WebSocket: ws://${a.address}:${port}`);
        }
      }
    }
  }
  console.log(`================================================================\n`);
}

bootstrap().catch((err) => {
  console.error('[AuraDrop Backend] Startup failed:', err);
  process.exit(1);
});
