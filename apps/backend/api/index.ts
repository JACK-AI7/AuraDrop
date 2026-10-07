import { BackendServer } from '../src/server';

const server = new BackendServer();

export default async function handler(req: any, res: any) {
  try {
    await server.handleHttpRequest(req, res);
  } catch (err: any) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Serverless execution error', message: err?.message || 'Unknown' }));
    }
  }
}
