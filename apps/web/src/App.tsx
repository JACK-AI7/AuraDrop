import React, { useState, useEffect, useRef } from 'react';
import { GitHubStarBar } from './components/GitHubStarBar';
import { SideRail, SideRailView } from './components/SideRail';
import { HeroGlobe } from './components/HeroGlobe';
import { AirDropNotification } from './components/AirDropNotification';
import { ProximityRipple } from './components/ProximityRipple';
import { DockedShareTray } from './components/DockedShareTray';
import { DiagnosticsView } from './components/DiagnosticsView';
import { ChatModal, SettingsModal, ProfileModal } from './components/Modals';
import { P2PEngine, TransferEvent } from './engine/p2pEngine';
import { PeerDevice, PickedFile, TransferProgress, VisibilityMode } from './types';

export const App: React.FC = () => {
  const engine = P2PEngine.getInstance();

  // Navigation & View
  const [currentView, setCurrentView] = useState<SideRailView>('home');
  const [visibility, setVisibility] = useState<VisibilityMode>('everyone');

  // Real Peers from P2PEngine
  const [peers, setPeers] = useState<PeerDevice[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<PeerDevice | null>(null);

  // Staged Real Files
  const [stagedFiles, setStagedFiles] = useState<PickedFile[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Real AirDrop Card State (pops down on real incoming request)
  const [isAirDropCardOpen, setIsAirDropCardOpen] = useState(false);
  const [incomingTransferMeta, setIncomingTransferMeta] = useState<{
    transferId: string;
    senderName: string;
    fileName: string;
    fileSize: number;
    sizeFormatted: string;
  }>({
    transferId: '',
    senderName: '',
    fileName: '',
    fileSize: 0,
    sizeFormatted: '',
  });

  // Real Transfer Progress
  const [transferProgress, setTransferProgress] = useState<TransferProgress | null>(null);

  // Real Transfer History
  const [transferHistory, setTransferHistory] = useState<Array<{
    id: string;
    fileName: string;
    fileSize: number;
    sha256?: string;
    timestamp: Date;
    isIncoming: boolean;
    peerName: string;
  }>>([]);

  // ReactBits shockwave trigger key
  const [rippleKey, setRippleKey] = useState(0);

  // Modals
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  // ---------------------------------------------------------------------------
  // SUBSCRIBE TO REAL ENGINE EVENTS
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // 1. Peer discovery subscription
    const unsubscribePeers = engine.onPeersUpdated((updatedPeers) => {
      setPeers(updatedPeers);
      setSelectedPeer((prev) => {
        if (!prev) return updatedPeers[0] || null;
        const exists = updatedPeers.find((p) => p.id === prev.id);
        return exists || updatedPeers[0] || null;
      });
    });

    // 2. Transfer event subscription
    const unsubscribeTransfers = engine.onTransferEvent((evt: TransferEvent) => {
      setRippleKey((prev) => prev + 1);

      if (evt.type === 'request') {
        // Real incoming share request from another peer
        const formattedSize =
          evt.fileSize < 1024 * 1024
            ? `${(evt.fileSize / 1024).toFixed(1)} KB`
            : `${(evt.fileSize / (1024 * 1024)).toFixed(1)} MB`;

        setIncomingTransferMeta({
          transferId: evt.transferId,
          senderName: evt.senderName,
          fileName: evt.fileName,
          fileSize: evt.fileSize,
          sizeFormatted: formattedSize,
        });

        setIsAirDropCardOpen(true);
      } else if (evt.type === 'progress') {
        // Real byte stream progress
        setTransferProgress({
          transferId: evt.transferId,
          fileName: evt.fileName,
          fileSize: evt.fileSize,
          transferredBytes: evt.transferredBytes || 0,
          speedBytesPerSec: evt.speedBytesPerSec || 0,
          etaSeconds: evt.etaSeconds || 0,
          state: 'transferring',
          isIncoming: true,
          peerName: evt.senderName,
        });
      } else if (evt.type === 'completed') {
        // Real completed transfer with SHA-256
        setTransferProgress((prev) =>
          prev
            ? {
                ...prev,
                transferredBytes: evt.fileSize,
                state: 'completed',
                sha256: evt.sha256,
              }
            : null
        );

        setTransferHistory((prev) => [
          {
            id: evt.transferId,
            fileName: evt.fileName,
            fileSize: evt.fileSize,
            sha256: evt.sha256,
            timestamp: new Date(),
            isIncoming: true,
            peerName: evt.senderName,
          },
          ...prev,
        ]);
      } else if (evt.type === 'error') {
        alert(evt.error || 'Transfer failed');
        setIsAirDropCardOpen(false);
        setTransferProgress(null);
      }
    });

    return () => {
      unsubscribePeers();
      unsubscribeTransfers();
    };
  }, [engine]);

  // ---------------------------------------------------------------------------
  // DRAG & DROP FOR REAL FILES
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingOver(true);
    };
    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      if (e.relatedTarget === null) {
        setIsDraggingOver(false);
      }
    };
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingOver(false);
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        handleRealFilesStaged(e.dataTransfer.files);
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  const handleRealFilesStaged = (fileList: FileList) => {
    const newFiles: PickedFile[] = Array.from(fileList).map((f) => ({
      id: `${f.name}_${Date.now()}_${Math.random()}`,
      name: f.name,
      size: f.size,
      type: f.type || 'application/octet-stream',
      file: f,
    }));
    setStagedFiles((prev) => [...prev, ...newFiles]);
    setRippleKey((prev) => prev + 1);
  };

  const handleRemoveStagedFile = (id: string) => {
    setStagedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // ---------------------------------------------------------------------------
  // ACTIONS: REAL SEND & REAL ACCEPT
  // ---------------------------------------------------------------------------
  const handleSendRealFiles = async () => {
    if (!selectedPeer || stagedFiles.length === 0) return;
    const fileToTransfer = stagedFiles[0]?.file;
    if (!fileToTransfer) return;

    setRippleKey((prev) => prev + 1);

    try {
      await engine.startOutgoingTransfer(selectedPeer, fileToTransfer);
      // Remove sent file from staging
      setStagedFiles((prev) => prev.slice(1));
    } catch (err: any) {
      alert(`Transfer failed: ${err.message}`);
    }
  };

  const handleAcceptRealTransfer = () => {
    engine.acceptIncomingTransfer();
    setRippleKey((prev) => prev + 1);
  };

  const handleDeclineRealTransfer = () => {
    engine.declineIncomingTransfer();
    setIsAirDropCardOpen(false);
    setTransferProgress(null);
  };

  const handleDoneTransfer = () => {
    setIsAirDropCardOpen(false);
    setTransferProgress(null);
  };

  return (
    <div
      style={{
        background: '#000000',
        color: '#FFFFFF',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* 1. TOP GITHUB STAR BAR */}
      <GitHubStarBar />

      {/* 2. REACTBITS PROXIMITY SHOCKWAVE LAYER */}
      <ProximityRipple triggerKey={rippleKey} color="#0A84FF" />

      {/* 3. POPPING AIRDROP HEADS-UP NOTIFICATION (Real Transfer Trigger) */}
      <AirDropNotification
        isOpen={isAirDropCardOpen}
        senderName={incomingTransferMeta.senderName}
        filesCount={1}
        totalSizeText={incomingTransferMeta.sizeFormatted}
        onAccept={handleAcceptRealTransfer}
        onDecline={handleDeclineRealTransfer}
        transferProgress={transferProgress}
        onDone={handleDoneTransfer}
      />

      {/* 4. DRAG & DROP OVERLAY */}
      {isDraggingOver && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(10, 132, 255, 0.15)',
            border: '3px dashed #0A84FF',
            zIndex: 99999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(10px)',
          }}
        >
          <div style={{ fontSize: '54px', marginBottom: '12px' }}>📥</div>
          <div style={{ fontSize: '22px', fontWeight: 900 }}>Drop files to stage for zero-copy AuraDrop transfer</div>
          <div style={{ fontSize: '13px', color: '#8E8E93', marginTop: '6px' }}>Streaming directly through native memory buffers</div>
        </div>
      )}

      {/* 5. MAIN WORKSPACE WITH DESKTOP SIDE RAIL */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* DESKTOP SIDE RAIL */}
        <SideRail
          currentView={currentView}
          onSelectView={(v) => {
            setCurrentView(v);
            if (v === 'chat') setIsChatOpen(true);
            if (v === 'settings') setIsSettingsOpen(true);
          }}
          activeTransfersCount={stagedFiles.length}
          localDeviceName={engine.localName}
        />

        {/* WORKSPACE CONTENT AREA */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* HEADER */}
          <header
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 28px',
              background: '#000000',
              borderBottom: '1px solid #1C1C1F',
              zIndex: 50,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '17px', fontWeight: 900, letterSpacing: '-0.4px' }}>AuraDrop</span>
              <span
                style={{
                  background: '#16161A',
                  border: '1px solid #242428',
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: '6px',
                  color: '#8E8E93',
                }}
              >
                v11.0 Production
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {/* Visibility Pill */}
              <div
                onClick={() => {
                  const modes: VisibilityMode[] = ['everyone', 'contacts', 'off'];
                  const next = modes[(modes.indexOf(visibility) + 1) % modes.length];
                  setVisibility(next);
                }}
                style={{
                  background: '#121214',
                  border: '1px solid #242428',
                  borderRadius: '16px',
                  padding: '6px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#FFFFFF',
                }}
              >
                <div
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: visibility !== 'off' ? '#34C759' : '#8E8E93',
                    boxShadow: visibility !== 'off' ? '0 0 8px #34C759' : 'none',
                  }}
                />
                <span style={{ textTransform: 'capitalize' }}>
                  {visibility === 'everyone' ? 'Everyone Nearby' : visibility === 'contacts' ? 'Contacts Only' : 'Receiving Off'}
                </span>
              </div>

              {/* Settings Tune Button */}
              <button
                onClick={() => setIsSettingsOpen(true)}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: '#121214',
                  border: '1px solid #242428',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#FFFFFF',
                  cursor: 'pointer',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
                  <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
                  <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
                </svg>
              </button>

              {/* Local Profile Badge */}
              <div
                onClick={() => setIsProfileOpen(true)}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: '#0A84FF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  color: '#FFFFFF',
                }}
              >
                {engine.localName.charAt(0)}
              </div>
            </div>
          </header>

          {/* DISCOVERY STATUS BAR */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 28px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#8E8E93',
              borderBottom: '1px solid #141416',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: peers.length > 0 ? '#34C759' : '#8E8E93',
                  boxShadow: peers.length > 0 ? '0 0 6px #34C759' : 'none',
                }}
              />
              <span>
                {visibility === 'off'
                  ? 'Receiving is turned off'
                  : peers.length === 0
                  ? 'Scanning for local AuraDrop peers... (Open another tab or device to test real P2P transfer)'
                  : peers.length === 1
                  ? '1 nearby device discovered'
                  : `${peers.length} nearby devices discovered`}
              </span>
            </div>

            <span style={{ fontSize: '11px', color: '#636366' }}>
              Local ID: {engine.localId}
            </span>
          </div>

          {/* MAIN VIEWPORT */}
          <main
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
              position: 'relative',
              overflowY: 'auto',
            }}
          >
            {currentView === 'diagnostics' ? (
              <DiagnosticsView />
            ) : currentView === 'history' ? (
              <div
                style={{
                  width: '100%',
                  maxWidth: '680px',
                  background: '#121214',
                  border: '1px solid #242428',
                  borderRadius: '20px',
                  padding: '24px',
                }}
              >
                <h3 style={{ fontSize: '16px', fontWeight: 800, marginBottom: '16px' }}>Transfer History Ledger</h3>
                {transferHistory.length === 0 ? (
                  <div style={{ fontSize: '13px', color: '#8E8E93', textAlign: 'center', padding: '32px 0' }}>
                    No completed transfers yet. Select a file and a peer to start a real P2P transfer.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {transferHistory.map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: '#16161A',
                          border: '1px solid #28282E',
                          borderRadius: '12px',
                          padding: '12px 16px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 700 }}>{item.fileName}</div>
                          <div style={{ fontSize: '11px', color: '#8E8E93', marginTop: '2px' }}>
                            {(item.fileSize / (1024 * 1024)).toFixed(1)} MB • {item.peerName} • {item.timestamp.toLocaleTimeString()}
                          </div>
                          {item.sha256 && (
                            <div style={{ fontSize: '10px', color: '#34C759', fontFamily: 'monospace', marginTop: '4px' }}>
                              SHA-256: {item.sha256.substring(0, 24)}...
                            </div>
                          )}
                        </div>
                        <span style={{ fontSize: '12px', color: '#34C759', fontWeight: 700 }}>✓ Verified</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* DEFAULT HOME: CENTERED 3D FIBONACCI GLOBE IN MIDDLE */
              <>
                <HeroGlobe
                  peers={peers}
                  selectedPeerId={selectedPeer?.id}
                  onSelectPeer={(p) => {
                    setSelectedPeer((prev) => (prev?.id === p.id ? null : p));
                    setRippleKey((prev) => prev + 1);
                  }}
                  isTransferring={transferProgress?.state === 'transferring'}
                  size={360}
                />

                {/* Selected Peer Card or Discovered Nearby List */}
                <div style={{ marginTop: '24px', width: '100%', maxWidth: '440px' }}>
                  {selectedPeer ? (
                    <div
                      style={{
                        background: '#121214',
                        border: '1px solid #242428',
                        borderRadius: '18px',
                        padding: '14px 18px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.6)',
                      }}
                    >
                      <div
                        style={{
                          width: '42px',
                          height: '42px',
                          borderRadius: '50%',
                          background: '#1E1E24',
                          border: '1.5px solid #0A84FF',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '16px',
                          fontWeight: 800,
                          color: '#FFFFFF',
                        }}
                      >
                        {selectedPeer.name.charAt(0)}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: '#FFFFFF' }}>{selectedPeer.name}</div>
                        <div style={{ fontSize: '11px', color: '#8E8E93', marginTop: '2px' }}>
                          {selectedPeer.deviceName}
                        </div>
                      </div>

                      <button
                        onClick={() => setIsChatOpen(true)}
                        title="Chat"
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '50%',
                          background: '#1C1C20',
                          border: '1px solid #2C2C32',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#FFFFFF',
                          cursor: 'pointer',
                        }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                      </button>

                      <button
                        onClick={handleSendRealFiles}
                        disabled={stagedFiles.length === 0}
                        style={{
                          background: stagedFiles.length > 0 ? '#0A84FF' : '#1C1C20',
                          border: 'none',
                          borderRadius: '16px',
                          padding: '8px 16px',
                          color: stagedFiles.length > 0 ? '#FFFFFF' : '#636366',
                          fontSize: '12px',
                          fontWeight: 800,
                          cursor: stagedFiles.length > 0 ? 'pointer' : 'not-allowed',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span>Send</span>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', fontSize: '12px', color: '#636366', padding: '12px' }}>
                      {peers.length === 0 ? (
                        <div>
                          No nearby peers discovered yet.
                          <div style={{ marginTop: '4px', color: '#0A84FF' }}>
                            Open AuraDrop in another tab to see instant real P2P discovery!
                          </div>
                        </div>
                      ) : (
                        'Tap a device node on the Globe to select transfer recipient.'
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </main>

          {/* DOCKED SHARE TRAY */}
          <DockedShareTray
            files={stagedFiles}
            onAddFiles={handleRealFilesStaged}
            onRemoveFile={handleRemoveStagedFile}
            selectedPeer={selectedPeer}
            onSend={handleSendRealFiles}
          />
        </div>
      </div>

      {/* MODALS */}
      <ChatModal isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} peer={selectedPeer} />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        visibility={visibility}
        onVisibilityChange={setVisibility}
      />
      <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} deviceName={engine.localName} />
    </div>
  );
};
