import React, { useState, useEffect } from 'react';
import { GitHubStarBar } from './components/GitHubStarBar';
import { FloatingSideRail, ActiveTab } from './components/FloatingSideRail';
import { HeroGlobe } from './components/HeroGlobe';
import { AirDropNotification } from './components/AirDropNotification';
import { FluidProximityAura } from './components/FluidProximityAura';
import { ChatView } from './components/ChatView';
import { DockedShareTray } from './components/DockedShareTray';
import { DiagnosticsView } from './components/DiagnosticsView';
import { DevicePairModal } from './components/DevicePairModal';
import {
  ChatModal,
  SettingsModal,
  ProfileModal,
  TransferHistoryModal,
  DiagnosticsModal,
} from './components/Modals';
import { TransferEngine, TransferEngineEvent } from './engine/transferEngine';
import { TransferStorage } from './engine/transferStorage';
import { PeerDevice, PickedFile, TransferProgress, TransferRecord, VisibilityMode } from './types';

export const App: React.FC = () => {
  const engine = TransferEngine.getInstance();
  const storage = TransferStorage.getInstance();

  // Navigation tab: 'globe' | 'transfers' | 'devices' | 'chat' | 'specs'
  const [currentTab, setCurrentTab] = useState<ActiveTab>('globe');
  const [visibility, setVisibility] = useState<VisibilityMode>('everyone');

  // Real Discovered Peers from TransferEngine
  const [peers, setPeers] = useState<PeerDevice[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<PeerDevice | null>(null);

  // Staged Real Files
  const [stagedFiles, setStagedFiles] = useState<PickedFile[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Real Incoming Request Meta for the popping AirDrop card
  const [incomingMeta, setIncomingMeta] = useState<{
    transferId: string;
    senderName: string;
    senderAvatarUrl?: string | null;
    fileName: string;
    fileSize: number;
    sizeFormatted: string;
    isOpen: boolean;
  }>({
    transferId: '',
    senderName: '',
    senderAvatarUrl: null,
    fileName: '',
    fileSize: 0,
    sizeFormatted: '',
    isOpen: false,
  });

  // Real Transfer Progress
  const [transferProgress, setTransferProgress] = useState<TransferProgress | null>(null);

  // Real Transfer History loaded from persistent TransferStorage
  const [transferHistory, setTransferHistory] = useState<TransferRecord[]>(() => storage.getHistory());

  // Proximity shockwave ripple trigger & fluid light-ripple aura state
  const [rippleKey, setRippleKey] = useState(0);
  const [isAuraActive, setIsAuraActive] = useState(false);

  // Modals (Keep experience 100% on this single page)
  const [isPairModalOpen, setIsPairModalOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);

  // ---------------------------------------------------------------------------
  // SUBSCRIBE TO REAL ENGINE EVENTS
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // 1. Peer discovery subscription (prioritize Android mobile app)
    const unsubscribePeers = engine.onPeersUpdated((updatedPeers) => {
      setPeers(updatedPeers);
      setSelectedPeer((prev) => {
        const androidPeer = updatedPeers.find((p) => p.platform === 'android');
        if (androidPeer) return androidPeer;
        if (!prev) return updatedPeers[0] || null;
        const exists = updatedPeers.find((p) => p.id === prev.id);
        return exists || updatedPeers[0] || null;
      });
    });

    // 2. Real transfer event subscription
    const unsubscribeEvents = engine.onEngineEvent((evt: TransferEngineEvent) => {
      setRippleKey((prev) => prev + 1);

      if (evt.type === 'request') {
        const formatted =
          evt.fileSize < 1024 * 1024
            ? `${(evt.fileSize / 1024).toFixed(1)} KB`
            : `${(evt.fileSize / (1024 * 1024)).toFixed(1)} MB`;

        setIncomingMeta({
          transferId: evt.transferId,
          senderName: evt.senderName,
          senderAvatarUrl: (evt as any).senderAvatarUrl || null,
          fileName: evt.fileName,
          fileSize: evt.fileSize,
          sizeFormatted: formatted,
          isOpen: true,
        });
        setIsAuraActive(true);
      } else if (evt.type === 'progress') {
        setTransferProgress({
          transferId: evt.transferId,
          fileName: evt.fileName,
          fileSize: evt.fileSize,
          transferredBytes: evt.transferredBytes || 0,
          verifiedBytes: evt.verifiedBytes || 0,
          speedBytesPerSec: evt.speedBytesPerSec || 0,
          etaSeconds: evt.etaSeconds || 0,
          state: evt.state || 'TRANSFERRING',
          isIncoming: true,
          peerName: evt.senderName,
        });
      } else if (evt.type === 'completed') {
        setTransferProgress((prev) =>
          prev
            ? {
                ...prev,
                transferredBytes: evt.fileSize,
                verifiedBytes: evt.fileSize,
                state: 'COMPLETED',
                sha256: evt.sha256,
              }
            : null
        );
        // Refresh transfer history ledger
        setTransferHistory(storage.getHistory());
      } else if (evt.type === 'error') {
        alert(evt.error || 'Transfer error occurred');
        setIncomingMeta((prev) => ({ ...prev, isOpen: false }));
        setTransferProgress(null);
      }
    });

    return () => {
      unsubscribePeers();
      unsubscribeEvents();
    };
  }, [engine, storage]);

  // ---------------------------------------------------------------------------
  // REAL DRAG & DROP
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
  // REAL SEND & REAL ACCEPT PIPELINES
  // ---------------------------------------------------------------------------
  const handleSendRealFiles = async () => {
    if (!selectedPeer || stagedFiles.length === 0) return;
    const fileToTransfer = stagedFiles[0]?.file;
    if (!fileToTransfer) return;

    setRippleKey((prev) => prev + 1);
    setIsAuraActive(true);

    try {
      await engine.startOutgoingTransfer(selectedPeer, fileToTransfer);
      // Remove sent file from staging tray
      setStagedFiles((prev) => prev.slice(1));
    } catch (err: any) {
      alert(`Transfer failed: ${err.message}`);
    }
  };

  const handleAcceptRealTransfer = () => {
    engine.acceptIncomingTransfer();
    setRippleKey((prev) => prev + 1);
    setIsAuraActive(true);
  };

  const handleDeclineRealTransfer = () => {
    engine.declineIncomingTransfer();
    setIncomingMeta((prev) => ({ ...prev, isOpen: false }));
    setTransferProgress(null);
  };

  const handleDoneTransfer = () => {
    setIncomingMeta((prev) => ({ ...prev, isOpen: false }));
    setTransferProgress(null);
  };

  return (
    <div
      style={{
        background: '#000000',
        color: '#FFFFFF',
        height: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        overflow: 'hidden',
        position: 'relative',
        userSelect: 'none',
      }}
    >
      {/* 1. TOP GITHUB STAR BANNER */}
      <GitHubStarBar />

      {/* 2. FLUID PROXIMITY LIGHT-RIPPLE AURA (Apple NameDrop Image 1 Reference) */}
      <FluidProximityAura
        isActive={isAuraActive}
        onAnimationComplete={() => setIsAuraActive(false)}
      />

      {/* 3. APPLE AIRDROP DYNAMIC ISLAND FLOATING PILL (Images 2 & 3 References) */}
      <AirDropNotification
        isOpen={incomingMeta.isOpen}
        senderName={incomingMeta.senderName}
        senderAvatarUrl={incomingMeta.senderAvatarUrl}
        filesCount={1}
        fileName={incomingMeta.fileName}
        totalSizeText={incomingMeta.sizeFormatted}
        onAccept={handleAcceptRealTransfer}
        onDecline={handleDeclineRealTransfer}
        transferProgress={transferProgress}
        onDone={handleDoneTransfer}
      />

      {/* 4. DRAG & DROP OVERLAY (Apple Minimal Monochrome) */}
      {isDraggingOver && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(255, 255, 255, 0.08)',
            border: '2px dashed #FFFFFF',
            zIndex: 99999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(16px)',
          }}
        >
          <div style={{ fontSize: '54px', marginBottom: '12px' }}>📥</div>
          <div style={{ fontSize: '22px', fontWeight: 900, color: '#FFFFFF' }}>Drop files to stage for zero-copy AuraDrop transfer</div>
          <div style={{ fontSize: '13px', color: '#A1A1AA', marginTop: '6px' }}>Streaming directly through native WebRTC memory buffers</div>
        </div>
      )}

      {/* 5. FLOATING 5-DOT VERTICAL PILL SIDE RAIL (Media Reference 1791373512430) */}
      <FloatingSideRail
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setCurrentTab('globe');
          if (tab === 'devices') setIsPairModalOpen(true);
          else if (tab === 'transfers') setIsHistoryOpen(true);
          else if (tab === 'chat') setIsChatOpen(true);
          else if (tab === 'specs') setIsDiagnosticsOpen(true);
        }}
        activeTransfersCount={stagedFiles.length}
        discoveredPeersCount={peers.length}
      />

      {/* 6. MINIMAL HEADER */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 28px',
          background: '#000000',
          borderBottom: '1px solid #141416',
          zIndex: 40,
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
          {/* Pair Mobile Device Action Pill */}
          <button
            onClick={() => setIsPairModalOpen(true)}
            title="Pair with Android Mobile App"
            style={{
              background: '#16161A',
              border: '1px solid #242428',
              borderRadius: '16px',
              padding: '6px 14px',
              color: '#FFFFFF',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#FFFFFF')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#242428')}
          >
            <span>📱</span>
            Pair Mobile App
          </button>

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
              {visibility === 'everyone' ? 'Everyone Nearby' : visibility === 'contacts' ? 'Contacts' : 'Off'}
            </span>
          </div>

          {/* Settings Button */}
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

          {/* Local Device Avatar */}
          <div
            onClick={() => setIsProfileOpen(true)}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: '#27272A',
              border: '1px solid #3F3F46',
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

      {/* 7. DISCOVERY STATUS BAR (Section 31 & 32: Truth in Status) */}
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
          zIndex: 30,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background:
                visibility === 'off'
                  ? '#8E8E93'
                  : selectedPeer?.connectionState === 'READY_TO_TRANSFER'
                  ? '#34C759'
                  : selectedPeer?.connectionState === 'CONNECTING'
                  ? '#FF9F0A'
                  : peers.length > 0
                  ? '#34C759'
                  : '#A1A1AA',
              boxShadow:
                peers.length > 0
                  ? '0 0 6px #34C759'
                  : visibility !== 'off'
                  ? '0 0 6px rgba(255, 255, 255, 0.4)'
                  : 'none',
            }}
          />
          <span>
            {visibility === 'off'
              ? 'Receiving is turned off'
              : selectedPeer
              ? selectedPeer.connectionState === 'READY_TO_TRANSFER'
                ? `Connected to ${selectedPeer.name} — secure channel verified`
                : selectedPeer.connectionState === 'CONNECTING' || selectedPeer.connectionState === 'SIGNALING'
                ? `Connecting to ${selectedPeer.name}...`
                : selectedPeer.connectionState === 'DATA_CHANNEL_HEALTH_CHECK'
                ? `Verifying secure connection with ${selectedPeer.name}...`
                : `Device discovered: ${selectedPeer.name}`
              : peers.length === 0
              ? 'Scanning for AuraDrop devices and Android mobile apps...'
              : peers.length === 1
              ? '1 device nearby'
              : `${peers.length} devices nearby`}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '11px', color: '#636366' }}>{engine.localName}</span>
          <button
            onClick={() => setIsDiagnosticsOpen(true)}
            title="Inspect Live WebRTC Diagnostics"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              color:
                selectedPeer?.connectionState === 'READY_TO_TRANSFER'
                  ? '#34C759'
                  : selectedPeer?.connectionState === 'CONNECTING'
                  ? '#FF9F0A'
                  : peers.length > 0
                  ? '#34C759'
                  : '#8E8E93',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            ● {selectedPeer?.connectionState === 'READY_TO_TRANSFER'
                ? `${selectedPeer.name.toUpperCase()} • READY TO TRANSFER`
                : selectedPeer?.connectionState === 'CONNECTING'
                ? `CONNECTING TO ${selectedPeer.name.toUpperCase()}...`
                : selectedPeer?.connectionState === 'DATA_CHANNEL_HEALTH_CHECK'
                ? 'VERIFYING CHANNEL...'
                : visibility === 'off'
                ? 'RECEIVING OFF'
                : 'RECEIVING ENABLED'}
          </button>
        </div>
      </div>

      {/* 8. MAIN VIEWPORT — DEAD CENTER GLOBE WITH LIVE DISCOVERED PEERS (SINGLE PAGE ONLY) */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
          padding: '0 20px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
          }}
        >
          <HeroGlobe
            peers={peers}
            selectedPeerId={selectedPeer?.id}
            onSelectPeer={(p) => {
              setSelectedPeer((prev) => {
                const next = prev?.id === p.id ? null : p;
                if (next) {
                  engine.connectToPeer(next);
                  setIsAuraActive(true);
                }
                return next;
              });
              setRippleKey((prev) => prev + 1);
            }}
            isTransferring={transferProgress?.state === 'TRANSFERRING'}
            size={340}
          />

          {/* Active Discovered Devices Panel — Displayed directly on this same page */}
          <div style={{ marginTop: '16px', width: '100%', maxWidth: '480px', zIndex: 10 }}>
            {peers.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {peers.map((peer) => {
                  const isSelected = selectedPeer?.id === peer.id;
                  const isAndroid = peer.platform === 'android';
                  return (
                    <div
                      key={peer.id}
                      onClick={() => {
                        setSelectedPeer(peer);
                        engine.connectToPeer(peer);
                      }}
                      style={{
                        background: isSelected ? '#16161A' : '#101014',
                        border: isSelected ? '1.5px solid #FFFFFF' : '1px solid #242428',
                        borderRadius: '18px',
                        padding: '12px 18px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        cursor: 'pointer',
                        boxShadow: isSelected
                          ? '0 8px 30px rgba(255, 255, 255, 0.08)'
                          : '0 4px 20px rgba(0, 0, 0, 0.6)',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      {/* Avatar / Device Icon */}
                      <div
                        style={{
                          width: '42px',
                          height: '42px',
                          borderRadius: '50%',
                          background: isAndroid ? '#152419' : '#1E1E24',
                          border: isAndroid ? '1.5px solid #34C759' : '1.5px solid #3F3F46',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '18px',
                          fontWeight: 800,
                          color: isAndroid ? '#34C759' : '#FFFFFF',
                          flexShrink: 0,
                        }}
                      >
                        {isAndroid ? '📱' : peer.name.charAt(0)}
                      </div>

                      {/* Peer Details */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '14px', fontWeight: 800, color: '#FFFFFF' }}>{peer.name}</span>
                          {isAndroid && (
                            <span
                              style={{
                                background: 'rgba(52, 199, 89, 0.15)',
                                border: '1px solid rgba(52, 199, 89, 0.4)',
                                color: '#34C759',
                                fontSize: '10px',
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: '6px',
                              }}
                            >
                              Android Phone
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '11px', color: '#8E8E93', marginTop: '2px' }}>
                          {peer.deviceName} • WebRTC Direct P2P
                        </div>
                      </div>

                      {/* Quick Chat action (Opens modal over this page) */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPeer(peer);
                          setIsChatOpen(true);
                        }}
                        title="Direct Encrypted Chat"
                        style={{
                          width: '34px',
                          height: '34px',
                          borderRadius: '50%',
                          background: '#1C1C20',
                          border: '1px solid #2C2C32',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#FFFFFF',
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                      </button>

                      {/* Send Files action */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPeer(peer);
                          if (stagedFiles.length > 0) {
                            handleSendRealFiles();
                          } else {
                            document.getElementById('docked-file-input')?.click();
                          }
                        }}
                        style={{
                          background: isSelected && stagedFiles.length > 0 ? '#FFFFFF' : '#1C1C20',
                          border: isSelected && stagedFiles.length > 0 ? 'none' : '1px solid #2C2C32',
                          borderRadius: '14px',
                          padding: '7px 14px',
                          color: isSelected && stagedFiles.length > 0 ? '#000000' : '#FFFFFF',
                          fontSize: '11px',
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          flexShrink: 0,
                          transition: 'all 0.2s ease',
                        }}
                      >
                        <span>{stagedFiles.length > 0 ? `Send (${stagedFiles.length})` : 'Send Files'}</span>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Listening for Android Phone */
              <div
                style={{
                  background: '#0F0F12',
                  border: '1px solid #222226',
                  borderRadius: '20px',
                  padding: '16px 20px',
                  textAlign: 'center',
                  boxShadow: '0 8px 30px rgba(0, 0, 0, 0.7)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '6px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#34C759', boxShadow: '0 0 8px #34C759' }} />
                  <span style={{ fontSize: '13px', fontWeight: 800, color: '#FFFFFF' }}>
                    Listening for AuraDrop Android App
                  </span>
                </div>
                <p style={{ fontSize: '12px', color: '#8E8E93', margin: '0 0 12px 0', lineHeight: '1.4' }}>
                  Open the AuraDrop Android app on your phone. Discovered devices appear here automatically with zero configuration.
                </p>
                <button
                  onClick={() => setIsPairModalOpen(true)}
                  style={{
                    background: '#FFFFFF',
                    border: 'none',
                    borderRadius: '12px',
                    color: '#000000',
                    fontSize: '12px',
                    fontWeight: 800,
                    padding: '8px 18px',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <span>📱</span>
                  <span>Pair Android Mobile App</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* 9. DOCKED SHARE TRAY AT BOTTOM */}
      <DockedShareTray
        files={stagedFiles}
        onAddFiles={handleRealFilesStaged}
        onRemoveFile={handleRemoveStagedFile}
        selectedPeer={selectedPeer}
        onSend={handleSendRealFiles}
      />

      {/* 10. MODALS (Floating over single page) */}
      <DevicePairModal
        isOpen={isPairModalOpen}
        onClose={() => setIsPairModalOpen(false)}
        localId={engine.localId}
        localName={engine.localName}
        peers={peers}
      />
      <ChatModal isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} peer={selectedPeer} />
      <TransferHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={transferHistory}
      />
      <DiagnosticsModal
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
      />
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
