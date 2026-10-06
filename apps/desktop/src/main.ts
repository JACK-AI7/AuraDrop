import { DesktopClient } from './client';
import { DesktopWebUi } from './web-ui';

async function bootstrap() {
  const client = new DesktopClient();
  await client.start();

  const webUi = new DesktopWebUi(client);
  await webUi.start();

  console.log(`[AuraDrop Desktop] Client active: ${client.deviceName} (${client.deviceId})`);
}

bootstrap().catch((err) => {
  console.error('[AuraDrop Desktop] Startup failed:', err);
  process.exit(1);
});
