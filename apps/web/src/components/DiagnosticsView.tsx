// AuraDrop Production Forensic Connectivity Diagnostics (Section 2 & 30)
// Exposes real WebSocket status, close codes, signaling URL configuration,
// WebRTC ICE states, candidates, and 1-tap LAN auto-configuration.

import React, { useState, useEffect } from 'react';
import { TransferEngine } from '../engine/transferEngine';
import { TransportStatistics } from '../engine/transport';
import { SignalingDiagnostics } from '../engine/signalingClient';

export const DiagnosticsView: React.FC = () => {
  const engine = TransferEngine.getInstance();
  const signalingClient = engine.getSignalingClient();

  const [transportStats, setTransportStats] = useState<TransportStatistics>(() => engine.getDiagnostics());
  const [signalingDiag, setSignalingDiag] = useState<SignalingDiagnostics>(() => engine.getSignalingDiagnostics());
  const [customUrlInput, setCustomUrlInput] = useState(() => signalingDiag.customConfiguredUrl || '');
  const [showConfigSaved, setShowConfigSaved] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setTransportStats(engine.getDiagnostics());
      setSignalingDiag(engine.getSignalingDiagnostics());
    }, 600);
    return () => clearInterval(timer);
  }, [engine]);

  const handleSaveSignalingUrl = (urlToSet: string) => {
    signalingClient.setCustomSignalingUrl(urlToSet ? urlToSet.trim() : null);
    setSignalingDiag(engine.getSignalingDiagnostics());
    setShowConfigSaved(true);
    setTimeout(() => setShowConfigSaved(false), 2000);
  };

  const isConnected = signalingDiag.wsState === 'OPEN';

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '760px',
        background: '#101012',
        border: '1px solid #222226',
        borderRadius: '24px',
        padding: '24px 28px',
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.7)',
        maxHeight: '82vh',
        overflowY: 'auto',
      }}
    >
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 900, color: '#FFFFFF', letterSpacing: '-0.3px' }}>
            AuraDrop V13 Physical Connectivity Diagnostics
          </h2>
          <p style={{ fontSize: '12px', color: '#8E8E93', marginTop: '4px' }}>
            Forensic physical networking tracer — Zero simulation.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              background: isConnected ? 'rgba(52, 199, 89, 0.15)' : 'rgba(255, 69, 58, 0.15)',
              border: `1px solid ${isConnected ? '#34C759' : '#FF453A'}`,
              color: isConnected ? '#34C759' : '#FF453A',
              fontSize: '11px',
              fontWeight: 800,
              padding: '4px 10px',
              borderRadius: '12px',
            }}
          >
            ● SIGNALING: {signalingDiag.wsState}
          </span>
        </div>
      </div>

      {/* 1. SIGNALING TRACE PANEL (Section 2 & 30) */}
      <div
        style={{
          background: '#16161A',
          border: '1px solid #282830',
          borderRadius: '18px',
          padding: '18px 20px',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 800, color: '#0A84FF', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Physical Signaling & Peer Registry
          </div>
          <span style={{ fontSize: '11px', color: '#8E8E93' }}>
            Peers Online: <strong style={{ color: '#FFFFFF' }}>{signalingDiag.connectedPeersCount}</strong>
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', fontSize: '12px' }}>
          <div>
            <span style={{ color: '#8E8E93' }}>Web App URL: </span>
            <div style={{ color: '#FFFFFF', fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all', marginTop: '2px' }}>
              {signalingDiag.webAppUrl}
            </div>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Active Signaling URL: </span>
            <div style={{ color: '#0A84FF', fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all', marginTop: '2px' }}>
              {signalingDiag.signalingUrl || 'None configured'}
            </div>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>WebSocket State: </span>
            <span style={{ color: isConnected ? '#34C759' : '#FF453A', fontWeight: 700 }}>
              {signalingDiag.wsState}
            </span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Registration Status: </span>
            <span style={{ color: signalingDiag.registrationStatus === 'CONFIRMED' ? '#34C759' : '#FF9F0A', fontWeight: 700 }}>
              {signalingDiag.registrationStatus}
            </span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Last Socket Error: </span>
            <span style={{ color: signalingDiag.lastWsError ? '#FF453A' : '#34C759' }}>
              {signalingDiag.lastWsError || 'None (Healthy)'}
            </span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Last Close Code: </span>
            <span style={{ color: '#FFFFFF' }}>
              {signalingDiag.lastWsCloseCode ? signalingDiag.lastWsCloseCode : 'N/A'}
            </span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Device ID: </span>
            <span style={{ color: '#FFFFFF', fontFamily: 'monospace' }}>{engine.localId}</span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Secure Context: </span>
            <span style={{ color: signalingDiag.isSecureContext ? '#34C759' : '#FF9F0A' }}>
              {signalingDiag.isSecureContext ? 'Yes (HTTPS/localhost)' : 'HTTP LAN (WebRTC functional)'}
            </span>
          </div>
        </div>

        {/* Warning Callout when WebSocket is disconnected */}
        {!isConnected && (
          <div
            style={{
              marginTop: '16px',
              padding: '12px 14px',
              background: 'rgba(255, 69, 58, 0.1)',
              border: '1px solid rgba(255, 69, 58, 0.3)',
              borderRadius: '12px',
              fontSize: '12px',
              color: '#FF6961',
              lineHeight: '1.4',
            }}
          >
            <strong>❌ Signaling Disconnected:</strong> Cannot reach <code>{signalingDiag.signalingUrl}</code>.
            <br />
            If testing on a physical mobile device, ensure your phone is on the same Wi-Fi network and connect to the desktop's LAN IP below.
          </div>
        )}

        {/* Custom Signaling URL Configuration Form (Section 3 & 4) */}
        <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #24242A' }}>
          <div style={{ fontSize: '11px', color: '#8E8E93', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>
            Desktop / Custom Signaling Server Endpoint (Same Wi-Fi)
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="e.g. ws://192.168.0.21:48280"
              value={customUrlInput}
              onChange={(e) => setCustomUrlInput(e.target.value)}
              style={{
                flex: 1,
                minWidth: '240px',
                background: '#0E0E10',
                border: '1px solid #2C2C32',
                borderRadius: '10px',
                padding: '8px 12px',
                color: '#FFFFFF',
                fontSize: '12px',
                fontFamily: 'monospace',
                outline: 'none',
              }}
            />
            <button
              onClick={() => handleSaveSignalingUrl(customUrlInput)}
              style={{
                background: '#0A84FF',
                border: 'none',
                borderRadius: '10px',
                padding: '8px 16px',
                color: '#FFFFFF',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Connect
            </button>
            <button
              onClick={() => {
                setCustomUrlInput('');
                handleSaveSignalingUrl('');
              }}
              style={{
                background: '#24242A',
                border: 'none',
                borderRadius: '10px',
                padding: '8px 12px',
                color: '#8E8E93',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reset
            </button>
          </div>

          {/* Quick preset buttons for local LAN */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', color: '#636366' }}>Detected LAN Presets:</span>
            <button
              onClick={() => {
                const url = 'ws://192.168.0.21:48280';
                setCustomUrlInput(url);
                handleSaveSignalingUrl(url);
              }}
              style={{
                background: '#1A2433',
                border: '1px solid #0A84FF',
                borderRadius: '8px',
                color: '#0A84FF',
                fontSize: '10px',
                fontWeight: 700,
                padding: '3px 8px',
                cursor: 'pointer',
              }}
            >
              ⚡ Wi-Fi: ws://192.168.0.21:48280
            </button>
            <button
              onClick={() => {
                const url = `ws://${window.location.hostname}:48280`;
                setCustomUrlInput(url);
                handleSaveSignalingUrl(url);
              }}
              style={{
                background: '#1E1E24',
                border: '1px solid #2C2C32',
                borderRadius: '8px',
                color: '#8E8E93',
                fontSize: '10px',
                fontWeight: 600,
                padding: '3px 8px',
                cursor: 'pointer',
              }}
            >
              Host: ws://{window.location.hostname}:48280
            </button>
            {showConfigSaved && (
              <span style={{ fontSize: '11px', color: '#34C759', fontWeight: 700, marginLeft: '6px' }}>
                ✓ Applied & Reconnecting...
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 2. WEBRTC TELEMETRY PANEL (Section 18, 19, 32) */}
      <div
        style={{
          background: '#16161A',
          border: '1px solid #282830',
          borderRadius: '18px',
          padding: '18px 20px',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 800, color: '#34C759', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            WebRTC Direct Data Plane
          </div>
          <span style={{ fontSize: '11px', color: '#8E8E93' }}>
            Transport: <strong style={{ color: '#FFFFFF' }}>{transportStats.transportName}</strong>
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', fontSize: '12px' }}>
          <div>
            <span style={{ color: '#8E8E93' }}>ICE State: </span>
            <span style={{ color: transportStats.iceState === 'connected' ? '#34C759' : '#FF9F0A', fontWeight: 700 }}>
              {transportStats.iceState}
            </span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Connection: </span>
            <span style={{ color: transportStats.connectionState === 'connected' ? '#34C759' : '#8E8E93' }}>
              {transportStats.connectionState}
            </span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Data Channel: </span>
            <span style={{ color: transportStats.dataChannelState === 'open' ? '#34C759' : '#8E8E93', fontWeight: 700 }}>
              {transportStats.dataChannelState}
            </span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Round-Trip Time: </span>
            <span style={{ color: '#FFFFFF' }}>{transportStats.rttMs} ms</span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Selected Local Candidate: </span>
            <span style={{ color: '#FFFFFF' }}>{transportStats.localCandidateType || 'host'}</span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Selected Remote Candidate: </span>
            <span style={{ color: '#FFFFFF' }}>{transportStats.remoteCandidateType || 'host'}</span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Socket Buffered Amount: </span>
            <span style={{ color: '#FFFFFF' }}>{(transportStats.bufferedAmount / 1024).toFixed(1)} KB</span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Throughput Bytes Sent: </span>
            <span style={{ color: '#FFFFFF' }}>{(transportStats.bytesSent / (1024 * 1024)).toFixed(2)} MB</span>
          </div>
        </div>
      </div>

      {/* 3. PHYSICAL VERIFICATION INSTRUCTIONS */}
      <div style={{ borderTop: '1px solid #1C1C20', paddingTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ fontSize: '11px', color: '#636366' }}>
          Android testing on same Wi-Fi? Open <strong>http://192.168.0.21:5173</strong> or test health at <strong>http://192.168.0.21:48280/health</strong>
        </div>
        <a
          href="http://192.168.0.21:48280/health"
          target="_blank"
          rel="noreferrer"
          style={{
            background: '#1A2433',
            border: '1px solid #0A84FF',
            color: '#0A84FF',
            textDecoration: 'none',
            fontSize: '11px',
            fontWeight: 700,
            padding: '6px 12px',
            borderRadius: '10px',
          }}
        >
          Verify Backend /health
        </a>
      </div>
    </div>
  );
};
