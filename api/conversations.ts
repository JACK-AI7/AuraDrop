import type { IncomingMessage, ServerResponse } from 'node:http';
import { NeonDatabaseClient } from '../packages/database/src/neon-client';

// AuraDrop Vercel Serverless Conversations & Chat API (P2PFS/1 & V18 Production)
// Persists conversations, messages, group chats, in-chat attachments, and message controls
// into live Neon PostgreSQL with zero mock or simulated data.

let dbInstance: NeonDatabaseClient | null = null;

async function getDb(): Promise<NeonDatabaseClient> {
  if (!dbInstance) {
    dbInstance = new NeonDatabaseClient(process.env.DATABASE_URL);
    await dbInstance.initialize();
  }
  return dbInstance;
}

async function readBody(req: any): Promise<any> {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c: any) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

export default async function handler(req: any, res: any) {
  // CORS & Security Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Id, X-Device-Id, X-User-Name');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const db = await getDb();

  const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  let pathname = urlObj.pathname;

  // Handle rewrite subpaths passed by Vercel query or direct subpath
  const subpath = urlObj.searchParams.get('subpath');
  if (subpath) {
    pathname = subpath.startsWith('messages') ? `/api/${subpath}` : `/api/conversations/${subpath}`;
    pathname = pathname.replace(/\/+/g, '/');
  }

  // Extract authenticated or local user identity
  let userId =
    (req.headers['x-user-id'] as string) ||
    urlObj.searchParams.get('userId') ||
    'usr_local';

  let userName =
    (req.headers['x-user-name'] as string) ||
    urlObj.searchParams.get('userName') ||
    'User';

  let body: any = {};
  if (['POST', 'PUT', 'DELETE'].includes(req.method || '')) {
    body = await readBody(req);
    if (body.userId) userId = body.userId;
    if (body.userName) userName = body.userName;
  }

  // Ensure current user exists in Neon DB
  try {
    const existing = await db.users.findById(userId);
    if (!existing) {
      await db.users.create({
        id: userId,
        email: `${userId.replace(/[^a-zA-Z0-9_-]/g, '')}@auradrop.network`,
        username: userId,
        displayName: userName,
        passwordHash: 'auradrop_ephemeral_device_key',
      });
    }
  } catch {
    // Already exists or memory fallback
  }

  try {
    // -------------------------------------------------------------------------
    // 1. DELETE /api/messages/:id (Delete for everyone)
    // -------------------------------------------------------------------------
    const msgDeleteMatch = pathname.match(/^\/api\/messages\/([^/]+)$/);
    if (msgDeleteMatch && req.method === 'DELETE') {
      const msgId = msgDeleteMatch[1];
      const success = await db.messages.deleteForEveryone(msgId, userId);
      res.statusCode = 200;
      res.end(JSON.stringify({ success, deletedId: msgId }));
      return;
    }

    // -------------------------------------------------------------------------
    // 2. /api/conversations/:convId/clear (Clear chat)
    // -------------------------------------------------------------------------
    const clearMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/clear$/);
    if (clearMatch && req.method === 'DELETE') {
      const convId = clearMatch[1];
      await db.conversations.clearChat(convId, userId);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, conversationId: convId, cleared: true }));
      return;
    }

    // -------------------------------------------------------------------------
    // 3. /api/conversations/:convId/disappearing (Set disappearing timer)
    // -------------------------------------------------------------------------
    const disappearMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/disappearing$/);
    if (disappearMatch && (req.method === 'PUT' || req.method === 'POST')) {
      const convId = disappearMatch[1];
      const seconds = typeof body.seconds === 'number' ? body.seconds : 0;
      await db.conversations.setDisappearing(convId, seconds);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, conversationId: convId, disappearing_seconds: seconds }));
      return;
    }

    // -------------------------------------------------------------------------
    // 4. /api/conversations/:convId/messages (GET messages or POST new message)
    // -------------------------------------------------------------------------
    const messagesMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (messagesMatch) {
      const convId = messagesMatch[1];

      if (req.method === 'GET') {
        const limit = parseInt(urlObj.searchParams.get('limit') || '50', 10);
        const cursor = urlObj.searchParams.get('cursor') || undefined;
        const messages = await db.messages.list(convId, userId, cursor, limit);
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, conversationId: convId, messages }));
        return;
      }

      if (req.method === 'POST') {
        const text = body.text || '';
        const type = body.type || 'TEXT';
        const rawAttachments = body.attachments || [];
        const attachments = rawAttachments.map((att: any) => ({
          fileName: att.fileName || att.file_name || 'attachment',
          fileSize: Number(att.fileSize || att.file_size || 0),
          mimeType: att.mimeType || att.mime_type || 'application/octet-stream',
          fileHash: att.fileHash || att.file_hash || undefined,
          fileUrl: att.fileUrl || att.file_url || undefined,
          transferId: att.transferId || att.transfer_id || undefined,
        }));
        const replyToId = body.replyToId || undefined;
        const clientMsgId = body.clientMsgId || undefined;
        const senderId = body.senderId || userId;

        // Ensure sender exists in DB
        try {
          const sender = await db.users.findById(senderId);
          if (!sender) {
            await db.users.create({
              id: senderId,
              email: `${senderId}@auradrop.network`,
              username: senderId,
              displayName: userName,
              passwordHash: 'auradrop_sender_hash',
            });
          }
        } catch {}

        const message = await db.messages.create({
          conversationId: convId,
          senderId,
          text,
          type,
          attachments,
          replyToId,
          clientMsgId,
        });

        res.statusCode = 201;
        res.end(JSON.stringify({ success: true, message }));
        return;
      }
    }

    // -------------------------------------------------------------------------
    // 5. POST /api/conversations/direct (Create direct 1-on-1 chat)
    // -------------------------------------------------------------------------
    if (
      (pathname === '/api/conversations/direct' || pathname === '/api/conversations') &&
      req.method === 'POST' &&
      (body.userBId || body.peerId || body.targetDeviceId)
    ) {
      const userAId = body.userAId || userId;
      const userBId = body.userBId || body.peerId || body.targetDeviceId;
      const peerName = body.peerName || body.targetName || 'Nearby Peer';

      // Ensure peer user exists in DB
      try {
        const peer = await db.users.findById(userBId);
        if (!peer) {
          await db.users.create({
            id: userBId,
            email: `${userBId.replace(/[^a-zA-Z0-9_-]/g, '')}@auradrop.network`,
            username: userBId,
            displayName: peerName,
            passwordHash: 'auradrop_peer_hash',
          });
        }
      } catch {}

      const conversation = await db.conversations.createDirect(userAId, userBId);
      const members = await db.conversations.getMembers(conversation.id);

      res.statusCode = 200;
      res.end(JSON.stringify({
        success: true,
        conversation: {
          ...conversation,
          members,
        },
      }));
      return;
    }

    // -------------------------------------------------------------------------
    // 6. POST /api/conversations/group (Create group chat)
    // -------------------------------------------------------------------------
    if (pathname === '/api/conversations/group' && req.method === 'POST') {
      const title = body.title || 'Group Chat';
      const creatorId = body.creatorId || userId;
      const memberIds = Array.isArray(body.memberIds) ? body.memberIds : [];
      const avatarUrl = body.avatarUrl || null;

      // Ensure all members exist in Neon DB
      for (const mId of [creatorId, ...memberIds]) {
        try {
          const m = await db.users.findById(mId);
          if (!m) {
            await db.users.create({
              id: mId,
              email: `${mId.replace(/[^a-zA-Z0-9_-]/g, '')}@auradrop.network`,
              username: mId,
              displayName: mId === creatorId ? userName : 'Group Member',
              passwordHash: 'auradrop_member_hash',
            });
          }
        } catch {}
      }

      const conversation = await db.conversations.createGroup(title, creatorId, memberIds, avatarUrl);
      const members = await db.conversations.getMembers(conversation.id);

      res.statusCode = 201;
      res.end(JSON.stringify({
        success: true,
        conversation: {
          ...conversation,
          members,
        },
      }));
      return;
    }

    // -------------------------------------------------------------------------
    // 7. GET /api/conversations (List all user conversations)
    // -------------------------------------------------------------------------
    if (pathname === '/api/conversations' || pathname === '/api/conversations/') {
      if (req.method === 'GET') {
        const conversations = await db.conversations.listForUser(userId);
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, userId, conversations }));
        return;
      }
    }

    // Default 404 for unhandled subpath
    res.statusCode = 404;
    res.end(JSON.stringify({ error: `Endpoint not found: ${req.method} ${pathname}` }));
  } catch (err: any) {
    console.error('[AuraDrop Conversations API Error]', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
  }
}
