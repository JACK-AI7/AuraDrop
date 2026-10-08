import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { NeonDatabaseService } from './db/neon.js';
import { RedisRealtimeService } from './redis/client.js';
import { WebSocketSignalingServer } from './ws/server.js';
import { createApiRouter } from './routes/api.js';

async function bootstrap() {
  console.log('----------------------------------------------------');
  console.log('🚀 AuraDrop Standalone Production Signaling Server');
  console.log('----------------------------------------------------');

  // 1. Initialize Durable Neon Database
  console.log('[Bootstrap] Connecting to Neon PostgreSQL...');
  const db = new NeonDatabaseService();
  await db.initialize();

  // 2. Initialize Realtime Redis Backplane
  console.log('[Bootstrap] Initializing Redis Realtime Backplane...');
  const redis = new RedisRealtimeService();
  await redis.initialize();

  // 3. Initialize Express App
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: config.corsOrigins === '*' ? true : config.corsOrigins.split(',').map((s) => s.trim()),
      credentials: true,
    })
  );
  app.use(express.json({ limit: '2mb' }));

  // Mount API routers
  const apiRouter = createApiRouter(db, redis);
  app.use('/', apiRouter);
  app.use('/api', apiRouter);

  // 4. Create HTTP Server
  const server = http.createServer(app);

  // 5. Initialize WebSocket Server
  const wss = new WebSocketServer({ noServer: true });
  new WebSocketSignalingServer(wss, db, redis);

  // Support /ws, /api/ws, and root path / for maximum client compatibility
  server.on('upgrade', (request, socket, head) => {
    const pathname = request.url?.split('?')[0] || '/';
    if (pathname === '/ws' || pathname === '/api/ws' || pathname === '/' || pathname === '/signaling') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  // 6. Listen
  server.listen(config.port, config.host, () => {
    console.log(`[Bootstrap] HTTP & WebSocket listening on http://${config.host}:${config.port}`);
    console.log(`[Bootstrap] WebSocket endpoint: ws://${config.host}:${config.port}/ws`);
    console.log(`[Bootstrap] Health endpoint: http://${config.host}:${config.port}/healthz`);
  });

  // 7. Graceful Shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Bootstrap] Received ${signal}. Gracefully shutting down...`);
    server.close();
    wss.close();
    await redis.close();
    await db.close();
    console.log('[Bootstrap] AuraDrop Signaling Server stopped cleanly.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[Bootstrap] Fatal startup error:', err);
  process.exit(1);
});
