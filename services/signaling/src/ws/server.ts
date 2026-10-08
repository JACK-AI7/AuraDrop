import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { NeonDatabaseService } from '../db/neon.js';
import { RedisRealtimeService } from '../redis/client.js';
import { generateTurnCredentials } from '../turn/credentials.js';
import {
  AuthMessageSchema,
  HeartbeatMessageSchema,
  SignalMessageSchema,
  ChatMessageSchema,
  TransferRequestSchema,
  TransferResponseSchema,
} from '../schemas.js';

interface ClientSession {
  ws: WebSocket;
  deviceId: string;
  displayName: string;
  deviceName: string;
  platform: string;
  visibility: 'everyone' | 'contacts' | 'off';
  localIp?: string;
  localPort?: number;
  lastPing: number;
}

export class WebSocketSignalingServer {
  private wss: WebSocketServer;
  private db: NeonDatabaseService;
  private redis: RedisRealtimeService;
  private sessions = new Map<string, ClientSession>(); // deviceId -> ClientSession

  constructor(wss: WebSocketServer, db: NeonDatabaseService, redis: RedisRealtimeService) {
    this.wss = wss;
    this.db = db;
    this.redis = redis;

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

    // Handle cross-instance messages delivered via Redis Pub/Sub
    this.redis.on('message', (channel: string, message: any) => {
      // Channel format: auradrop:msg:{deviceId}
      const parts = channel.split(':');
      if (parts.length >= 3) {
        const targetDeviceId = parts[2];
        const session = this.sessions.get(targetDeviceId);
        if (session && session.ws.readyState === WebSocket.OPEN) {
          try {
            session.ws.send(JSON.stringify(message));
          } catch {}
        }
      }
    });

    // Heartbeat check interval (every 10s)
    setInterval(() => {
      const now = Date.now();
      for (const [deviceId, session] of this.sessions.entries()) {
        if (now - session.lastPing > 35000) {
          console.log(`[WSServer] Terminating inactive socket for device: ${deviceId}`);
          session.ws.terminate();
          this.handleDisconnect(deviceId);
        } else if (session.ws.readyState === WebSocket.OPEN) {
          try {
            session.ws.ping();
          } catch {}
        }
      }
    }, 10000).unref();
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    let authenticatedDeviceId: string | null = null;

    ws.on('pong', () => {
      if (authenticatedDeviceId) {
        const session = this.sessions.get(authenticatedDeviceId);
        if (session) session.lastPing = Date.now();
      }
    });

    ws.on('message', async (raw) => {
      try {
        const text = raw.toString();
        const data = JSON.parse(text);
        const type = data.type;

        switch (type) {
          // -------------------------------------------------------------------
          // 1. AUTHENTICATE DEVICE
          // -------------------------------------------------------------------
          case 'AUTH': {
            const parsed = AuthMessageSchema.safeParse(data);
            if (!parsed.success) {
              ws.send(JSON.stringify({ type: 'ERROR', code: 'INVALID_AUTH', details: parsed.error.format() }));
              return;
            }

            const auth = parsed.data;
            authenticatedDeviceId = auth.deviceId;

            // Save / refresh in Neon database
            await this.db.upsertDevice({
              deviceId: auth.deviceId,
              displayName: auth.displayName,
              deviceName: auth.deviceName,
              platform: auth.platform,
              appVersion: auth.appVersion,
              avatarUrl: auth.avatarUrl,
            });

            // If client supplied trusted peers, persist any new ones
            if (auth.trustedPeers && Array.isArray(auth.trustedPeers)) {
              for (const peerId of auth.trustedPeers) {
                if (peerId && peerId !== auth.deviceId) {
                  await this.db.createTrustedPair(auth.deviceId, peerId);
                }
              }
            }

            // Register session locally
            this.sessions.set(auth.deviceId, {
              ws,
              deviceId: auth.deviceId,
              displayName: auth.displayName,
              deviceName: auth.deviceName,
              platform: auth.platform,
              visibility: auth.visibility,
              localIp: auth.localIp,
              localPort: auth.localPort,
              lastPing: Date.now(),
            });

            // Publish presence to Redis (TTL = 30s)
            await this.redis.setPresence({
              deviceId: auth.deviceId,
              displayName: auth.displayName,
              deviceName: auth.deviceName,
              platform: auth.platform,
              visibility: auth.visibility,
              localIp: auth.localIp,
              localPort: auth.localPort,
              instanceId: auth.deviceId,
              lastSeen: Date.now(),
            }, 30);

            // Subscribe this instance to receive cross-instance messages for this device
            await this.redis.subscribeDevice(auth.deviceId);

            // Fetch trusted peers from Neon
            const trustedPeerIds = await this.db.getTrustedPeerIds(auth.deviceId);
            const livePresenceMap = await this.redis.getMultiplePresence(trustedPeerIds);

            const trustedPeersWithState = await Promise.all(
              trustedPeerIds.map(async (peerId) => {
                const presence = livePresenceMap[peerId];
                const dbDevice = await this.db.getDevice(peerId);
                return {
                  id: peerId,
                  deviceId: peerId,
                  name: presence?.displayName || dbDevice?.display_name || 'Trusted Device',
                  deviceName: presence?.deviceName || dbDevice?.device_name || 'Trusted Device',
                  platform: presence?.platform || dbDevice?.platform || 'web',
                  isOnline: Boolean(presence),
                  isTrusted: true,
                  connectionState: presence ? 'ONLINE' : 'OFFLINE',
                  localIp: presence?.localIp,
                  localPort: presence?.localPort,
                };
              })
            );

            // Generate short-lived COTURN credentials
            const turnConfig = generateTurnCredentials(auth.deviceId);

            // Acknowledge Auth Success
            ws.send(JSON.stringify({
              type: 'AUTH_SUCCESS',
              deviceId: auth.deviceId,
              trustedPeers: trustedPeersWithState,
              iceServers: turnConfig.iceServers,
              timestamp: Date.now(),
            }));

            // Notify online presence to all trusted peers via Redis Pub/Sub
            const onlineNotif = {
              type: 'PEER_ONLINE',
              peer: {
                id: auth.deviceId,
                deviceId: auth.deviceId,
                name: auth.displayName,
                deviceName: auth.deviceName,
                platform: auth.platform,
                isTrusted: true,
                connectionState: 'ONLINE',
                localIp: auth.localIp,
                localPort: auth.localPort,
              },
            };
            for (const peerId of trustedPeerIds) {
              await this.redis.publishToDevice(peerId, onlineNotif);
            }
            break;
          }

          // -------------------------------------------------------------------
          // 2. HEARTBEAT / PRESENCE RENEWAL
          // -------------------------------------------------------------------
          case 'HEARTBEAT': {
            const parsed = HeartbeatMessageSchema.safeParse(data);
            if (!parsed.success || !authenticatedDeviceId) return;

            const hb = parsed.data;
            const session = this.sessions.get(authenticatedDeviceId);
            if (session) {
              session.lastPing = Date.now();
              session.visibility = hb.visibility;
              if (hb.localIp) session.localIp = hb.localIp;
              if (hb.localPort) session.localPort = hb.localPort;

              await this.redis.setPresence({
                deviceId: session.deviceId,
                displayName: session.displayName,
                deviceName: session.deviceName,
                platform: session.platform,
                visibility: session.visibility,
                localIp: session.localIp,
                localPort: session.localPort,
                instanceId: session.deviceId,
                lastSeen: Date.now(),
              }, 30);
            }

            ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK', timestamp: Date.now() }));
            break;
          }

          // -------------------------------------------------------------------
          // 3. WEBRTC SIGNALING (OFFER, ANSWER, ICE)
          // -------------------------------------------------------------------
          case 'SIGNAL': {
            const parsed = SignalMessageSchema.safeParse(data);
            if (!parsed.success) {
              ws.send(JSON.stringify({ type: 'ERROR', code: 'INVALID_SIGNAL', details: parsed.error.format() }));
              return;
            }

            const sig = parsed.data;
            const signalMsg = {
              type: 'SIGNAL',
              senderId: sig.senderId,
              targetDeviceId: sig.targetDeviceId,
              connectionId: sig.connectionId,
              epoch: sig.epoch,
              signal: sig.signal,
              timestamp: Date.now(),
            };

            const localSession = this.sessions.get(sig.targetDeviceId);
            if (localSession && localSession.ws.readyState === WebSocket.OPEN) {
              try {
                localSession.ws.send(JSON.stringify(signalMsg));
              } catch {}
            } else {
              await this.redis.publishToDevice(sig.targetDeviceId, signalMsg);
            }
            break;
          }

          // -------------------------------------------------------------------
          // 4. TRANSFER REQUEST & RESPONSE (Control Plane only)
          // -------------------------------------------------------------------
          case 'TRANSFER_REQUEST': {
            const parsed = TransferRequestSchema.safeParse(data);
            if (!parsed.success) return;
            await this.redis.publishToDevice(parsed.data.targetDeviceId, parsed.data);
            break;
          }

          case 'TRANSFER_ACCEPT':
          case 'TRANSFER_DECLINE': {
            const parsed = TransferResponseSchema.safeParse(data);
            if (!parsed.success) return;
            await this.redis.publishToDevice(parsed.data.targetDeviceId, parsed.data);
            break;
          }

          // -------------------------------------------------------------------
          // 5. CHAT MESSAGING (Durable Neon storage + Realtime delivery)
          // -------------------------------------------------------------------
          case 'CHAT': {
            const parsed = ChatMessageSchema.safeParse(data);
            if (!parsed.success) return;

            const chat = parsed.data;
            const msgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

            const expiresAt = chat.disappearingSeconds && chat.disappearingSeconds > 0
              ? new Date(Date.now() + chat.disappearingSeconds * 1000)
              : null;

            // Persist to Neon
            await this.db.saveMessage({
              id: msgId,
              conversationId: chat.conversationId,
              senderId: chat.senderId,
              text: chat.text,
              type: chat.messageType,
              replyToId: chat.replyToId,
              expiresAt,
            });

            const chatPayload = {
              type: 'CHAT',
              messageId: msgId,
              conversationId: chat.conversationId,
              senderId: chat.senderId,
              text: chat.text,
              messageType: chat.messageType,
              replyToId: chat.replyToId,
              expiresAt: expiresAt ? expiresAt.toISOString() : null,
              timestamp: Date.now(),
            };

            // Deliver to recipient if direct chat
            if (chat.targetDeviceId) {
              await this.redis.publishToDevice(chat.targetDeviceId, chatPayload);
            }

            // Echo delivery receipt back to sender
            ws.send(JSON.stringify({ type: 'CHAT_SENT', messageId: msgId, timestamp: Date.now() }));
            break;
          }
        }
      } catch (err: any) {
        console.warn('[WSServer] Message parse error:', err.message);
      }
    });

    ws.on('close', () => {
      if (authenticatedDeviceId) {
        this.handleDisconnect(authenticatedDeviceId);
      }
    });

    ws.on('error', (err) => {
      console.warn('[WSServer] Socket error:', err.message);
      if (authenticatedDeviceId) {
        this.handleDisconnect(authenticatedDeviceId);
      }
    });
  }

  private async handleDisconnect(deviceId: string): Promise<void> {
    this.sessions.delete(deviceId);
    await this.redis.removePresence(deviceId);
    await this.redis.unsubscribeDevice(deviceId);

    // Notify trusted peers of OFFLINE status
    try {
      const trustedPeerIds = await this.db.getTrustedPeerIds(deviceId);
      const offlineMsg = {
        type: 'PEER_OFFLINE',
        deviceId,
        timestamp: Date.now(),
      };
      for (const peerId of trustedPeerIds) {
        await this.redis.publishToDevice(peerId, offlineMsg);
      }
    } catch {}
  }
}
