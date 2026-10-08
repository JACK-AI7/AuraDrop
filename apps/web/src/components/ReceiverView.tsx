// AuraDrop Receiver Mode — Dedicated Screen for Receiver Window (Section 27)
import React from 'react';
import { TransferProgress, PeerDevice, VisibilityMode } from '../types';

interface ReceiverViewProps {
  localName: string;
  visibility: VisibilityMode;
  onVisibilityChange: (mode: VisibilityMode) => void;
  peersCount: number;
  transferProgress: TransferProgress | null;
  onAccept: () => void;
  onDecline: () => void;
  onDone: () => void;
  incomingMeta: {
    senderName: string;
    fileName: string;
    fileSize: number;
    sizeFormatted: string;
    isOpen: boolean;
  };
}

export const ReceiverView: React.FC<ReceiverViewProps> = ({
  localName,
  visibility,
  onVisibilityChange,
  peersCount,
  transferProgress,
  onAccept,
  onDecline,
  onDone,
  incomingMeta,
}) => {
  const isTransferring = transferProgress?.state === 'TRANSFERRING' || transferProgress?.state === 'VERIFYING';
  const isCompleted = transferProgress?.state === 'COMPLETED';

  const progressPct =
    transferProgress && transferProgress.fileSize > 0
      ? Math.min(100, Math.round((transferProgress.transferredBytes / transferProgress.fileSize) * 100))
      : 0;

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '520px',
        background: '#121214',
        border: '1px solid #222226',
        borderRadius: '24px',
        padding: '28px',
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.8)',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#34C759', boxShadow: '0 0 8px #34C759' }} />
            <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#FFFFFF' }}>AuraDrop Receiver</h2>
          </div>
          <div style={{ fontSize: '11px', color: '#8E8E93', marginTop: '2px' }}>
            {localName} • Direct P2P Receiver Mode
          </div>
        </div>
        <span
          style={{
            background: '#18181C',
            border: '1px solid #28282E',
            borderRadius: '12px',
            padding: '4px 10px',
            fontSize: '11px',
            fontWeight: 700,
            color: '#FFFFFF',
          }}
        >
          {peersCount} device{peersCount === 1 ? '' : 's'} nearby
        </span>
      </div>

      {/* Visibility Status */}
      <div style={{ background: '#16161A', border: '1px solid #24242A', borderRadius: '16px', padding: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#8E8E93', textTransform: 'uppercase', fontWeight: 700 }}>
              Visible To
            </div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#FFFFFF', marginTop: '2px' }}>
              {visibility === 'everyone' ? 'Everyone Nearby' : visibility === 'contacts' ? 'Contacts Only' : 'Off'}
            </div>
          </div>
          <div style={{ fontSize: '12px', color: '#34C759', fontWeight: 600 }}>
            Listening for transfers
          </div>
        </div>
      </div>

      {/* Incoming Request Card (AirDrop Heads-Up Section) */}
      {incomingMeta.isOpen && !isTransferring && !isCompleted && (
        <div
          style={{
            background: '#18181E',
            border: '1.5px solid #FFFFFF',
            borderRadius: '20px',
            padding: '20px',
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.5)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '46px',
                height: '46px',
                borderRadius: '50%',
                background: '#27272A',
                border: '1px solid #3F3F46',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round">
                <circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="6.8" /><circle cx="12" cy="12" r="10.2" />
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '14px', fontWeight: 800, color: '#FFFFFF' }}>{incomingMeta.senderName}</div>
              <div style={{ fontSize: '12px', color: '#8E8E93', marginTop: '2px' }}>
                wants to send {incomingMeta.fileName} • {incomingMeta.sizeFormatted}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
            <button
              onClick={onDecline}
              style={{
                flex: 1,
                height: '42px',
                borderRadius: '21px',
                border: 'none',
                background: '#3A3A3C',
                color: '#FFFFFF',
                fontSize: '14px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Decline
            </button>
            <button
              onClick={onAccept}
              style={{
                flex: 1,
                height: '42px',
                borderRadius: '21px',
                border: 'none',
                background: '#FFFFFF',
                color: '#000000',
                fontSize: '14px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Accept
            </button>
          </div>
        </div>
      )}

      {/* Active Transfer Stream Progress */}
      {isTransferring && transferProgress && (
        <div style={{ background: '#16161A', border: '1px solid #28282E', borderRadius: '20px', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#FFFFFF' }}>
              Receiving {transferProgress.fileName}...
            </div>
            <span style={{ fontSize: '12px', color: '#34C759', fontWeight: 700 }}>
              {(transferProgress.speedBytesPerSec / (1024 * 1024)).toFixed(1)} MB/s
            </span>
          </div>

          <div style={{ width: '100%', height: '8px', background: '#24242A', borderRadius: '4px', overflow: 'hidden', margin: '14px 0 8px' }}>
            <div
              style={{
                height: '100%',
                width: `${progressPct}%`,
                background: '#34C759',
                transition: 'width 0.1s linear',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#8E8E93' }}>
            <span>
              {(transferProgress.transferredBytes / (1024 * 1024)).toFixed(1)} / {(transferProgress.fileSize / (1024 * 1024)).toFixed(1)} MB ({progressPct}%)
            </span>
            <span>ETA: {transferProgress.etaSeconds > 0 ? `${transferProgress.etaSeconds}s` : 'Finishing...'}</span>
          </div>
        </div>
      )}

      {/* Completed State */}
      {isCompleted && (
        <div style={{ background: '#16161A', border: '1px solid #28282E', borderRadius: '20px', padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '28px', marginBottom: '8px' }}>✅</div>
          <div style={{ fontSize: '15px', fontWeight: 800, color: '#FFFFFF' }}>Transfer Completed!</div>
          <div style={{ fontSize: '12px', color: '#8E8E93', marginTop: '4px' }}>
            SHA-256 verified • File saved to disk
          </div>
          <button
            onClick={onDone}
            style={{
              marginTop: '16px',
              width: '100%',
              height: '42px',
              borderRadius: '21px',
              border: 'none',
              background: '#34C759',
              color: '#FFFFFF',
              fontSize: '14px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      )}

      {/* Waiting Prompt when idle */}
      {!incomingMeta.isOpen && !isTransferring && !isCompleted && (
        <div style={{ textAlign: 'center', padding: '24px 12px', color: '#8E8E93', fontSize: '13px' }}>
          Waiting for incoming files from nearby devices...
        </div>
      )}
    </div>
  );
};
