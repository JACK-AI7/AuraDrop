import React, { useRef } from 'react';
import { PickedFile, PeerDevice } from '../types';

interface DockedShareTrayProps {
  files: PickedFile[];
  onAddFiles: (files: FileList) => void;
  onRemoveFile: (id: string) => void;
  selectedPeer?: PeerDevice | null;
  onSend: () => void;
}

export const DockedShareTray: React.FC<DockedShareTrayProps> = ({
  files,
  onAddFiles,
  onRemoveFile,
  selectedPeer,
  onSend,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
  const totalFormatted =
    totalBytes < 1024 * 1024
      ? `${(totalBytes / 1024).toFixed(1)} KB`
      : `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onAddFiles(e.target.files);
    }
  };

  return (
    <div
      style={{
        background: '#080809',
        borderTop: '1px solid #1C1C1E',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 50,
      }}
    >
      <input
        type="file"
        ref={fileInputRef}
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Left: Attach button & staged files counter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            background: '#16161A',
            border: '1px solid #242428',
            borderRadius: '12px',
            padding: '10px 16px',
            color: '#FFFFFF',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#0A84FF';
            e.currentTarget.style.background = '#1A1A20';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#242428';
            e.currentTarget.style.background = '#16161A';
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0A84FF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Files
        </button>

        {files.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflowX: 'auto', maxWidth: '400px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>
              {files.length} file{files.length > 1 ? 's' : ''} staged ({totalFormatted})
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              {files.slice(0, 3).map((f) => (
                <div
                  key={f.id}
                  style={{
                    background: '#1A1A1E',
                    border: '1px solid #2A2A2E',
                    borderRadius: '8px',
                    padding: '4px 8px',
                    fontSize: '11px',
                    color: '#8E8E93',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ maxWidth: '90px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveFile(f.id);
                    }}
                    style={{ cursor: 'pointer', color: '#EF4444', fontWeight: 700 }}
                  >
                    ×
                  </span>
                </div>
              ))}
              {files.length > 3 && (
                <span style={{ fontSize: '11px', color: '#636366', alignSelf: 'center' }}>
                  +{files.length - 3} more
                </span>
              )}
            </div>
          </div>
        ) : (
          <span style={{ fontSize: '12px', color: '#636366' }}>
            Drag & drop files anywhere, or select recipient from Globe
          </span>
        )}
      </div>

      {/* Right: Send button */}
      <div>
        <button
          onClick={onSend}
          disabled={files.length === 0}
          style={{
            background: files.length > 0 ? '#0A84FF' : '#1C1C1E',
            border: 'none',
            borderRadius: '20px',
            padding: '10px 22px',
            color: files.length > 0 ? '#FFFFFF' : '#636366',
            fontSize: '13px',
            fontWeight: 800,
            cursor: files.length > 0 ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s ease',
            boxShadow: files.length > 0 ? '0 0 16px rgba(10, 132, 255, 0.4)' : 'none',
          }}
          onMouseEnter={(e) => {
            if (files.length > 0) e.currentTarget.style.background = '#0070E0';
          }}
          onMouseLeave={(e) => {
            if (files.length > 0) e.currentTarget.style.background = '#0A84FF';
          }}
        >
          <span>{selectedPeer ? `Send to ${selectedPeer.name}` : files.length > 0 ? 'Send Now' : 'Send'}</span>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};
