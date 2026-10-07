import React, { useState } from 'react';
import { PeerDevice } from '../types';

interface DevicePairModalProps {
  isOpen: boolean;
  onClose: () => void;
  localId: string;
  localName: string;
  peers: PeerDevice[];
  onOpenTestWindow: () => void;
}

export const DevicePairModal: React.FC<DevicePairModalProps> = ({
  isOpen,
  onClose,
  localId,
  localName,
  peers,
  onOpenTestWindow,
}) => {
  const [connectCode, setConnectCode] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(16px)',
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
          background: '#121214',
          border: '1px solid #242428',
          borderRadius: '24px',
          width: '100%',
          maxWidth: '500px',
          padding: '24px',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 800, color: '#FFFFFF' }}>Real Device Pairing & Discovery</h2>
          <button
            onClick={onClose}
            style={{
              background: '#1C1C20',
              border: '1px solid #2C2C32',
              borderRadius: '50%',
              width: '28px',
              height: '28px',
              color: '#8E8E93',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Current Device Info */}
        <div style={{ background: '#16161A', border: '1px solid #222226', borderRadius: '16px', padding: '14px', marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', color: '#8E8E93', textTransform: 'uppercase', fontWeight: 700 }}>This Device</div>
          <div style={{ fontSize: '15px', fontWeight: 800, color: '#FFFFFF', marginTop: '4px' }}>{localName}</div>
          <div style={{ fontSize: '11px', color: '#34C759', marginTop: '2px' }}>● Ready to discover nearby devices via zero-cloud P2P</div>
        </div>

        {/* Instant Multi-Tab / Second Window Test */}
        <div style={{ background: '#101014', border: '1px solid #1F1F24', borderRadius: '16px', padding: '16px', marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 800, color: '#FFFFFF', marginBottom: '4px' }}>
            Instant Two-Device Test
          </div>
          <p style={{ fontSize: '12px', color: '#8E8E93', lineHeight: '1.4', marginBottom: '12px' }}>
            Open a second AuraDrop window side-by-side. Both windows will detect each other immediately on the 3D Globe, allowing you to test real sending, the popping AirDrop card, and real file downloads!
          </p>
          <button
            onClick={onOpenTestWindow}
            style={{
              width: '100%',
              background: '#0A84FF',
              border: 'none',
              borderRadius: '14px',
              padding: '11px',
              color: '#FFFFFF',
              fontSize: '13px',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <span>Open Receiver Window (Side-by-Side Test)</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
        </div>

        {/* Discovered Peers List */}
        <div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#8E8E93', marginBottom: '8px' }}>
            Currently Discovered Peers ({peers.length})
          </div>
          {peers.length === 0 ? (
            <div style={{ fontSize: '12px', color: '#636366', padding: '10px 0', textAlign: 'center' }}>
              No other device detected yet. Open another tab or phone on the same network to connect.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {peers.map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: '#16161A',
                    border: '1px solid #242428',
                    borderRadius: '12px',
                    padding: '10px 14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF' }}>{p.name}</div>
                    <div style={{ fontSize: '10px', color: '#8E8E93' }}>{p.deviceName}</div>
                  </div>
                  <span style={{ fontSize: '11px', color: '#34C759', fontWeight: 700 }}>● Connected</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
