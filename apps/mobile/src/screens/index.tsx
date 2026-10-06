import React, { useState, useEffect } from 'react';
import { store, MobileAppState } from '../state/transfer-store';
import { AuraRadar, DeviceCard, TransferProgressDisplay } from '../components';
import { colors, spacing, borderRadius } from '@auradrop/ui';
import { DeviceInfo, FileMetadata, TransferSession } from '@auradrop/types';
import { SpeedCalculator } from '@auradrop/transfer-engine';

export interface ScreenProps {
  onNavigate: (screen: string, params?: any) => void;
  params?: any;
}

// ----------------------------------------------------
// 1. Splash Screen
// ----------------------------------------------------
export const SplashScreen: React.FC<ScreenProps> = ({ onNavigate }) => {
  useEffect(() => {
    const timer = setTimeout(() => onNavigate('Home'), 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: colors.dark.background,
      color: '#FFF',
    }}>
      <div style={{
        width: 80,
        height: 80,
        borderRadius: 24,
        background: 'linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 36,
        boxShadow: '0 0 40px rgba(0, 242, 254, 0.5)',
      }}>
        ⚡
      </div>
      <h1 style={{ marginTop: 24, fontSize: 28, fontWeight: 800 }}>AuraDrop</h1>
      <p style={{ marginTop: 8, color: colors.dark.textSecondary, fontSize: 14 }}>Next-Gen Direct File Streaming</p>
    </div>
  );
};

// ----------------------------------------------------
// 3. Nearby Devices Screen
// ----------------------------------------------------
export const NearbyDevicesScreen: React.FC<ScreenProps> = ({ onNavigate }) => {
  const [state, setState] = useState(store.getState());
  useEffect(() => store.subscribe(setState), []);

  return (
    <div style={{ height: '100%', padding: spacing.md, background: colors.dark.background, color: '#FFF' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => onNavigate('Home')} style={{ background: 'none', border: 'none', color: '#FFF', fontSize: 20, cursor: 'pointer' }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Nearby Devices</h2>
      </div>
      <p style={{ color: colors.dark.textSecondary, fontSize: 13, marginBottom: 16 }}>Devices currently advertising on the local network:</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {state.nearbyDevices.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: colors.dark.textMuted }}>No devices discovered yet. Turn on AuraDrop on nearby device.</div>
        ) : (
          state.nearbyDevices.map((d) => (
            <DeviceCard
              key={d.id}
              device={d}
              selected={state.selectedRecipients.some((r) => r.id === d.id)}
              onSelect={() => {
                store.selectRecipient(d);
                onNavigate('RecipientSelection', { selectedFiles: state.selectedFiles });
              }}
            />
          ))
        )}
      </div>
    </div>
  );
};

