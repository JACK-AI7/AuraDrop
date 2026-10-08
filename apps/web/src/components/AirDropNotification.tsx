import React, { useState, useEffect } from 'react';
import { TransferProgress } from '../types';

interface AirDropNotificationProps {
  isOpen: boolean;
  senderName: string;
  senderAvatarUrl?: string | null;
  filesCount: number;
  totalSizeText: string;
  fileName?: string;
  previewUrl?: string | null;
  onAccept: () => void;
  onDecline: () => void;
  transferProgress?: TransferProgress | null;
  onDone?: () => void;
}

/**
 * AirDropNotification
 * Bit-exact reproduction of Apple AirDrop & Dynamic Island proximity card
 * (as shown in user-uploaded media_1791389716447.png and media_1791389716524.png):
 * - Jet-black floating Dynamic Island pill at top of screen
 * - Shimmering fluid iridescent rim glow at the top bezel
 * - AirDrop concentric wave icon with sender profile photo badge overlay
 * - Large rounded square photo/file preview thumbnail on right
 * - [Decline] (dark charcoal pill) and [Accept] (iOS deep blue pill)
 */
export const AirDropNotification: React.FC<AirDropNotificationProps> = ({
  isOpen,
  senderName,
  senderAvatarUrl,
  filesCount,
  totalSizeText,
  fileName,
  previewUrl,
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
      const timer = setTimeout(() => setIsRendered(false), 380);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isRendered) return null;

  const currentState = (transferProgress?.state || '').toUpperCase();
  const isTransferring = currentState === 'TRANSFERRING' || currentState === 'VERIFYING';
  const isCompleted = currentState === 'COMPLETED';

  const progressPct =
    transferProgress && transferProgress.fileSize > 0
      ? Math.min(100, Math.round((transferProgress.transferredBytes / transferProgress.fileSize) * 100))
      : 0;

  const initials = senderName
    ? senderName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase()
    : 'AD';

  return (
    <div
      style={{
        position: 'fixed',
        top: '12px',
        left: '50%',
        transform: `translateX(-50%) translateY(${isAnimatingIn ? '0px' : '-130px'}) scale(${isAnimatingIn ? '1' : '0.94'})`,
        opacity: isAnimatingIn ? 1 : 0,
        transition: 'all 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
        zIndex: 9999,
        width: 'calc(100% - 24px)',
        maxWidth: '430px',
        pointerEvents: 'auto',
      }}
    >
      {/* Dynamic Island Capsule Container */}
      <div
        style={{
          position: 'relative',
          background: '#000000',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          borderRadius: '34px',
          padding: '16px 20px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.95), 0 0 1px 1px rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(32px)',
          overflow: 'hidden',
        }}
      >
        {/* Shimmering Top Fluid Rim Glow (media_1791389716524.png) */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '12%',
            right: '12%',
            height: '2px',
            background: 'linear-gradient(90deg, rgba(255,70,85,0) 0%, rgba(255,75,95,0.9) 30%, rgba(255,160,180,1) 50%, rgba(255,75,95,0.9) 70%, rgba(255,70,85,0) 100%)',
            boxShadow: '0 0 14px 3px rgba(255, 75, 95, 0.85)',
            filter: 'blur(0.5px)',
          }}
        />

        {/* Top Info Row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* Left: Concentric Blue AirDrop Icon with overlapping Sender Avatar */}
          <div style={{ position: 'relative', width: '48px', height: '48px', flexShrink: 0 }}>
            {/* Concentric Wave Icon */}
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                background: '#000000',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                {/* Concentric AirDrop Radiating Rings */}
                <path
                  d="M12 17C14.7614 17 17 14.7614 17 12C17 9.23858 14.7614 7 12 7"
                  stroke="#FFFFFF"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
                <path
                  d="M12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4"
                  stroke="#FFFFFF"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
                <circle cx="12" cy="12" r="2.2" fill="#FFFFFF" />
              </svg>
            </div>

            {/* Overlapping Sender Profile Avatar Badge */}
            <div
              style={{
                position: 'absolute',
                bottom: '-2px',
                right: '-2px',
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                border: '2px solid #000000',
                background: '#2C2C2E',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {senderAvatarUrl ? (
                <img
                  src={senderAvatarUrl}
                  alt={senderName}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <span style={{ fontSize: '9px', fontWeight: 800, color: '#FFFFFF' }}>{initials}</span>
              )}
            </div>
          </div>

          {/* Center: Title & Subtitle */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: '16px',
                fontWeight: 700,
                color: '#FFFFFF',
                letterSpacing: '-0.3px',
                lineHeight: 1.2,
              }}
            >
              AirDrop
            </div>
            <div
              style={{
                fontSize: '13.5px',
                color: '#A0A0A5',
                marginTop: '3px',
                lineHeight: 1.25,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {isTransferring
                ? `Receiving from ${senderName}...`
                : isCompleted
                ? `Received ${filesCount} item(s) from ${senderName}`
                : `${senderName} would like to share ${
                    filesCount > 1 ? `${filesCount} photos` : fileName || '1 file'
                  }`}
            </div>
          </div>

          {/* Right: Rounded Square Photo / File Preview Thumbnail (media_1791389716447.png) */}
          <div
            style={{
              width: '58px',
              height: '58px',
              borderRadius: '16px',
              background: '#1A1A1E',
              border: '1px solid #28282D',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              overflow: 'hidden',
              boxShadow: 'inset 0 0 10px rgba(0, 0, 0, 0.6)',
            }}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="preview"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  background: 'linear-gradient(135deg, #1C3048 0%, #0E1B2A 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#5AC8FA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="3" ry="3" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </div>
            )}
          </div>
        </div>

        {/* Live Transfer Progress State */}
        {isTransferring && (
          <div style={{ marginTop: '14px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: '#8E8E93',
                marginBottom: '6px',
                fontWeight: 600,
              }}
            >
              <span style={{ color: '#FFFFFF' }}>{progressPct}%</span>
              <span>
                {((transferProgress?.transferredBytes || 0) / (1024 * 1024)).toFixed(1)} /{' '}
                {((transferProgress?.fileSize || 0) / (1024 * 1024)).toFixed(1)} MB (
                {((transferProgress?.speedBytesPerSec || 0) / (1024 * 1024)).toFixed(1)} MB/s)
              </span>
            </div>
            <div
              style={{
                width: '100%',
                height: '6px',
                background: '#2C2C2E',
                borderRadius: '3px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${progressPct}%`,
                  background: '#34C759',
                  borderRadius: '3px',
                  transition: 'width 0.15s ease',
                  boxShadow: '0 0 10px rgba(52, 199, 89, 0.6)',
                }}
              />
            </div>
          </div>
        )}

        {/* Bottom Row: [Decline] (dark charcoal pill) and [Accept] (Apple high-contrast white pill) */}
        {!isTransferring && !isCompleted && (
          <div style={{ display: 'flex', gap: '12px', marginTop: '14px' }}>
            <button
              onClick={onDecline}
              style={{
                flex: 1,
                height: '44px',
                borderRadius: '22px',
                background: '#2C2C2E',
                border: 'none',
                color: '#FFFFFF',
                fontSize: '15px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'background 0.2s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#3A3A3C')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#2C2C2E')}
            >
              Decline
            </button>
            <button
              onClick={onAccept}
              style={{
                flex: 1,
                height: '44px',
                borderRadius: '22px',
                background: '#FFFFFF',
                border: 'none',
                color: '#000000',
                fontSize: '15px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(255, 255, 255, 0.25)',
                transition: 'background 0.2s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#E5E5EA')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#FFFFFF')}
            >
              Accept
            </button>
          </div>
        )}

        {/* Completed State Button */}
        {isCompleted && (
          <div style={{ marginTop: '14px' }}>
            <button
              onClick={onDone}
              style={{
                width: '100%',
                height: '44px',
                borderRadius: '22px',
                background: '#34C759',
                border: 'none',
                color: '#FFFFFF',
                fontSize: '15px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(52, 199, 89, 0.4)',
              }}
            >
              ✓ Done • Open Received File
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
