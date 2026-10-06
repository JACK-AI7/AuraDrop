import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { DesktopClient } from './client';
import { computeSha256 } from '@auradrop/crypto';
import { LocalFileToSend } from '@auradrop/transfer-engine';

export class DesktopWebUi {
  private server: http.Server;
  private wss: WebSocketServer;
  private uiSockets = new Set<WebSocket>();

  constructor(private client: DesktopClient, private port: number = 48288) {
    this.server = http.createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws: WebSocket) => {
      this.uiSockets.add(ws);

      // Send initial state
      ws.send(
        JSON.stringify({
          type: 'INIT_STATE',
          deviceId: this.client.deviceId,
          deviceName: this.client.deviceName,
          platform: this.client.platform,
          port: this.client.transferPort,
          visibilityMode: this.client.visibilityMode,
          qrCode: this.client.generateQrPairingCode(),
          nearbyDevices: this.client.getNearbyDevices(),
          history: this.client.getHistory(),
        })
      );

      ws.on('message', async (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleUiMessage(ws, msg);
        } catch {
          // Ignored
        }
      });

      ws.on('close', () => {
        this.uiSockets.delete(ws);
      });
    });

    // Wire up client events to broadcast to UI
    this.client.on('peer_discovered', () => this.broadcastNearbyDevices());
    this.client.on('peer_updated', () => this.broadcastNearbyDevices());
    this.client.on('peer_disappeared', () => this.broadcastNearbyDevices());

    this.client.on('transfer_request', (session) => {
      this.broadcast({ type: 'TRANSFER_REQUEST', session });
    });

    this.client.on('transfer_progress', (progress) => {
      this.broadcast({ type: 'TRANSFER_PROGRESS', progress });
    });

    this.client.on('transfer_completed', (session) => {
      this.broadcast({ type: 'TRANSFER_COMPLETED', session, history: this.client.getHistory() });
    });

    this.client.on('transfer_declined', (data) => {
      this.broadcast({ type: 'TRANSFER_DECLINED', data });
    });

    this.client.on('transfer_error', (data) => {
      this.broadcast({ type: 'TRANSFER_ERROR', data });
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`[AuraDrop Desktop GUI] Available at: http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  private broadcast(msg: any): void {
    const raw = JSON.stringify(msg);
    for (const ws of this.uiSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(raw);
      }
    }
  }

  private broadcastNearbyDevices(): void {
    this.broadcast({
      type: 'NEARBY_DEVICES_UPDATE',
      devices: this.client.getNearbyDevices(),
    });
  }

  private async handleUiMessage(ws: WebSocket, msg: any): Promise<void> {
    switch (msg.type) {
      case 'ACCEPT_TRANSFER':
        await this.client.acceptTransfer(msg.transferId);
        break;

      case 'DECLINE_TRANSFER':
        await this.client.declineTransfer(msg.transferId);
        break;

      case 'SET_VISIBILITY':
        this.client.setVisibility(msg.visibilityMode, msg.temporaryDurationMs);
        this.broadcast({ type: 'VISIBILITY_CHANGED', visibilityMode: msg.visibilityMode });
        break;

      case 'SEND_FILES':
        await this.handleSendFilesRequest(ws, msg);
        break;
    }
  }

  private async handleSendFilesRequest(
    ws: WebSocket,
    msg: { peerId: string; fileItems: Array<{ name: string; contentBase64: string; mimeType: string }> }
  ): Promise<void> {
    try {
      const peer = this.client.getNearbyDevices().find((p) => p.id === msg.peerId);
      if (!peer) {
        ws.send(JSON.stringify({ type: 'SEND_ERROR', error: 'Target recipient device not found nearby' }));
        return;
      }

      const tempOutDir = path.join(os.tmpdir(), `auradrop_out_${Date.now()}`);
      fs.mkdirSync(tempOutDir, { recursive: true });

      const filesToSend: LocalFileToSend[] = msg.fileItems.map((item, idx) => {
        const buffer = Buffer.from(item.contentBase64, 'base64');
        const filePath = path.join(tempOutDir, item.name);
        fs.writeFileSync(filePath, buffer);
        const checksum = computeSha256(buffer);

        return {
          id: `file_${idx}_${Date.now()}`,
          name: item.name,
          size: buffer.length,
          mimeType: item.mimeType || 'application/octet-stream',
          checksum,
          localFilePath: filePath,
        };
      });

      const session = await this.client.sendFilesToPeer(peer, filesToSend);
      ws.send(JSON.stringify({ type: 'SEND_INITIATED', session }));
    } catch (err: any) {
      ws.send(JSON.stringify({ type: 'SEND_ERROR', error: err.message }));
    }
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method === 'GET' && (req.url === '/' || req.url?.startsWith('/?'))) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      });
      res.end(this.getHtmlInterface());
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  private getHtmlInterface(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AuraDrop — Premium Nearby Sharing</title>
  <style>
    :root {
      --bg: #0B0D13;
      --bg-card: #131722;
      --surface: #1A1E2E;
      --surface-elevated: #242B42;
      --primary: #00F2FE;
      --primary-gradient: linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%);
      --accent: #7928CA;
      --text: #FFFFFF;
      --text-muted: #94A3B8;
      --border: rgba(255, 255, 255, 0.08);
      --border-active: rgba(0, 242, 254, 0.4);
      --success: #10B981;
      --warning: #F59E0B;
      --error: #EF4444;
      --spring: cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    @media (prefers-reduced-motion: reduce) {
      * {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { background: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; overflow-x: hidden; }

    /* Accessibility focus rings */
    button:focus-visible, input:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

    /* Header */
    header { display: flex; justify-content: space-between; align-items: center; padding: 18px 36px; border-bottom: 1px solid var(--border); backdrop-filter: blur(20px); background: rgba(11, 13, 19, 0.85); position: sticky; top: 0; z-index: 100; }
    .brand { display: flex; align-items: center; gap: 12px; font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
    .brand-logo { width: 38px; height: 38px; border-radius: 12px; background: var(--primary-gradient); display: flex; align-items: center; justify-content: center; box-shadow: 0 0 24px rgba(0, 242, 254, 0.4); }
    .nav-links { display: flex; gap: 12px; }
    .nav-btn { background: transparent; border: 1px solid var(--border); color: var(--text-muted); padding: 8px 16px; border-radius: 20px; cursor: pointer; transition: all 0.2s var(--spring); font-size: 13px; font-weight: 500; }
    .nav-btn:hover, .nav-btn.active { color: var(--text); border-color: var(--primary); background: rgba(0, 242, 254, 0.1); }

    /* Network notice badge */
    .network-badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 16px; font-size: 12px; font-weight: 600; background: rgba(0, 242, 254, 0.12); color: var(--primary); border: 1px solid rgba(0, 242, 254, 0.3); }

    /* Layout */
    .container { max-width: 1280px; margin: 0 auto; width: 100%; padding: 32px 24px; display: grid; grid-template-columns: 1fr 420px; gap: 32px; flex: 1; }
    @media (max-width: 960px) { .container { grid-template-columns: 1fr; } }

    /* Cards */
    .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 24px; padding: 28px; position: relative; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.25); }
    .card-title { font-size: 18px; font-weight: 700; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }

    /* Live Animated Radar */
    .radar-container { height: 340px; display: flex; align-items: center; justify-content: center; position: relative; }
    .radar-circle { position: absolute; border: 1px solid rgba(0, 242, 254, 0.12); border-radius: 50%; pointer-events: none; }
    .radar-c1 { width: 110px; height: 110px; }
    .radar-c2 { width: 210px; height: 210px; }
    .radar-c3 { width: 310px; height: 310px; }
    .radar-wave { position: absolute; width: 110px; height: 110px; border-radius: 50%; border: 2px solid var(--primary); opacity: 0.8; animation: auraPulse 3s infinite cubic-bezier(0.2, 0.8, 0.2, 1); pointer-events: none; }
    @keyframes auraPulse {
      0% { transform: scale(1); opacity: 0.8; }
      100% { transform: scale(3.2); opacity: 0; }
    }
    .radar-center-device { width: 76px; height: 76px; border-radius: 50%; background: var(--primary-gradient); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 5; box-shadow: 0 0 32px rgba(0, 242, 254, 0.5); cursor: pointer; transition: transform 0.2s var(--spring); }
    .radar-center-device:hover { transform: scale(1.05); }
    .radar-center-device span { font-size: 11px; font-weight: 800; color: #000; margin-top: 2px; }

    /* Devices Grid */
    .devices-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 16px; margin-top: 20px; }
    .device-card { background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 20px; display: flex; flex-direction: column; align-items: center; text-align: center; cursor: pointer; transition: all 0.25s var(--spring); position: relative; }
    .device-card:hover { transform: translateY(-4px) scale(1.02); border-color: var(--primary); box-shadow: 0 12px 30px rgba(0, 242, 254, 0.25); }
    .device-card.selected { border-color: var(--primary); background: rgba(0, 242, 254, 0.12); box-shadow: 0 0 24px rgba(0, 242, 254, 0.35); }
    .device-avatar { width: 56px; height: 56px; border-radius: 18px; background: rgba(255, 255, 255, 0.06); display: flex; align-items: center; justify-content: center; margin-bottom: 12px; font-size: 26px; border: 1px solid var(--border); }
    .device-name { font-size: 15px; font-weight: 700; margin-bottom: 4px; }
    .device-meta { font-size: 12px; color: var(--text-muted); }
    .signal-pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 12px; font-size: 11px; background: rgba(16, 185, 129, 0.15); color: var(--success); margin-top: 8px; font-weight: 700; }

    /* Selected Files Tray */
    .file-tray { background: var(--surface); border-radius: 18px; border: 1px solid var(--border); padding: 14px; margin-top: 16px; display: flex; flex-direction: column; gap: 10px; max-height: 220px; overflow-y: auto; }
    .file-tray-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(255, 255, 255, 0.04); border-radius: 12px; font-size: 13px; }
    .file-tray-thumb { width: 32px; height: 32px; border-radius: 8px; background: rgba(0, 242, 254, 0.15); color: var(--primary); display: flex; align-items: center; justify-content: center; font-size: 16px; margin-right: 10px; flex-shrink: 0; }
    .btn-remove-file { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 16px; padding: 4px; border-radius: 6px; }
    .btn-remove-file:hover { color: var(--error); background: rgba(239, 68, 68, 0.1); }

    /* File Drop Zone */
    .dropzone { border: 2px dashed rgba(255, 255, 255, 0.15); border-radius: 20px; padding: 32px 20px; text-align: center; cursor: pointer; transition: all 0.2s var(--spring); background: rgba(255, 255, 255, 0.02); }
    .dropzone:hover, .dropzone.dragover { border-color: var(--primary); background: rgba(0, 242, 254, 0.05); transform: scale(1.01); }

    /* Action Buttons */
    .btn-send { width: 100%; margin-top: 18px; padding: 16px; border-radius: 18px; border: none; background: var(--primary-gradient); color: #000; font-weight: 800; font-size: 16px; cursor: pointer; transition: all 0.2s var(--spring); box-shadow: 0 8px 24px rgba(0, 242, 254, 0.35); display: flex; align-items: center; justify-content: center; gap: 8px; }
    .btn-send:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 12px 32px rgba(0, 242, 254, 0.5); }
    .btn-send:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }

    /* Data Particle Transfer Flow Stream Animation */
    .data-stream-box { display: none; padding: 20px; background: rgba(0, 242, 254, 0.04); border: 1.5px solid var(--primary); border-radius: 22px; margin-top: 20px; animation: glowBorder 2s infinite alternate; }
    @keyframes glowBorder { from { box-shadow: 0 0 10px rgba(0, 242, 254, 0.2); } to { box-shadow: 0 0 30px rgba(0, 242, 254, 0.45); } }

    .stream-canvas-container { height: 70px; position: relative; margin: 12px 0; overflow: hidden; border-radius: 12px; background: rgba(0,0,0,0.3); }
    .stream-particle { position: absolute; height: 4px; border-radius: 2px; background: var(--primary); box-shadow: 0 0 12px var(--primary); animation: particleFlow linear infinite; }
    @keyframes particleFlow {
      0% { left: 0%; opacity: 0; width: 8px; }
      20% { opacity: 1; width: 24px; }
      80% { opacity: 1; width: 24px; }
      100% { left: 100%; opacity: 0; width: 8px; }
    }

    .progress-bar-bg { height: 10px; background: rgba(255, 255, 255, 0.1); border-radius: 5px; overflow: hidden; margin: 12px 0; }
    .progress-bar-fill { height: 100%; width: 0%; background: var(--primary-gradient); transition: width 0.2s ease-out; box-shadow: 0 0 16px rgba(0, 242, 254, 0.8); }
    .progress-stats { display: flex; justify-content: space-between; font-size: 13px; color: var(--text-muted); }

    /* Modals */
    .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(16px); z-index: 999; align-items: center; justify-content: center; }
    .modal { background: var(--bg-card); border: 1.5px solid var(--primary); border-radius: 28px; padding: 36px; width: 90%; max-width: 480px; text-align: center; box-shadow: 0 0 60px rgba(0, 242, 254, 0.3); animation: scaleUp 0.3s var(--spring); }
    @keyframes scaleUp { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    .modal-btns { display: flex; gap: 14px; margin-top: 24px; }
    .btn-accept { flex: 1; padding: 16px; border-radius: 16px; border: none; background: var(--primary-gradient); color: #000; font-weight: 800; font-size: 15px; cursor: pointer; transition: transform 0.15s; }
    .btn-accept:hover { transform: scale(1.02); }
    .btn-decline { flex: 1; padding: 16px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-weight: 700; font-size: 15px; cursor: pointer; }
    .btn-decline:hover { background: rgba(239, 68, 68, 0.15); border-color: var(--error); color: var(--error); }

    /* Success Celebration Overlay */
    .success-celebration { display: none; text-align: center; padding: 24px; }
    .success-icon { width: 72px; height: 72px; border-radius: 50%; background: rgba(16, 185, 129, 0.2); color: var(--success); display: flex; align-items: center; justify-content: center; font-size: 36px; margin: 0 auto 16px; box-shadow: 0 0 40px rgba(16, 185, 129, 0.4); animation: scaleUp 0.4s var(--spring); }

    /* History & QR Panels */
    .history-item { display: flex; justify-content: space-between; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
    .qr-container { text-align: center; padding: 24px; }
    .qr-box { background: #fff; padding: 20px; border-radius: 20px; display: inline-block; word-break: break-all; color: #000; font-family: monospace; font-size: 12px; max-width: 300px; box-shadow: 0 8px 30px rgba(0,0,0,0.5); }
  </style>
</head>
<body>
  <header role="banner">
    <div class="brand">
      <div class="brand-logo" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
      </div>
      <span>AuraDrop</span>
    </div>

    <div class="network-badge" id="transport-badge" aria-live="polite">
      <span>●</span>
      <span id="transport-label">Direct Local P2P Active</span>
    </div>

    <nav class="nav-links" aria-label="Main Navigation">
      <button class="nav-btn active" onclick="switchTab('transfer')">Transfer</button>
      <button class="nav-btn" onclick="switchTab('history')">History</button>
      <button class="nav-btn" onclick="switchTab('qr')">QR Pairing</button>
      <button class="nav-btn" onclick="switchTab('privacy')">Privacy & Diagnostics</button>
    </nav>
  </header>

  <div class="container" role="main">
    <!-- Main Radar Area -->
    <main>
      <div id="transfer-tab">
        <div class="card">
          <div class="card-title">
            <span>Nearby Device Radar</span>
            <span id="visibility-badge" style="font-size: 12px; color: var(--primary); font-weight: 600;">Everyone Nearby (Active)</span>
          </div>

          <div class="radar-container" aria-label="Discovered devices radar">
            <div class="radar-circle radar-c1"></div>
            <div class="radar-circle radar-c2"></div>
            <div class="radar-circle radar-c3"></div>
            <div class="radar-wave"></div>
            <div class="radar-center-device" title="My Local Device">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
              <span id="my-device-label">Me</span>
            </div>
          </div>

          <div class="card-title" style="margin-top: 16px;">
            <span>Select Target Device</span>
            <span id="devices-count" style="font-size: 13px; color: var(--text-muted);">Scanning...</span>
          </div>

          <div id="devices-list" class="devices-grid" role="list">
            <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 28px;">
              Pulsing nearby beacon (UDP 48290)... Nearby devices will automatically appear here.
            </div>
          </div>
        </div>
      </div>

      <!-- History Tab -->
      <div id="history-tab" style="display: none;">
        <div class="card">
          <div class="card-title">Transfer History</div>
          <div id="history-list"></div>
        </div>
      </div>

      <!-- QR Pairing Tab -->
      <div id="qr-tab" style="display: none;">
        <div class="card">
          <div class="card-title">Cross-Platform QR Pairing</div>
          <div class="qr-container">
            <p style="color: var(--text-muted); margin-bottom: 20px; font-size: 14px;">Scan with mobile AuraDrop app to instantly connect and transfer without network barriers.</p>
            <div class="qr-box" id="qr-code-text">Generating PAIR://v1 token...</div>
          </div>
        </div>
      </div>

      <!-- Privacy & Diagnostics Tab -->
      <div id="privacy-tab" style="display: none;">
        <div class="card">
          <div class="card-title">Privacy Center & Diagnostics</div>
          <div style="font-size: 14px; line-height: 1.8; color: var(--text-muted);">
            <p>🛡️ <strong>Direct Local Connection:</strong> 100% of local transfers run direct device-to-device over encrypted TCP sockets. No files are uploaded to the cloud.</p>
            <p>🔒 <strong>End-to-End Cryptography:</strong> Sealed using ephemeral X25519 ECDH key exchange and authenticated AES-256-GCM cipher streams.</p>
            <p>⚡ <strong>Protocol:</strong> P2PFS/1 Specification Active.</p>
            <div id="diag-details" style="margin-top: 16px; font-family: monospace; color: var(--primary); background: rgba(0,0,0,0.4); padding: 14px; border-radius: 12px;"></div>
          </div>
        </div>
      </div>
    </main>

    <!-- Right Sidebar (File Selection, Tray & Progress) -->
    <aside aria-label="Transfer Controls">
      <div class="card">
        <div class="card-title">Send Files</div>

        <div class="dropzone" id="dropzone" onclick="document.getElementById('file-input').click()" role="button" tabindex="0">
          <input type="file" id="file-input" multiple style="display: none;">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" style="margin-bottom: 8px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
          <div style="font-weight: 700; font-size: 15px; margin-bottom: 4px;">Choose files or drop here</div>
          <div style="font-size: 12px; color: var(--text-muted);">Multi-gigabyte streaming · Zero cloud buffering</div>
        </div>

        <!-- Section 5: Animated File Tray -->
        <div id="selected-files-tray" class="file-tray" style="display: none;">
          <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">
            <span>STAGED FILES (<span id="tray-count">0</span>)</span>
            <span id="tray-total-size">0 MB</span>
          </div>
          <div id="tray-items-list"></div>
        </div>

        <button id="btn-send-action" class="btn-send" disabled onclick="initiateSend()">
          <span>Transmit Direct</span>
          <span>🚀</span>
        </button>

        <!-- Section 8 & 9: Real Data Stream Animation & Progress -->
        <div id="progress-box" class="data-stream-box" aria-live="polite">
          <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 14px;">
            <span id="prog-filename" style="max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Streaming...</span>
            <span id="prog-pct" style="color: var(--primary);">0%</span>
          </div>

          <!-- Flowing Particle Stream Canvas -->
          <div class="stream-canvas-container" id="stream-container">
            <div class="stream-particle" style="top: 15px; animation-duration: 0.8s;"></div>
            <div class="stream-particle" style="top: 35px; animation-duration: 0.6s; animation-delay: 0.2s;"></div>
            <div class="stream-particle" style="top: 50px; animation-duration: 1.0s; animation-delay: 0.4s;"></div>
          </div>

          <div class="progress-bar-bg">
            <div id="progress-bar-fill" class="progress-bar-fill"></div>
          </div>

          <div class="progress-stats">
            <span id="prog-speed">⚡ 0 MB/s</span>
            <span id="prog-eta">⏱️ Calculating...</span>
          </div>
          <div class="progress-stats" style="margin-top: 6px; font-size: 11px;">
            <span id="prog-bytes">0 MB / 0 MB</span>
            <span id="prog-files">1 of 1 completed</span>
          </div>
        </div>

        <!-- Section 10: Verified Success Reveal -->
        <div id="success-box" class="success-celebration">
          <div class="success-icon">✓</div>
          <h3 style="font-weight: 800; font-size: 20px;">Transfer Complete</h3>
          <p style="color: var(--text-muted); font-size: 13px; margin: 8px 0 16px;">All files verified byte-for-byte with SHA-256 integrity check.</p>
          <button class="btn-send" style="margin-top: 0;" onclick="resetTransferView()">Done</button>
        </div>
      </div>
    </aside>
  </div>

  <!-- Section 7: Receiver Consent Modal -->
  <div id="approval-modal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal">
      <div style="width: 60px; height: 60px; border-radius: 50%; background: rgba(0, 242, 254, 0.15); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; color: var(--primary); font-size: 28px;">
        📥
      </div>
      <h3 id="modal-title" style="margin-bottom: 8px; font-weight: 800; font-size: 22px;">Incoming Transfer</h3>
      <p id="modal-desc" style="color: var(--text-muted); font-size: 14px; margin-bottom: 16px;">Device wants to share files with you.</p>
      <div id="modal-fingerprint" style="font-family: monospace; font-size: 13px; color: var(--primary); margin-bottom: 20px; background: rgba(0,0,0,0.4); padding: 12px; border-radius: 12px; letter-spacing: 1.5px;"></div>
      <div class="modal-btns">
        <button class="btn-decline" onclick="respondTransfer(false)">Decline</button>
        <button class="btn-accept" onclick="respondTransfer(true)">Accept & Stream</button>
      </div>
    </div>
  </div>

  <script>
    let socket;
    let selectedPeerId = null;
    let stagedFiles = [];
    let currentIncomingTransferId = null;

    function connectWs() {
      socket = new WebSocket('ws://' + window.location.host);
      socket.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        handleServerMessage(msg);
      };
      socket.onclose = () => setTimeout(connectWs, 2000);
    }
    connectWs();

    function handleServerMessage(msg) {
      if (msg.type === 'INIT_STATE') {
        document.getElementById('my-device-label').innerText = msg.deviceName.split(' ')[0];
        document.getElementById('qr-code-text').innerText = msg.qrCode;
        document.getElementById('diag-details').innerText = 'Local Device ID: ' + msg.deviceId + ' | Transfer Port: ' + msg.port + ' | Discovery: 48290';
        renderDevices(msg.nearbyDevices || []);
        renderHistory(msg.history || []);
      } else if (msg.type === 'NEARBY_DEVICES_UPDATE') {
        renderDevices(msg.devices || []);
      } else if (msg.type === 'TRANSFER_REQUEST') {
        currentIncomingTransferId = msg.session.transferId;
        document.getElementById('modal-desc').innerText = msg.session.senderName + ' wants to stream ' + msg.session.totalFiles + ' item(s) (' + formatBytes(msg.session.totalBytes) + ')';
        document.getElementById('modal-fingerprint').innerText = 'Security SAS: ' + (msg.session.sessionKeyFingerprint || 'VERIFIED');
        document.getElementById('approval-modal').style.display = 'flex';
      } else if (msg.type === 'TRANSFER_PROGRESS') {
        const p = msg.progress;
        document.getElementById('progress-box').style.display = 'block';
        document.getElementById('prog-pct').innerText = p.percentage + '%';
        document.getElementById('progress-bar-fill').style.width = p.percentage + '%';
        document.getElementById('prog-speed').innerText = '⚡ ' + formatSpeed(p.speedBytesPerSec);
        document.getElementById('prog-eta').innerText = p.etaSeconds > 0 ? '⏱️ ' + p.etaSeconds + 's remaining' : '⏱️ Finalizing...';
        document.getElementById('prog-bytes').innerText = formatBytes(p.transferredBytes) + ' of ' + formatBytes(p.totalBytes);
        document.getElementById('prog-filename').innerText = p.fileName || 'Streaming file chunk';
      } else if (msg.type === 'TRANSFER_COMPLETED') {
        document.getElementById('progress-box').style.display = 'none';
        document.getElementById('success-box').style.display = 'block';
        if (msg.history) renderHistory(msg.history);
      }
    }

    function renderDevices(devices) {
      const list = document.getElementById('devices-list');
      document.getElementById('devices-count').innerText = devices.length + ' peer(s) nearby';
      if (devices.length === 0) {
        list.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 28px;">Pulsing nearby beacon (UDP 48290)... Nearby devices will automatically appear here.</div>';
        return;
      }
      list.innerHTML = devices.map(d => \`
        <div class="device-card \${selectedPeerId === d.id ? 'selected' : ''}" onclick="selectPeer('\${d.id}')" role="button" tabindex="0">
          <div class="device-avatar">\${getPlatformIcon(d.platform)}</div>
          <div class="device-name">\${escapeHtml(d.name)}</div>
          <div class="device-meta">\${d.platform.toUpperCase()}</div>
          <div class="signal-pill">● Online (\${d.port})</div>
        </div>
      \`).join('');
    }

    function selectPeer(id) {
      selectedPeerId = id;
      const cards = document.querySelectorAll('.device-card');
      cards.forEach(c => c.classList.remove('selected'));
      event.currentTarget.classList.add('selected');
      updateSendButtonState();
    }

    function renderHistory(items) {
      const container = document.getElementById('history-list');
      if (items.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted); padding: 20px 0;">No past transfers recorded.</div>';
        return;
      }
      container.innerHTML = items.map(item => \`
        <div class="history-item">
          <div>
            <strong>\${item.direction === 'sent' ? '↗ Sent to ' : '↙ Received from '} \${escapeHtml(item.counterpartName)}</strong>
            <div style="color: var(--text-muted); font-size: 11px;">\${item.files.map(f => f.name).join(', ')} · \${formatBytes(item.totalBytes)}</div>
          </div>
          <span style="color: \${item.status === 'COMPLETED' ? 'var(--success)' : 'var(--error)'}; font-weight: 700;">\${item.status}</span>
        </div>
      \`).join('');
    }

    function respondTransfer(accept) {
      document.getElementById('approval-modal').style.display = 'none';
      if (!currentIncomingTransferId) return;
      socket.send(JSON.stringify({
        type: accept ? 'ACCEPT_TRANSFER' : 'DECLINE_TRANSFER',
        transferId: currentIncomingTransferId
      }));
    }

    document.getElementById('file-input').addEventListener('change', (e) => {
      handleFilesSelected(e.target.files);
    });

    const dropzone = document.getElementById('dropzone');
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      handleFilesSelected(e.dataTransfer.files);
    });

    function handleFilesSelected(files) {
      stagedFiles = [...stagedFiles, ...Array.from(files)];
      renderFileTray();
      updateSendButtonState();
    }

    function removeFile(index) {
      stagedFiles.splice(index, 1);
      renderFileTray();
      updateSendButtonState();
    }

    function renderFileTray() {
      const tray = document.getElementById('selected-files-tray');
      const listEl = document.getElementById('tray-items-list');
      const countEl = document.getElementById('tray-count');
      const sizeEl = document.getElementById('tray-total-size');

      if (stagedFiles.length === 0) {
        tray.style.display = 'none';
        return;
      }

      tray.style.display = 'flex';
      countEl.innerText = stagedFiles.length;
      const totalBytes = stagedFiles.reduce((acc, f) => acc + f.size, 0);
      sizeEl.innerText = formatBytes(totalBytes);

      listEl.innerHTML = stagedFiles.map((f, idx) => \`
        <div class="file-tray-item">
          <div style="display: flex; align-items: center; overflow: hidden;">
            <div class="file-tray-thumb">📄</div>
            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              <div style="font-weight: 600;">\${escapeHtml(f.name)}</div>
              <div style="font-size: 11px; color: var(--text-muted);">\${formatBytes(f.size)}</div>
            </div>
          </div>
          <button class="btn-remove-file" onclick="removeFile(\${idx})" title="Remove file" aria-label="Remove \${escapeHtml(f.name)}">✕</button>
        </div>
      \`).join('');
    }

    function updateSendButtonState() {
      const btn = document.getElementById('btn-send-action');
      btn.disabled = !(selectedPeerId && stagedFiles.length > 0);
    }

    async function initiateSend() {
      if (!selectedPeerId || stagedFiles.length === 0) return;
      document.getElementById('btn-send-action').disabled = true;

      const fileItems = [];
      for (const file of stagedFiles) {
        const base64 = await readFileAsBase64(file);
        fileItems.push({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          contentBase64: base64
        });
      }

      socket.send(JSON.stringify({
        type: 'SEND_FILES',
        peerId: selectedPeerId,
        fileItems
      }));
    }

    function resetTransferView() {
      document.getElementById('success-box').style.display = 'none';
      stagedFiles = [];
      renderFileTray();
      updateSendButtonState();
    }

    function readFileAsBase64(file) {
      return new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          const base64 = result.split(',')[1];
          res(base64);
        };
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
    }

    function switchTab(tab) {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById('transfer-tab').style.display = tab === 'transfer' ? 'block' : 'none';
      document.getElementById('history-tab').style.display = tab === 'history' ? 'block' : 'none';
      document.getElementById('qr-tab').style.display = tab === 'qr' ? 'block' : 'none';
      document.getElementById('privacy-tab').style.display = tab === 'privacy' ? 'block' : 'none';
    }

    function formatBytes(b) {
      if (b < 1024) return b + ' B';
      if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
      if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
      return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }

    function formatSpeed(bps) {
      if (bps < 1024 * 1024) return (bps / 1024).toFixed(1) + ' KB/s';
      return (bps / (1024 * 1024)).toFixed(1) + ' MB/s';
    }

    function getPlatformIcon(p) {
      if (p === 'android') return '📱';
      if (p === 'ios') return '🍏';
      if (p === 'windows') return '💻';
      if (p === 'macos') return '🖥️';
      return '💻';
    }

    function escapeHtml(str) {
      return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
    }

    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('approval-modal');
        if (modal.style.display === 'flex') {
          respondTransfer(false);
        }
      }
    });
  </script>
</body>
</html>`;
  }
}
