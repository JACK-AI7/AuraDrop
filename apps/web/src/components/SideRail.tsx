import React, { useState } from 'react';

export type SideRailView = 'home' | 'transfers' | 'diagnostics' | 'chat' | 'history' | 'settings';

interface SideRailProps {
  currentView: SideRailView;
  onSelectView: (view: SideRailView) => void;
  activeTransfersCount: number;
  localDeviceName: string;
}

export const SideRail: React.FC<SideRailProps> = ({
  currentView,
  onSelectView,
  activeTransfersCount,
  localDeviceName,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const navItems: Array<{
    id: SideRailView;
    label: string;
    description: string;
    badge?: number;
    icon: (active: boolean) => React.ReactNode;
  }> = [
    {
      id: 'home',
      label: 'Proximity Radar',
      description: '3D Globe peer discovery',
      icon: (active) => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? '#0A84FF' : '#8E8E93'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      ),
    },
    {
      id: 'transfers',
      label: 'Real Transfers',
      description: 'Live P2P stream & files',
      badge: activeTransfersCount,
      icon: (active) => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? '#0A84FF' : '#8E8E93'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="17 1 21 5 17 9" />
          <path d="M3 11V9a4 4 0 0 1 4-4h14" />
          <polyline points="7 23 3 19 7 15" />
          <path d="M21 13v2a4 4 0 0 1-4 4H3" />
        </svg>
      ),
    },
    {
      id: 'diagnostics',
      label: 'Data Plane Specs',
      description: 'V11 Engine Architecture',
      icon: (active) => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? '#0A84FF' : '#8E8E93'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      ),
    },
    {
      id: 'chat',
      label: 'Encrypted Chat',
      description: 'Zero-cloud peer messaging',
      icon: (active) => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? '#0A84FF' : '#8E8E93'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      id: 'history',
      label: 'Transfer History',
      description: 'SHA-256 audit ledger',
      icon: (active) => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? '#0A84FF' : '#8E8E93'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
    {
      id: 'settings',
      label: 'Preferences',
      description: 'Visibility & security',
      icon: (active) => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? '#0A84FF' : '#8E8E93'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
  ];

  return (
    <aside
      style={{
        width: isExpanded ? '260px' : '72px',
        background: '#09090B',
        borderRight: '1px solid #1C1C20',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'width 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        zIndex: 90,
        position: 'relative',
        flexShrink: 0,
      }}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
    >
      {/* Top Brand & Toggle */}
      <div>
        <div
          style={{
            height: '64px',
            display: 'flex',
            alignItems: 'center',
            padding: '0 18px',
            gap: '12px',
            borderBottom: '1px solid #141416',
          }}
        >
          {/* Concentric Aura Rings Logo */}
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: '#0A84FF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: '0 0 12px rgba(10, 132, 255, 0.5)',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" />
              <circle cx="12" cy="12" r="6.8" />
              <circle cx="12" cy="12" r="10.2" />
            </svg>
          </div>

          {isExpanded && (
            <div style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
              <div style={{ fontSize: '15px', fontWeight: 900, letterSpacing: '-0.3px', color: '#FFFFFF' }}>
                AuraDrop
              </div>
              <div style={{ fontSize: '10px', color: '#8E8E93', fontWeight: 600 }}>
                Desktop V11 Data Plane
              </div>
            </div>
          )}
        </div>

        {/* Navigation Items */}
        <div style={{ padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {navItems.map((item) => {
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectView(item.id)}
                style={{
                  width: '100%',
                  height: '46px',
                  borderRadius: '14px',
                  border: 'none',
                  background: isActive ? 'rgba(10, 132, 255, 0.12)' : 'transparent',
                  color: isActive ? '#FFFFFF' : '#8E8E93',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 14px',
                  gap: '14px',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'all 0.18s ease',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = '#141418';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'transparent';
                }}
              >
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {item.icon(isActive)}
                </div>

                {isExpanded && (
                  <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: isActive ? 700 : 600, color: isActive ? '#FFFFFF' : '#CCCCCC' }}>
                      {item.label}
                    </div>
                    <div style={{ fontSize: '10px', color: '#636366' }}>
                      {item.description}
                    </div>
                  </div>
                )}

                {item.badge && item.badge > 0 ? (
                  <span
                    style={{
                      background: '#0A84FF',
                      color: '#FFFFFF',
                      fontSize: '10px',
                      fontWeight: 800,
                      borderRadius: '10px',
                      padding: '2px 6px',
                      flexShrink: 0,
                    }}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Local Device Badge */}
      <div
        style={{
          padding: '14px 12px',
          borderTop: '1px solid #141416',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: '#34C759',
            boxShadow: '0 0 8px #34C759',
            flexShrink: 0,
          }}
        />

        {isExpanded && (
          <div style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#FFFFFF' }}>{localDeviceName}</div>
            <div style={{ fontSize: '9px', color: '#34C759', fontWeight: 600 }}>READY_TO_TRANSFER</div>
          </div>
        )}
      </div>
    </aside>
  );
};
