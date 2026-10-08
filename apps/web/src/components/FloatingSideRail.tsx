import React, { useState } from 'react';

export type ActiveTab = 'globe' | 'transfers' | 'devices' | 'chat' | 'specs';

interface FloatingSideRailProps {
  currentTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  activeTransfersCount?: number;
  discoveredPeersCount?: number;
}

export const FloatingSideRail: React.FC<FloatingSideRailProps> = ({
  currentTab,
  onSelectTab,
  activeTransfersCount = 0,
  discoveredPeersCount = 0,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const dots: Array<{
    id: ActiveTab;
    label: string;
    sub: string;
    badge?: number;
  }> = [
    { id: 'globe', label: 'Proximity Radar', sub: '3D Globe & Nodes' },
    { id: 'transfers', label: 'Real Transfers', sub: 'Live streaming bytes', badge: activeTransfersCount },
    { id: 'devices', label: 'Pair & Discover', sub: 'Connect devices & QR', badge: discoveredPeersCount },
    { id: 'chat', label: 'Peer Chat', sub: 'Encrypted direct messaging' },
    { id: 'specs', label: 'Data Plane Specs', sub: 'V11 Engine Architecture' },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        left: '24px',
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 500,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      {/* Floating Vertical Pill matching media_1791373512430.png */}
      <div
        style={{
          width: '46px',
          padding: '16px 0',
          background: 'rgba(20, 20, 24, 0.85)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '26px',
          boxShadow: '0 16px 40px rgba(0, 0, 0, 0.8), 0 0 1px 1px rgba(255, 255, 255, 0.05)',
          backdropFilter: 'blur(20px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '18px',
        }}
      >
        {dots.map((dot, idx) => {
          const isActive = currentTab === dot.id;
          const isHovered = hoveredIdx === idx;

          return (
            <div
              key={dot.id}
              style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <button
                onClick={() => onSelectTab(dot.id)}
                aria-label={dot.label}
                style={{
                  width: '26px',
                  height: '26px',
                  background: 'transparent',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  padding: 0,
                  position: 'relative',
                }}
              >
                {/* Outer Ring on Active */}
                {isActive && (
                  <div
                    style={{
                      position: 'absolute',
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      border: '1.5px solid rgba(255, 255, 255, 0.7)',
                      animation: 'activePulse 2s ease infinite',
                    }}
                  />
                )}

                {/* Inner Dot exactly as seen in reference */}
                <div
                  style={{
                    width: isActive ? '10px' : isHovered ? '8px' : '7px',
                    height: isActive ? '10px' : isHovered ? '8px' : '7px',
                    borderRadius: '50%',
                    background: isActive ? '#FFFFFF' : isHovered ? '#CCCCCC' : '#4E4E54',
                    boxShadow: isActive ? '0 0 10px rgba(255, 255, 255, 0.9)' : 'none',
                    transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                />

                {/* Optional Badge Indicator */}
                {dot.badge && dot.badge > 0 ? (
                  <div
                    style={{
                      position: 'absolute',
                      top: '1px',
                      right: '1px',
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: '#34C759',
                      boxShadow: '0 0 6px #34C759',
                    }}
                  />
                ) : null}
              </button>

              {/* Tooltip on Hover */}
              {isHovered && (
                <div
                  style={{
                    position: 'absolute',
                    left: '42px',
                    background: '#16161A',
                    border: '1px solid #2C2C32',
                    borderRadius: '12px',
                    padding: '8px 14px',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.8)',
                    pointerEvents: 'none',
                    zIndex: 1000,
                    animation: 'tooltipSlide 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards',
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#FFFFFF' }}>{dot.label}</div>
                  <div style={{ fontSize: '10px', color: '#8E8E93', marginTop: '2px' }}>{dot.sub}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes activePulse {
          0% { transform: scale(0.9); opacity: 0.8; }
          50% { transform: scale(1.15); opacity: 0.3; }
          100% { transform: scale(0.9); opacity: 0.8; }
        }
        @keyframes tooltipSlide {
          from { opacity: 0; transform: translateX(-6px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
};
