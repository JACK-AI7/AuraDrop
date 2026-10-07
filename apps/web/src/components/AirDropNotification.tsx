import React, { useState, useEffect } from 'react';
import { TransferProgress } from '../types';

interface AirDropNotificationProps {
  isOpen: boolean;
  senderName: string;
  filesCount: number;
  totalSizeText: string;
  onAccept: () => void;
  onDecline: () => void;
  transferProgress?: TransferProgress | null;
  onDone?: () => void;
}

export const AirDropNotification: React.FC<AirDropNotificationProps> = ({
  isOpen,
  senderName,
  filesCount,
  totalSizeText,
  onAccept,
  onDecline,
  transferProgress,
  onDone,
}) => {
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isAnimatingIn, setIsAnimatingIn] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      requestAnimationFrame(() => {
        setIsAnimatingIn(true);
      });
    } else {
      setIsAnimatingIn(false);
      const timer = setTimeout(() => setIsRendered(false), 360);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isRendered) return null;

  const isTransferring = transferProgress && transferProgress.state === 'transferring';
  const isCompleted = transferProgress && transferProgress.state === 'completed';

  const progressPct = transferProgress && transferProgress.fileSize > 0
    ? Math.min(100, Math.round((transferProgress.transferredBytes / transferProgress.fileSize) * 100))
    : 0;

  return (
    <div
      style={{
        position: 'fixed',
        top: '24px',
        left: '50%',
        transform: `translateX(-50%) translateY(${isAnimatingIn ? '0px' : '-140px'}) scale(${isAnimatingIn ? '1' : '0.92'})`,
        opacity: isAnimatingIn ? 1 : 0,
        transition: 'all 0.42s cubic-bezier(0.16, 1, 0.3, 1)',
        zIndex: 9999,
        width: 'calc(100% - 32px)',
        maxWidth: '430px',
        pointerEvents: 'auto',
      }}
    >
      {/* Glow Aura Shadow for ReactBits effect */}
      <div
        style={{
          position: 'absolute',
          inset: -2,
          background: isTransferring
            ? 'radial-gradient(ellipse at center, rgba(10, 132, 255, 0.35) 0%, transparent 70%)'
            : isCompleted
            ? 'radial-gradient(ellipse at center, rgba(52, 199, 89, 0.35) 0%, transparent 70%)'
            : 'radial-gradient(ellipse at center, rgba(10, 132, 255, 0.22) 0%, transparent 70%)',
          borderRadius: '26px',
          filter: 'blur(14px)',
          zIndex: -1,
          transition: 'all 0.5s ease',
        }}
      />

      <div
        style={{
          background: '#161618',
          border: '1px solid #2C2C2E',
          borderRadius: '22px',
          padding: '18px 20px',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.85), 0 0 1px 1px rgba(255, 255, 255, 0.08)',
          backdropFilter: 'blur(30px)',
        }}
      >
        {/* Header Row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* Concentric Aura Rings Icon */}
          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '50%',
              background: isCompleted ? '#34C759' : '#0A84FF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: isCompleted
                ? '0 0 16px rgba(52, 199, 89, 0.5)'
                : '0 0 16px rgba(10, 132, 255, 0.5)',
              transition: 'background 0.3s ease',
            }}
          >
            {isCompleted ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round">
                <circle cx="12" cy="12" r="3" />
                <circle cx="12" cy="12" r="6.8" />
                <circle cx="12" cy="12" r="10.2" />
              </svg>
            )}
          </div>

          {/* Details */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '15px', fontWeight: 800, color: '#FFFFFF', letterSpacing: '-0.3px' }}>
              AuraDrop
            </div>
            <div
              style={{
                fontSize: '13px',
                color: '#8E8E93',
                marginTop: '2px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {isTransferring
                ? `Receiving from ${senderName} • ${(transferProgress?.speedBytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
                : isCompleted
                ? `Received ${filesCount} file(s) from ${senderName}`
                : `${senderName} would like to share ${filesCount} photo${filesCount > 1 ? 's' : ''} • ${totalSizeText}`}
            </div>
          </div>

          {/* Thumbnail preview */}
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: '#252528',
              border: '1px solid #333336',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              overflow: 'hidden',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8E8E93" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
        </div>

        {/* Live Transfer Progress State */}
        {isTransferring && (
          <div style={{ marginTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#8E8E93', marginBottom: '8px', fontWeight: 600 }}>
              <span style={{ color: '#FFFFFF' }}>{progressPct}%</span>
              <span>{((transferProgress.transferredBytes) / (1024 * 1024)).toFixed(1)} / {((transferProgress.fileSize) / (1024 * 1024)).toFixed(1)} MB</span>
            </div>
            <div style={{ width: '100%', height: '6px', background: '#2C2C2E', borderRadius: '3px', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${progressPct}%`,
                  background: '#0A84FF',
                  borderRadius: '3px',
                  transition: 'width 0.15s ease',
                  boxShadow: '0 0 10px rgba(10, 132, 255, 0.8)',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#636366', marginTop: '6px' }}>
              <span>Single-Pass SHA-256 Verified</span>
              <span>Direct TCP Framing</span>
            </div>
          </div>
        )}

        {/* Completed State Button */}
        {isCompleted ? (
          <div style={{ marginTop: '16px' }}>
            <button
              onClick={onDone}
              style={{
                width: '100%',
                height: '44px',
                borderRadius: '22px',
                border: 'none',
                background: '#34C759',
                color: '#FFFFFF',
                fontSize: '15px',
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              Done
            </button>
          </div>
        ) : !isTransferring ? (
          /* Action Buttons: Decline & Accept */
          <div style={{ display: 'flex', gap: '12px', marginTop: '18px' }}>
            <button
              onClick={onDecline}
              style={{
                flex: 1,
                height: '44px',
                borderRadius: '22px',
                border: 'none',
                background: '#3A3A3C',
                color: '#FFFFFF',
                fontSize: '15px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'background 0.2s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#48484A')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#3A3A3C')}
            >
              Decline
            </button>
            <button
              onClick={onAccept}
              style={{
                flex: 1,
                height: '44px',
                borderRadius: '22px',
                border: 'none',
                background: '#0A84FF',
                color: '#FFFFFF',
                fontSize: '15px',
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'background 0.2s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#0070E0')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#0A84FF')}
            >
              Accept
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
