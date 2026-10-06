import { BackendServer } from './server';

async function bootstrap() {
  const server = new BackendServer();
  const port = parseInt(process.env.PORT || '48280', 10);

  await server.listen(port);
  console.log(`[AuraDrop Backend] Server running on http://localhost:${port}`);
  console.log(`[AuraDrop Backend] WebSocket signaling gateway active`);
}

bootstrap().catch((err) => {
  console.error('[AuraDrop Backend] Startup failed:', err);
  process.exit(1);
});