// ----------------------------------------------------
// 4. File Picker Screen
// ----------------------------------------------------
export const FilePickerScreen: React.FC<ScreenProps> = ({ onNavigate }) => {
  const [mockFiles, setMockFiles] = useState<FileMetadata[]>([
    { id: '1', name: 'Presentation_Keynote_2026.pdf', size: 14800000, mimeType: 'application/pdf', checksum: 'sha_pdf_01' },
    { id: '2', name: 'Raw_Video_Footage_4K.mov', size: 1840000000, mimeType: 'video/quicktime', checksum: 'sha_mov_02' },
    { id: '3', name: 'Dataset_Archive_Compressed.zip', size: 450000000, mimeType: 'application/zip', checksum: 'sha_zip_03' },
  ]);
  const [selectedIds, setSelectedIds] = useState<string[]>(['1', '2']);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const handleContinue = () => {
    const chosen = mockFiles.filter((f) => selectedIds.includes(f.id));
    store.setSelectedFiles(chosen);
    onNavigate('RecipientSelection', { selectedFiles: chosen });
  };

  return (
    <div style={{ height: '100%', padding: spacing.md, background: colors.dark.background, color: '#FFF', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => onNavigate('Home')} style={{ background: 'none', border: 'none', color: '#FFF', fontSize: 20, cursor: 'pointer' }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Select Files</h2>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {mockFiles.map((file) => {
          const isSelected = selectedIds.includes(file.id);
          return (
            <div
              key={file.id}
              onClick={() => toggleSelect(file.id)}
              style={{
                background: isSelected ? 'rgba(0, 242, 254, 0.1)' : '#1A1E2E',
                border: isSelected ? '1.5px solid #00F2FE' : '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: borderRadius.md,
                padding: spacing.md,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{file.name}</div>
                <div style={{ fontSize: 12, color: colors.dark.textMuted }}>{SpeedCalculator.formatBytes(file.size)}</div>
              </div>
              <div style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid #00F2FE', background: isSelected ? '#00F2FE' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', fontSize: 12, fontWeight: 700 }}>
                {isSelected ? '✓' : ''}
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={handleContinue}
        disabled={selectedIds.length === 0}
        style={{
          width: '100%',
          padding: 16,
          borderRadius: borderRadius.lg,
          border: 'none',
          background: 'linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%)',
          color: '#000',
          fontWeight: 700,
          fontSize: 16,
          cursor: selectedIds.length > 0 ? 'pointer' : 'not-allowed',
          opacity: selectedIds.length > 0 ? 1 : 0.5,
        }}
      >
        Continue ({selectedIds.length} files)
      </button>
    </div>
  );
};

// ----------------------------------------------------
// 5. Recipient Selection Screen
// ----------------------------------------------------
export const RecipientSelectionScreen: React.FC<ScreenProps> = ({ onNavigate, params }) => {
  const [state, setState] = useState(store.getState());
  useEffect(() => store.subscribe(setState), []);

  const handleSelect = (device: DeviceInfo) => {
    store.selectRecipient(device);
    onNavigate('SendConfirmation', { selectedFiles: params?.selectedFiles || state.selectedFiles, recipient: device });
  };

  return (
    <div style={{ height: '100%', padding: spacing.md, background: colors.dark.background, color: '#FFF' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => onNavigate('FilePicker')} style={{ background: 'none', border: 'none', color: '#FFF', fontSize: 20, cursor: 'pointer' }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Choose Recipient</h2>
      </div>

      <AuraRadar
        nearbyDevices={state.nearbyDevices}
        onSelectDevice={handleSelect}
        selectedDeviceId={state.selectedRecipients[0]?.id}
      />

      <div style={{ marginTop: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.dark.textSecondary, marginBottom: 12 }}>Available Peers</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {state.nearbyDevices.map((d) => (
            <DeviceCard key={d.id} device={d} onSelect={() => handleSelect(d)} />
          ))}
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------
// 6. Send Confirmation Screen
// ----------------------------------------------------
export const SendConfirmationScreen: React.FC<ScreenProps> = ({ onNavigate, params }) => {
  const recipient = params?.recipient || { name: 'MacBook Pro', platform: 'macos' };
  const files: FileMetadata[] = params?.selectedFiles || [];
  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);

  const startSend = () => {
    const transferId = `xfer_${Date.now()}`;
    const session: TransferSession = {
      transferId,
      sessionId: `sess_${Date.now()}`,
      direction: 'send',
      senderDeviceId: store.getState().localDevice.id,
      senderName: store.getState().localDevice.name,
      receiverDeviceId: recipient.id || 'dev_mac',
      receiverName: recipient.name,
      files,
      totalFiles: files.length,
      totalBytes,
      transferredBytes: 0,
      status: 'TRANSFERRING',
      currentFileIndex: 0,
      currentFileTransferredBytes: 0,
      speedBytesPerSec: 64000000,
      etaSeconds: 12,
      transport: 'LOCAL_NETWORK',
      transportLabel: 'Using local network',
      isLocalNetwork: true,
      startedAt: Date.now(),
      resumable: true,
      sessionKeyFingerprint: '4829 1049 8492 7712',
    };
    store.setState({ currentTransfer: session, appState: 'TRANSFERRING' });
    onNavigate('ActiveTransfer', { transferId });
  };

  return (
    <div style={{ height: '100%', padding: spacing.md, background: colors.dark.background, color: '#FFF', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => onNavigate('RecipientSelection')} style={{ background: 'none', border: 'none', color: '#FFF', fontSize: 20, cursor: 'pointer' }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Confirm Send</h2>
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ background: '#1A1E2E', borderRadius: borderRadius.lg, padding: 20, textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>{recipient.platform === 'ios' ? '🍏' : '💻'}</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Sending to {recipient.name}</div>
          <div style={{ fontSize: 13, color: colors.dark.primary, marginTop: 4 }}>Direct Local P2P Connection</div>
        </div>

        <div style={{ background: '#131722', borderRadius: borderRadius.md, padding: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Files ({files.length})</div>
          {files.map((f) => (
            <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: colors.dark.textSecondary, marginBottom: 8 }}>
              <span>{f.name}</span>
              <span>{SpeedCalculator.formatBytes(f.size)}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10, marginTop: 10, display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
            <span>Total</span>
            <span>{SpeedCalculator.formatBytes(totalBytes)}</span>
          </div>
        </div>
      </div>

      <button
        onClick={startSend}
        style={{
          width: '100%',
          padding: 16,
          borderRadius: borderRadius.lg,
          border: 'none',
          background: 'linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%)',
          color: '#000',
          fontWeight: 700,
          fontSize: 16,
          cursor: 'pointer',
        }}
      >
        Transmit Files Now
      </button>
    </div>
  );
};

// ----------------------------------------------------
// 7. Receiver Request Screen
// ----------------------------------------------------
export const ReceiverRequestScreen: React.FC<ScreenProps> = ({ onNavigate }) => {
  return (
    <div style={{
      height: '100%',
      padding: spacing.lg,
      background: colors.dark.background,
      color: '#FFF',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
    }}>
      <div style={{ width: 68, height: 68, borderRadius: '50%', background: 'rgba(0, 242, 254, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, color: colors.dark.primary, marginBottom: 16 }}>
        📥
      </div>
      <h2 style={{ fontSize: 22, fontWeight: 700 }}>Incoming Transfer</h2>
      <p style={{ color: colors.dark.textSecondary, marginTop: 8, fontSize: 14 }}>
        <strong>Alice's iPhone 16</strong> wants to share 3 items (1.2 GB)
      </p>

      <div style={{ background: '#1A1E2E', borderRadius: borderRadius.md, padding: 12, margin: '20px 0', width: '100%', maxWidth: 300, fontFamily: 'monospace', fontSize: 12, color: colors.dark.primary }}>
        Safety SAS: 3726 9872 8519 2023
      </div>

      <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 320 }}>
        <button
          onClick={() => onNavigate('Home')}
          style={{ flex: 1, padding: 14, borderRadius: borderRadius.md, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#FFF', fontWeight: 600, cursor: 'pointer' }}
        >
          Decline
        </button>
        <button
          onClick={() => onNavigate('ActiveTransfer')}
          style={{ flex: 1, padding: 14, borderRadius: borderRadius.md, border: 'none', background: 'linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%)', color: '#000', fontWeight: 700, cursor: 'pointer' }}
        >
          Accept
        </button>
      </div>
    </div>
  );
};

// ----------------------------------------------------
// 8. Transfer Preparation Screen
// ----------------------------------------------------
export const TransferPreparationScreen: React.FC<ScreenProps> = ({ onNavigate }) => {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: colors.dark.background, color: '#FFF' }}>
      <div style={{ fontSize: 36, animation: 'spin 2s linear infinite' }}>🔄</div>
      <h3 style={{ marginTop: 20 }}>Establishing Direct Stream</h3>
      <p style={{ color: colors.dark.textSecondary, fontSize: 13, marginTop: 6 }}>Deriving X25519 session keys...</p>
    </div>
  );
};

// ----------------------------------------------------
// 9. Active Transfer Screen
// ----------------------------------------------------
export const ActiveTransferScreen: React.FC<ScreenProps> = ({ onNavigate }) => {
  const [progress, setProgress] = useState(38);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(interval);
          store.completeTransfer();
          onNavigate('Completed');
          return 100;
        }
        return p + 6;
      });
    }, 400);
    return () => clearInterval(interval);
  }, [isPaused]);

  return (
    <div style={{ height: '100%', padding: spacing.md, background: colors.dark.background, color: '#FFF', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div>
        <div style={{ fontSize: 13, color: colors.dark.primary, fontWeight: 600, textAlign: 'center', marginTop: 10 }}>
          ⚡ Connected directly · P2PFS/1
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 800, textAlign: 'center', marginTop: 16 }}>Transferring Files</h2>
        <p style={{ textAlign: 'center', color: colors.dark.textSecondary, fontSize: 13, marginTop: 4 }}>Raw_Video_Footage_4K.mov</p>
      </div>

      <div style={{ margin: 'auto 0' }}>
        <TransferProgressDisplay
          percentage={progress}
          transferredBytes={Math.floor((progress / 100) * 1840000000)}
          totalBytes={1840000000}
          speedBytesPerSec={82000000}
          etaSeconds={Math.max(1, Math.round((100 - progress) / 6))}
        />
      </div>

      <div style={{ display: 'flex', gap: 12, paddingBottom: 20 }}>
        <button
          onClick={() => setIsPaused(!isPaused)}
          style={{ flex: 1, padding: 14, borderRadius: borderRadius.md, border: '1px solid rgba(255,255,255,0.15)', background: '#1A1E2E', color: '#FFF', fontWeight: 600, cursor: 'pointer' }}
        >
          {isPaused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button
          onClick={() => onNavigate('Home')}
          style={{ flex: 1, padding: 14, borderRadius: borderRadius.md, border: 'none', background: 'rgba(239, 68, 68, 0.2)', color: '#EF4444', fontWeight: 600, cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

// ----------------------------------------------------
// 10. Completed Screen
// ----------------------------------------------------
export const CompletedScreen: React.FC<ScreenProps> = ({ onNavigate }) => {
  return (
    <div style={{ height: '100%', padding: spacing.lg, background: colors.dark.background, color: '#FFF', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(16, 185, 129, 0.2)', color: '#10B981', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, marginBottom: 16 }}>
        ✓
      </div>
      <h2 style={{ fontSize: 24, fontWeight: 800 }}>Transfer Complete</h2>
      <p style={{ color: colors.dark.textSecondary, fontSize: 14, marginTop: 6 }}>All 2 files verified & received byte-for-byte.</p>

      <div style={{ display: 'flex', gap: 12, marginTop: 32, width: '100%', maxWidth: 300 }}>
        <button
          onClick={() => onNavigate('TransferHistory')}
          style={{ flex: 1, padding: 14, borderRadius: borderRadius.md, border: '1px solid rgba(255,255,255,0.15)', background: '#1A1E2E', color: '#FFF', fontWeight: 600, cursor: 'pointer' }}
        >
          History
        </button>
        <button
          onClick={() => onNavigate('Home')}
          style={{ flex: 1, padding: 14, borderRadius: borderRadius.md, border: 'none', background: 'linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%)', color: '#000', fontWeight: 700, cursor: 'pointer' }}
        >
          Done
        </button>
      </div>
    </div>
  );
};

// ----------------------------------------------------
// 11. Transfer History Screen
// ----------------------------------------------------
export const TransferHistoryScreen: React.FC<ScreenProps> = ({ onNavigate }) => {
  const [state, setState] = useState(store.getState());
  useEffect(() => store.subscribe(setState), []);

  return (
    <div style={{ height: '100%', padding: spacing.md, background: colors.dark.background, color: '#FFF', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => onNavigate('Home')} style={{ background: 'none', border: 'none', color: '#FFF', fontSize: 20, cursor: 'pointer' }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Transfer History</h2>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {state.history.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: colors.dark.textMuted }}>No transfers yet.</div>
        ) : (
          state.history.map((item) => (
            <div key={item.id} style={{ padding: 14, background: '#1A1E2E', borderRadius: borderRadius.md, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{item.direction === 'sent' ? '↗ Sent to ' : '↙ Received from '} {item.counterpartName}</div>
                <div style={{ fontSize: 12, color: colors.dark.textMuted }}>{SpeedCalculator.formatBytes(item.totalBytes)} · {item.files.map((f) => f.name).join(', ')}</div>
              </div>
              <span style={{ color: '#10B981', fontWeight: 700, fontSize: 12 }}>✓ Done</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ----------------------------------------------------
// 12. Device Profile Screen
// ----------------------------------------------------
export const DeviceProfileScreen: React.FC<ScreenProps> = ({ onNavigate }) => {
  const state = store.getState();
  return (
    <div style={{ height: '100%', padding: spacing.md, background: colors.dark.background, color: '#FFF' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => onNavigate('Home')} style={{ background: 'none', border: 'none', color: '#FFF', fontSize: 20, cursor: 'pointer' }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Device Profile</h2>
      </div>
      <div style={{ background: '#1A1E2E', borderRadius: borderRadius.lg, padding: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>📱</div>
        <h3>{state.localDevice.name}</h3>
        <p style={{ color: colors.dark.textMuted, fontSize: 12, marginTop: 4 }}>ID: {state.localDevice.id}</p>
        <div style={{ marginTop: 16, fontSize: 13, color: colors.dark.primary }}>Platform: {state.localDevice.platform.toUpperCase()}</div>
      </div>
    </div>
  );
};

// ----------------------------------------------------
// 13. Settings Screen
// ----------------------------------------------------
export const SettingsScreen: React.FC<ScreenProps> = ({ onNavigate }) => {
  const [mode, setMode] = useState(store.getState().localDevice.visibilityMode);

  const changeMode = (newMode: any) => {
    setMode(newMode);
    store.setVisibility(newMode);
  };

  return (
    <div style={{ height: '100%', padding: spacing.md, background: colors.dark.background, color: '#FFF' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => onNavigate('Home')} style={{ background: 'none', border: 'none', color: '#FFF', fontSize: 20, cursor: 'pointer' }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Settings</h2>
      </div>

      <div style={{ background: '#1A1E2E', borderRadius: borderRadius.lg, padding: 18, marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Device Visibility</div>
        {(['everyone', 'contacts', 'off'] as const).map((m) => (
          <div
            key={m}
            onClick={() => changeMode(m)}
            style={{
              padding: '12px 16px',
              borderRadius: borderRadius.md,
              background: mode === m ? 'rgba(0, 242, 254, 0.15)' : 'transparent',
              color: mode === m ? '#00F2FE' : '#FFF',
              display: 'flex',
              justifyContent: 'space-between',
              cursor: 'pointer',
              marginBottom: 4,
            }}
          >
            <span style={{ textTransform: 'capitalize' }}>{m}</span>
            {mode === m ? <span>✓</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
};

// ----------------------------------------------------
// 14. Privacy Center Screen
// ----------------------------------------------------
export const PrivacyCenterScreen: React.FC<ScreenProps> = ({ onNavigate }) => {
  return (
    <div style={{ height: '100%', padding: spacing.md, background: colors.dark.background, color: '#FFF' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => onNavigate('Home')} style={{ background: 'none', border: 'none', color: '#FFF', fontSize: 20, cursor: 'pointer' }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Privacy Center</h2>
      </div>
      <div style={{ background: '#1A1E2E', borderRadius: borderRadius.lg, padding: 20, lineHeight: 1.8, fontSize: 14, color: colors.dark.textSecondary }}>
        <p>🛡️ <strong>Zero Cloud Storage:</strong> All files transfer directly over your local Wi-Fi or direct connection. No file chunks touch external servers.</p>
        <p style={{ marginTop: 12 }}>🔒 <strong>End-to-End Cryptography:</strong> Transmissions are authenticated with X25519 and encrypted with AEAD AES-256-GCM.</p>
        <p style={{ marginTop: 12 }}>🚫 <strong>No Telemetry of File Contents:</strong> Filenames and contents are never logged or exported.</p>
      </div>
    </div>
  );
};

// ----------------------------------------------------
// 15. Security Center Screen
// ----------------------------------------------------
export const SecurityCenterScreen: React.FC<ScreenProps> = ({ onNavigate }) => {
  return (
    <div style={{ height: '100%', padding: spacing.md, background: colors.dark.background, color: '#FFF' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => onNavigate('Home')} style={{ background: 'none', border: 'none', color: '#FFF', fontSize: 20, cursor: 'pointer' }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Security Center</h2>
      </div>
      <div style={{ background: '#1A1E2E', borderRadius: borderRadius.lg, padding: 20 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Device Identity Fingerprint (SAS)</div>
        <div style={{ fontFamily: 'monospace', color: colors.dark.primary, fontSize: 16 }}>3726 9872 8519 2023</div>
        <p style={{ color: colors.dark.textMuted, fontSize: 12, marginTop: 8 }}>Compare with recipient to guarantee zero man-in-the-middle attacks.</p>
      </div>
    </div>
  );
};

// ----------------------------------------------------
// 16. Pairing Screen
// ----------------------------------------------------
export const PairingScreen: React.FC<ScreenProps> = ({ onNavigate }) => {
  return (
    <div style={{ height: '100%', padding: spacing.md, background: colors.dark.background, color: '#FFF' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => onNavigate('Home')} style={{ background: 'none', border: 'none', color: '#FFF', fontSize: 20, cursor: 'pointer' }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Device Pairing</h2>
      </div>
      <button onClick={() => onNavigate('QrPairing')} style={{ width: '100%', padding: 14, borderRadius: borderRadius.md, background: '#1A1E2E', border: '1px solid rgba(255,255,255,0.1)', color: '#FFF', fontWeight: 600, cursor: 'pointer' }}>
        📷 Scan QR Pairing Code
      </button>
    </div>
  );
};

// ----------------------------------------------------
// 17. QR Pairing Screen
// ----------------------------------------------------
export const QrPairingScreen: React.FC<ScreenProps> = ({ onNavigate }) => {
  return (
    <div style={{ height: '100%', padding: spacing.md, background: colors.dark.background, color: '#FFF', textAlign: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => onNavigate('Home')} style={{ background: 'none', border: 'none', color: '#FFF', fontSize: 20, cursor: 'pointer' }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>QR Pairing</h2>
      </div>
      <div style={{ background: '#FFF', padding: 20, borderRadius: 20, display: 'inline-block', margin: '30px auto' }}>
        <div style={{ color: '#000', fontFamily: 'monospace', fontSize: 11, maxWidth: 220, wordBreak: 'break-all' }}>
          PAIR://v1/eyJkZXZpY2VJZCI6Im0...
        </div>
      </div>
      <p style={{ color: colors.dark.textSecondary, fontSize: 13 }}>Scan this code from any other device to establish instant connection.</p>
    </div>
  );
};

// ----------------------------------------------------
// 18. Help & Diagnostics Screen
// ----------------------------------------------------
export const HelpDiagnosticsScreen: React.FC<ScreenProps> = ({ onNavigate }) => {
  return (
    <div style={{ height: '100%', padding: spacing.md, background: colors.dark.background, color: '#FFF' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => onNavigate('Home')} style={{ background: 'none', border: 'none', color: '#FFF', fontSize: 20, cursor: 'pointer' }}>←</button>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Help & Diagnostics</h2>
      </div>
      <div style={{ background: '#1A1E2E', borderRadius: borderRadius.lg, padding: 18, fontSize: 13, lineHeight: 1.8, color: colors.dark.textSecondary }}>
        <div>⚡ <strong>Protocol:</strong> P2PFS/1</div>
        <div>📡 <strong>Discovery Port:</strong> 48290 UDP Multicast</div>
        <div>🔒 <strong>Transfer Port:</strong> 48291 TCP Direct</div>
        <div>🛡️ <strong>Transport Selection:</strong> Direct LAN Priority 1</div>
        <div>Ping Latency: 1.4ms (Local Subnet)</div>
      </div>
    </div>
  );
};

export * from './HomeScreen';
