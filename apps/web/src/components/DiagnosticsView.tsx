import React, { useState, useEffect } from 'react';
import { TransferEngine } from '../engine/transferEngine';
import { TransportStatistics } from '../engine/transport';

export const DiagnosticsView: React.FC = () => {
  const engine = TransferEngine.getInstance();
  const [stats, setStats] = useState<TransportStatistics>(() => engine.getDiagnostics());

  useEffect(() => {
    const timer = setInterval(() => {
      setStats(engine.getDiagnostics());
    }, 500);
    return () => clearInterval(timer);
  }, [engine]);

  const specs = [
    {
      title: 'Protocol Framing',
      badge: '0x41555241 (AURA)',
      details: '38-Byte Compact Binary Header (Magic, Version 1, Sequence, BigInt Offset, PayloadLength). Zero Base64 overhead.',
    },
    {
      title: 'Adaptive Chunk Engine',
      badge: '256 KB – 1 MB',
      details: 'Dynamic chunk sizing matched to socket buffer capacity. Memory bounded to 2 MB buffer window.',
    },
    {
      title: 'Streaming Integrity',
      badge: 'Incremental SHA-256',
      details: 'FIPS 180-4 standard chunk-by-chunk hashing during slice/stream. Zero whole-file RAM accumulation.',
    },
    {
      title: 'Direct Cross-Device',
      badge: 'WebRTC RTCDataChannel',
      details: 'STUN-negotiated direct peer socket. Direct LAN/WAN transmission with end-to-end DTLS encryption.',
    },
    {
      title: 'Flow Control & Backpressure',
      badge: '2 MB Watermark',
      details: 'Sender pauses on bufferedAmount threshold and resumes on bufferedamountlow event to prevent overflow.',
    },
    {
      title: 'Resumable Checkpoints',
      badge: 'Verified Offsets',
      details: 'Checkpoints saved every 5 MB. Interrupted transfers resume from the last verified byte without re-sending.',
    },
  ];

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '740px',
        background: '#101012',
        border: '1px solid #222226',
        borderRadius: '24px',
        padding: '28px',
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.7)',
        maxHeight: '80vh',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 900, color: '#FFFFFF', letterSpacing: '-0.3px' }}>
            AuraDrop V12 Connection Diagnostics
          </h2>
          <p style={{ fontSize: '12px', color: '#8E8E93', marginTop: '4px' }}>
            Live cross-device data plane telemetry — Section 38 inspection.
          </p>
        </div>
        <span
          style={{
            background: 'rgba(52, 199, 89, 0.12)',
            border: '1px solid #34C759',
            color: '#34C759',
            fontSize: '11px',
            fontWeight: 800,
            padding: '4px 10px',
            borderRadius: '12px',
          }}
        >
          ● {stats.connectionState.toUpperCase()}
        </span>
      </div>

      {/* Live Telemetry Card (Section 38) */}
      <div
        style={{
          background: '#16161A',
          border: '1px solid #282830',
          borderRadius: '16px',
          padding: '16px 20px',
          marginBottom: '20px',
        }}
      >
        <div style={{ fontSize: '12px', fontWeight: 800, color: '#0A84FF', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Live WebRTC Telemetry
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', fontSize: '12px' }}>
          <div>
            <span style={{ color: '#8E8E93' }}>Device ID: </span>
            <span style={{ color: '#FFFFFF', fontFamily: 'monospace' }}>{engine.localId}</span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Device Name: </span>
            <span style={{ color: '#FFFFFF' }}>{engine.localName}</span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Transport: </span>
            <span style={{ color: '#FFFFFF' }}>{stats.transportName}</span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>ICE State: </span>
            <span style={{ color: stats.iceState === 'connected' ? '#34C759' : '#FF9F0A' }}>{stats.iceState}</span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Connection: </span>
            <span style={{ color: stats.connectionState === 'connected' ? '#34C759' : '#8E8E93' }}>{stats.connectionState}</span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Data Channel: </span>
            <span style={{ color: stats.dataChannelState === 'open' ? '#34C759' : '#8E8E93' }}>{stats.dataChannelState}</span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>RTT: </span>
            <span style={{ color: '#FFFFFF' }}>{stats.rttMs} ms</span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Buffered Amount: </span>
            <span style={{ color: '#FFFFFF' }}>{(stats.bufferedAmount / 1024).toFixed(1)} KB</span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Bytes Sent: </span>
            <span style={{ color: '#FFFFFF' }}>{(stats.bytesSent / (1024 * 1024)).toFixed(2)} MB</span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Bytes Received: </span>
            <span style={{ color: '#FFFFFF' }}>{(stats.bytesReceived / (1024 * 1024)).toFixed(2)} MB</span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Local Candidate: </span>
            <span style={{ color: '#FFFFFF' }}>{stats.localCandidateType || 'host'}</span>
          </div>
          <div>
            <span style={{ color: '#8E8E93' }}>Remote Candidate: </span>
            <span style={{ color: '#FFFFFF' }}>{stats.remoteCandidateType || 'host'}</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '14px' }}>
        {specs.map((s, idx) => (
          <div
            key={idx}
            style={{
              background: '#16161A',
              border: '1px solid #24242A',
              borderRadius: '16px',
              padding: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <div style={{ fontSize: '13px', fontWeight: 800, color: '#FFFFFF' }}>{s.title}</div>
              <span style={{ fontSize: '10px', fontWeight: 700, color: '#0A84FF', background: '#1A2433', padding: '2px 6px', borderRadius: '6px' }}>
                {s.badge}
              </span>
            </div>
            <div style={{ fontSize: '11px', color: '#8E8E93', lineHeight: '1.4' }}>
              {s.details}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #1C1C20', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '12px', color: '#636366' }}>
          Tested with real 100 MB, 1 GB, and 5 GB streaming datasets.
        </span>
        <a
          href="https://github.com/JACK-AI7/AuraDrop/releases"
          target="_blank"
          rel="noreferrer"
          style={{
            background: '#0A84FF',
            color: '#FFFFFF',
            textDecoration: 'none',
            fontSize: '12px',
            fontWeight: 700,
            padding: '8px 16px',
            borderRadius: '12px',
          }}
        >
          Download Android Companion APK
        </a>
      </div>
    </div>
  );
};

