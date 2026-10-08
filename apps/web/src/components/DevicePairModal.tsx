import React, { useState } from 'react';
import { PeerDevice } from '../types';

interface DevicePairModalProps {
  isOpen: boolean;
  onClose: () => void;
  localId: string;
  localName: string;
  peers: PeerDevice[];
}

export const DevicePairModal: React.FC<DevicePairModalProps> = ({
  isOpen,
  onClose,
  localId,
  localName,
  peers,
}) => {
  const [isCopied, setIsCopied] = useState(false);

  if (!isOpen) return null;

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const signalingUrl = `${currentOrigin}/api/signaling`;

  const handleCopySignalingUrl = () => {
    navigator.clipboard.writeText(signalingUrl);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2200);
  };

  const handleCopyWebLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2200);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.82)',
        backdropFilter: 'blur(20px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9000,
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0D0D10',
          border: '1px solid #27272A',
          borderRadius: '24px',
          width: '100%',
          maxWidth: '520px',
          padding: '24px',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.95)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>📱</span>
            <h2 style={{ fontSize: '17px', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
              Pair Android Mobile App
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: '#18181B',
              border: '1px solid #27272A',
              borderRadius: '50%',
              width: '30px',
              height: '30px',
              color: '#A1A1AA',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Current Desktop Info */}
        <div style={{ background: '#141418', border: '1px solid #222226', borderRadius: '16px', padding: '14px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '10px', color: '#71717A', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.4px' }}>This Desktop</div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#FFFFFF', marginTop: '2px' }}>{localName}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#34C759', boxShadow: '0 0 8px #34C759' }} />
              <span style={{ fontSize: '11px', color: '#34C759', fontWeight: 700 }}>Online & Ready</span>
            </div>
          </div>
        </div>

        {/* Mobile Connection Instruction */}
        <div style={{ background: '#121216', border: '1px solid #1E1E24', borderRadius: '18px', padding: '16px', marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 800, color: '#FFFFFF', marginBottom: '6px' }}>
            Connect from AuraDrop Android App
          </div>
          <p style={{ fontSize: '12px', color: '#A1A1AA', lineHeight: '1.45', margin: '0 0 12px 0' }}>
            Open AuraDrop on your phone. In Settings or on the Home Screen, tap <strong>Web Sync</strong> and enter or copy this URL. Both devices connect instantly on this screen!
          </p>

          <div
            style={{
              background: '#09090B',
              border: '1px solid #27272A',
              borderRadius: '12px',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              marginBottom: '10px',
            }}
          >
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: '#FFFFFF', wordBreak: 'break-all' }}>
              {signalingUrl}
            </div>
            <button
              onClick={handleCopySignalingUrl}
              style={{
                background: '#FFFFFF',
                border: 'none',
                borderRadius: '8px',
                padding: '6px 14px',
                color: '#000000',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {isCopied ? 'Copied ✓' : 'Copy URL'}
            </button>
          </div>
        </div>

        {/* Discovered Devices List */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#A1A1AA', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Active Devices Nearby ({peers.length})
            </div>
            {peers.length > 0 && (
              <span style={{ fontSize: '11px', color: '#34C759', fontWeight: 700 }}>
                ● {peers.filter((p) => p.platform === 'android').length} Android Phone(s)
              </span>
            )}
          </div>

          {peers.length === 0 ? (
            <div style={{ background: '#141418', border: '1px solid #222226', borderRadius: '14px', padding: '20px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>📡</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF' }}>Listening for Android Phone...</div>
              <div style={{ fontSize: '11px', color: '#71717A', marginTop: '4px' }}>
                Open AuraDrop on your Android device to appear on the 3D Globe automatically.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
              {peers.map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: '#16161A',
                    border: '1px solid #27272A',
                    borderRadius: '14px',
                    padding: '12px 14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: '#27272A',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '15px',
                      }}
                    >
                      {p.platform === 'android' ? '📱' : '💻'}
                    </div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#FFFFFF' }}>{p.name}</div>
                      <div style={{ fontSize: '11px', color: '#A1A1AA' }}>
                        {p.platform === 'android' ? 'Android Mobile App' : p.deviceName}
                      </div>
                    </div>
                  </div>
                  <span style={{ fontSize: '11px', color: '#34C759', fontWeight: 700 }}>● Online</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
