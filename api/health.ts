import type { IncomingMessage, ServerResponse } from 'node:http';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      status: 'ok',
      service: 'AuraDrop V21 Production Control Plane',
      timestamp: Date.now(),
      version: '1.0.0',
      endpoints: {
        signaling: '/api/signaling',
        conversations: '/api/conversations',
        health: '/api/health',
      },
    })
  );
}
