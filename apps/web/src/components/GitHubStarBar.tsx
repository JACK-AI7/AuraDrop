import React from 'react';

export const GitHubStarBar: React.FC = () => {
  return (
    <div
      style={{
        background: 'linear-gradient(90deg, #09090C 0%, #121217 50%, #09090C 100%)',
        borderBottom: '1px solid #222228',
        padding: '8px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '12px',
        zIndex: 1000,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span
          style={{
            background: '#1A1A22',
            border: '1px solid #2D2D36',
            borderRadius: '10px',
            padding: '2px 8px',
            fontSize: '10px',
            fontWeight: 800,
            color: '#0A84FF',
            letterSpacing: '0.4px',
          }}
        >
          OPEN SOURCE
        </span>
        <span style={{ color: '#CCCCCC', fontWeight: 500 }}>
          ⭐ Love AuraDrop? Support the project by giving us a star on GitHub!
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <a
          href="https://github.com/JACK-AI7/AuraDrop"
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: '#1C1C22',
            border: '1px solid #33333E',
            borderRadius: '14px',
            padding: '4px 12px',
            color: '#FFFFFF',
            textDecoration: 'none',
            fontSize: '11px',
            fontWeight: 700,
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#0A84FF';
            e.currentTarget.style.background = '#22222C';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#33333E';
            e.currentTarget.style.background = '#1C1C22';
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#EAB308" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          Star on GitHub
        </a>

        <a
          href="https://github.com/JACK-AI7/AuraDrop/releases"
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: '#0A84FF',
            borderRadius: '14px',
            padding: '4px 12px',
            color: '#FFFFFF',
            textDecoration: 'none',
            fontSize: '11px',
            fontWeight: 800,
            transition: 'background 0.2s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#0070E0')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#0A84FF')}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Get Android APK
        </a>
      </div>
    </div>
  );
};
