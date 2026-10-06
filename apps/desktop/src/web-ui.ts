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

  private async handleSendFilesRequest(ws: WebSocket, msg: { peerId: string; fileItems: Array<{ name: string; contentBase64: string; mimeType: string }> }): Promise<void> {
    try {
      const peer = this.client.getNearbyDevices().find((p) => p.id === msg.peerId);
      if (!peer) {
        ws.send(JSON.stringify({ type: 'SEND_ERROR', error: 'Target recipient device not found nearby' }));
        return;
      }

      // Write files to temporary outgoing spool directory
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
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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
  <title>AuraDrop — Next-Gen Peer-to-Peer File Sharing</title>
  <style>
    :root {
      --bg: #0B0D13;
      --bg-card: #131722;
      --surface: #1A1E2E;
      --primary: #00F2FE;
      --primary-gradient: linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%);
      --accent: #7928CA;
      --text: #FFFFFF;
      --text-muted: #94A3B8;
      --border: rgba(255, 255, 255, 0.08);
      --success: #10B981;
      --warning: #F59E0B;
      --error: #EF4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { background: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; overflow-x: hidden; }

    /* Header */
    header { display: flex; justify-content: space-between; align-items: center; padding: 20px 36px; border-bottom: 1px solid var(--border); backdrop-filter: blur(20px); background: rgba(11, 13, 19, 0.8); position: sticky; top: 0; z-index: 100; }
    .brand { display: flex; align-items: center; gap: 12px; font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
    .brand-logo { width: 36px; height: 36px; border-radius: 10px; background: var(--primary-gradient); display: flex; align-items: center; justify-content: center; box-shadow: 0 0 20px rgba(0, 242, 254, 0.4); }
    .nav-links { display: flex; gap: 16px; }
    .nav-btn { background: transparent; border: 1px solid var(--border); color: var(--text-muted); padding: 8px 16px; border-radius: 20px; cursor: pointer; transition: 0.2s; font-size: 13px; font-weight: 500; }
    .nav-btn:hover, .nav-btn.active { color: var(--text); border-color: var(--primary); background: rgba(0, 242, 254, 0.1); }

    /* Layout */
    .container { max-width: 1200px; margin: 0 auto; width: 100%; padding: 36px 24px; display: grid; grid-template-columns: 1fr 380px; gap: 32px; flex: 1; }
    @media (max-width: 900px) { .container { grid-template-columns: 1fr; } }

    /* Card */
    .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 24px; padding: 28px; position: relative; overflow: hidden; }
    .card-title { font-size: 18px; font-weight: 700; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }

    /* Aura Radar */
    .radar-container { height: 320px; display: flex; align-items: center; justify-content: center; position: relative; }
    .radar-circle { position: absolute; border: 1px solid rgba(0, 242, 254, 0.15); border-radius: 50%; pointer-events: none; }
    .radar-c1 { width: 100px; height: 100px; }
    .radar-c2 { width: 190px; height: 190px; }
    .radar-c3 { width: 280px; height: 280px; }
    .radar-wave { position: absolute; width: 100px; height: 100px; border-radius: 50%; border: 2px solid var(--primary); opacity: 0.8; animation: pulse 3s infinite cubic-bezier(0.2, 0.8, 0.2, 1); pointer-events: none; }
    @keyframes pulse {
      0% { transform: scale(1); opacity: 0.8; }
      100% { transform: scale(3.2); opacity: 0; }
    }
    .radar-center-device { width: 72px; height: 72px; border-radius: 50%; background: var(--primary-gradient); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 5; box-shadow: 0 0 30px rgba(0, 242, 254, 0.5); cursor: pointer; }
    .radar-center-device span { font-size: 10px; font-weight: 700; color: #000; margin-top: 2px; }

    /* Nearby Devices Grid */
    .devices-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; margin-top: 20px; }
    .device-card { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; padding: 18px; display: flex; flex-direction: column; align-items: center; text-align: center; cursor: pointer; transition: all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1); position: relative; }
    .device-card:hover { transform: translateY(-4px); border-color: var(--primary); box-shadow: 0 8px 24px rgba(0, 242, 254, 0.2); }
    .device-card.selected { border-color: var(--primary); background: rgba(0, 242, 254, 0.1); }
    .device-avatar { width: 52px; height: 52px; border-radius: 16px; background: rgba(255, 255, 255, 0.06); display: flex; align-items: center; justify-content: center; margin-bottom: 12px; font-size: 24px; border: 1px solid var(--border); }
    .device-name { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
    .device-meta { font-size: 12px; color: var(--text-muted); }
    .signal-pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 12px; font-size: 11px; background: rgba(16, 185, 129, 0.15); color: var(--success); margin-top: 8px; font-weight: 600; }

    /* File Drop Zone */
    .dropzone { border: 2px dashed rgba(255, 255, 255, 0.15); border-radius: 20px; padding: 36px 20px; text-align: center; cursor: pointer; transition: 0.2s; background: rgba(255, 255, 255, 0.02); }
    .dropzone:hover, .dropzone.dragover { border-color: var(--primary); background: rgba(0, 242, 254, 0.05); }
    .btn-send { width: 100%; margin-top: 20px; padding: 14px; border-radius: 16px; border: none; background: var(--primary-gradient); color: #000; font-weight: 700; font-size: 15px; cursor: pointer; transition: 0.2s; box-shadow: 0 4px 16px rgba(0, 242, 254, 0.3); }
    .btn-send:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }

    /* Transfer Progress Overlay / Card */
    .progress-box { display: none; background: rgba(0, 242, 254, 0.05); border: 1px solid var(--primary); border-radius: 18px; padding: 20px; margin-top: 20px; }
    .progress-bar-bg { height: 8px; background: rgba(255, 255, 255, 0.1); border-radius: 4px; overflow: hidden; margin: 12px 0; }
    .progress-bar-fill { height: 100%; width: 0%; background: var(--primary-gradient); transition: width 0.2s ease-out; }
    .progress-stats { display: flex; justify-content: space-between; font-size: 13px; color: var(--text-muted); }

    /* Modal for Incoming Approval */
    .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.75); backdrop-filter: blur(12px); z-index: 999; align-items: center; justify-content: center; }
    .modal { background: var(--bg-card); border: 1px solid var(--primary); border-radius: 24px; padding: 32px; width: 90%; max-width: 440px; text-align: center; box-shadow: 0 0 50px rgba(0, 242, 254, 0.25); animation: scaleUp 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); }
    @keyframes scaleUp { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    .modal-btns { display: flex; gap: 12px; margin-top: 24px; }
    .btn-accept { flex: 1; padding: 14px; border-radius: 14px; border: none; background: var(--primary-gradient); color: #000; font-weight: 700; cursor: pointer; }
    .btn-decline { flex: 1; padding: 14px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-weight: 600; cursor: pointer; }

    /* History & QR Panels */
    .history-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
    .qr-container { text-align: center; padding: 20px; }
    .qr-box { background: #fff; padding: 16px; border-radius: 16px; display: inline-block; word-break: break-all; color: #000; font-family: monospace; font-size: 11px; max-width: 280px; }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-logo">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
      </div>
      <span>AuraDrop</span>
    </div>
    <div class="nav-links">
      <button class="nav-btn active" onclick="switchTab('transfer')">Transfer</button>
      <button class="nav-btn" onclick="switchTab('history')">History</button>
      <button class="nav-btn" onclick="switchTab('qr')">QR Pairing</button>
      <button class="nav-btn" onclick="switchTab('privacy')">Privacy & Diagnostics</button>
    </div>
  </header>

  <div class="container">
    <!-- Main Left Area -->
    <main>
      <div id="transfer-tab">
        <div class="card">
          <div class="card-title">
            <span>Nearby Device Radar</span>
            <span id="visibility-badge" style="font-size: 12px; color: var(--primary); font-weight: 500;">Discoverable to Everyone</span>
          </div>

          <div class="radar-container">
            <div class="radar-circle radar-c1"></div>
            <div class="radar-circle radar-c2"></div>
            <div class="radar-circle radar-c3"></div>
            <div class="radar-wave"></div>
            <div class="radar-center-device" title="My Local Device">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
              <span id="my-device-label">Me</span>
            </div>
          </div>

          <div class="card-title" style="margin-top: 16px;">
            <span>Select Recipient</span>
            <span id="devices-count" style="font-size: 12px; color: var(--text-muted);">0 found</span>
          </div>
          <div id="devices-list" class="devices-grid">
            <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 24px;">
              Pulsing nearby beacon... Waiting for nearby AuraDrop devices to appear.
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
            <p style="color: var(--text-muted); margin-bottom: 16px; font-size: 14px;">Scan with mobile AuraDrop app to instantly connect and transfer without network barriers.</p>
            <div class="qr-box" id="qr-code-text">Generating PAIR://v1 token...</div>
          </div>
        </div>
      </div>

      <!-- Privacy & Diagnostics Tab -->
      <div id="privacy-tab" style="display: none;">
        <div class="card">
          <div class="card-title">Privacy Center & Protocol Diagnostics</div>
          <div style="font-size: 14px; line-height: 1.8; color: var(--text-muted);">
            <p>🛡️ <strong>Direct Local Connection:</strong> 100% of local transfers run direct device-to-device over encrypted TCP sockets. No files are uploaded to the cloud.</p>
            <p>🔒 <strong>End-to-End Encryption:</strong> Every transfer is sealed using ephemeral X25519 ECDH key exchange and authenticated AES-256-GCM cipher streams.</p>
            <p>⚡ <strong>Protocol:</strong> P2PFS/1 Specification Active.</p>
            <p id="diag-details" style="margin-top: 12px; font-family: monospace; color: var(--primary);"></p>
          </div>
        </div>
      </div>
    </main>

    <!-- Right Sidebar (File Selection & Progress) -->
    <aside>
      <div class="card">
        <div class="card-title">Send Files</div>
        <div class="dropzone" id="dropzone" onclick="document.getElementById('file-input').click()">
          <input type="file" id="file-input" multiple style="display: none;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" style="margin-bottom: 8px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
          <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">Choose files or drop here</div>
          <div style="font-size: 12px; color: var(--text-muted);">Unlimited size · Chunked streaming</div>
        </div>

        <div id="selected-files-list" style="margin-top: 16px; font-size: 13px;"></div>

        <button id="btn-send-action" class="btn-send" disabled onclick="initiateSend()">Send to Selected Peer</button>

        <div id="progress-box" class="progress-box">
          <div style="display: flex; justify-content: space-between; font-weight: 600; font-size: 14px;">
            <span id="prog-filename">Streaming...</span>
            <span id="prog-pct" style="color: var(--primary);">0%</span>
          </div>
          <div class="progress-bar-bg">
            <div id="progress-bar-fill" class="progress-bar-fill"></div>
          </div>
          <div class="progress-stats">
            <span id="prog-speed">0 MB/s</span>
            <span id="prog-eta">Calculating...</span>
          </div>
        </div>
      </div>
    </aside>
  </div>

  <!-- Receiver Approval Modal -->
  <div id="approval-modal" class="modal-overlay">
    <div class="modal">
      <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(0, 242, 254, 0.15); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; color: var(--primary);">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
      </div>
      <h3 style="margin-bottom: 8px;">Incoming Transfer</h3>
      <p id="modal-desc" style="color: var(--text-muted); font-size: 14px; margin-bottom: 16px;">Device wants to share files with you.</p>
      <div id="modal-fingerprint" style="font-family: monospace; font-size: 12px; color: var(--primary); margin-bottom: 16px; background: rgba(255,255,255,0.05); padding: 8px; border-radius: 8px;"></div>
      <div class="modal-btns">
        <button class="btn-decline" onclick="respondTransfer(false)">Decline</button>
        <button class="btn-accept" onclick="respondTransfer(true)">Accept & Save</button>
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
        document.getElementById('diag-details').innerText = 'Local Device ID: ' + msg.deviceId + ' | Transfer Port: ' + msg.port;
        renderDevices(msg.nearbyDevices || []);
        renderHistory(msg.history || []);
      } else if (msg.type === 'NEARBY_DEVICES_UPDATE') {
        renderDevices(msg.devices || []);
      } else if (msg.type === 'TRANSFER_REQUEST') {
        currentIncomingTransferId = msg.session.transferId;
        document.getElementById('modal-desc').innerText = msg.session.senderName + ' wants to send ' + msg.session.totalFiles + ' file(s) (' + formatBytes(msg.session.totalBytes) + ')';
        document.getElementById('modal-fingerprint').innerText = 'Security SAS: ' + (msg.session.sessionKeyFingerprint || 'VERIFIED');
        document.getElementById('approval-modal').style.display = 'flex';
      } else if (msg.type === 'TRANSFER_PROGRESS') {
        const p = msg.progress;
        document.getElementById('progress-box').style.display = 'block';
        document.getElementById('prog-pct').innerText = p.percentage + '%';
        document.getElementById('progress-bar-fill').style.width = p.percentage + '%';
        document.getElementById('prog-speed').innerText = formatSpeed(p.speedBytesPerSec);
        document.getElementById('prog-eta').innerText = p.etaSeconds > 0 ? p.etaSeconds + 's remaining' : 'Transferring...';
      } else if (msg.type === 'TRANSFER_COMPLETED') {
        document.getElementById('progress-box').style.display = 'block';
        document.getElementById('prog-pct').innerText = '✓ Complete';
        document.getElementById('progress-bar-fill').style.width = '100%';
        if (msg.history) renderHistory(msg.history);
      }
    }

    function renderDevices(devices) {
      const list = document.getElementById('devices-list');
      document.getElementById('devices-count').innerText = devices.length + ' nearby';
      if (devices.length === 0) {
        list.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 24px;">Pulsing nearby beacon... Waiting for devices to appear.</div>';
        return;
      }
      list.innerHTML = devices.map(d => \`
        <div class="device-card \${selectedPeerId === d.id ? 'selected' : ''}" onclick="selectPeer('\${d.id}')">
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
        container.innerHTML = '<div style="color: var(--text-muted); padding: 16px 0;">No transfers yet.</div>';
        return;
      }
      container.innerHTML = items.map(item => \`
        <div class="history-item">
          <div>
            <strong>\${item.direction === 'sent' ? '↗ Sent to ' : '↙ Received from '} \${escapeHtml(item.counterpartName)}</strong>
            <div style="color: var(--text-muted); font-size: 11px;">\${item.files.map(f => f.name).join(', ')} · \${formatBytes(item.totalBytes)}</div>
          </div>
          <span style="color: \${item.status === 'COMPLETED' ? 'var(--success)' : 'var(--error)'}; font-weight: 600;">\${item.status}</span>
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

    // File input handling
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
      stagedFiles = Array.from(files);
      const listEl = document.getElementById('selected-files-list');
      listEl.innerHTML = stagedFiles.map(f => \`<div>📄 \${escapeHtml(f.name)} (\${formatBytes(f.size)})</div>\`).join('');
      updateSendButtonState();
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
  </script>
</body>
</html>`;
  }
}
