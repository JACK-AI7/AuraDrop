import React, { useState, useEffect, useRef } from 'react';
import { GitHubStarBar } from './components/GitHubStarBar';
import { FloatingSideRail, ActiveTab } from './components/FloatingSideRail';
import { DockedShareTray } from './components/DockedShareTray';
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

  // Navigation tab state
  const [currentTab, setCurrentTab] = useState<ActiveTab>('globe');
  const [visibility, setVisibility] = useState<VisibilityMode>('everyone');

  // Real Discovered Peers from TransferEngine
  const [peers, setPeers] = useState<PeerDevice[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<PeerDevice | null>(null);

  // Staged Files for Transfer
  const [stagedFiles, setStagedFiles] = useState<PickedFile[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Real Incoming Request State (Clean Apple/Linear prompt, zero fake Dynamic Island)
  const [incomingRequest, setIncomingRequest] = useState<{
    transferId: string;
    senderName: string;
    fileName: string;
    fileSize: number;
    sha256?: string;
  } | null>(null);

  // Active Real Transfer Progress (live byte counters & MB/s)
  const [transferProgress, setTransferProgress] = useState<TransferProgress | null>(null);

  // Real Transfer History loaded from persistent TransferStorage
  const [transferHistory, setTransferHistory] = useState<TransferRecord[]>(() => storage.getHistory());

  // Modals for deep workflows (all float cleanly over single-page layout)
  const [isPairModalOpen, setIsPairModalOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);

  // ---------------------------------------------------------------------------
  // SUBSCRIBE TO REAL ENGINE EVENTS (Zero simulation, authoritative data plane)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // 1. Peer discovery subscription (prioritizes Android mobile devices)
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
      if (evt.type === 'request') {
        setIncomingRequest({
          transferId: evt.transferId,
          senderName: evt.senderName,
          fileName: evt.fileName,
          fileSize: evt.fileSize,
          sha256: evt.sha256,
        });
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
          isIncoming: evt.transferredBytes !== undefined,
          peerName: evt.senderName,
          transport: evt.transport || 'Direct LAN',
          sha256: evt.sha256,
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
        setIncomingRequest(null);
        // Refresh persistent history ledger
        setTransferHistory(storage.getHistory());
      } else if (evt.type === 'error') {
        alert(evt.error || 'Transfer error occurred');
        setIncomingRequest(null);
        setTransferProgress(null);
      }
    });

    return () => {
      unsubscribePeers();
      unsubscribeEvents();
    };
  }, [engine, storage]);

  // ---------------------------------------------------------------------------
  // REAL DRAG & DROP PIPELINE
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
  };

  const handleRemoveStagedFile = (id: string) => {
    setStagedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // ---------------------------------------------------------------------------
  // REAL SEND & TRANSFER ACTIONS
  // ---------------------------------------------------------------------------
  const handleSendRealFiles = async () => {
    if (!selectedPeer || stagedFiles.length === 0) return;
    const fileToTransfer = stagedFiles[0]?.file;
    if (!fileToTransfer) return;

    try {
      await engine.startOutgoingTransfer(selectedPeer, fileToTransfer);
      // Remove successfully queued file from staging tray
      setStagedFiles((prev) => prev.slice(1));
    } catch (err: any) {
      alert(`Transfer failed: ${err.message}`);
    }
  };

  const handleAcceptRealTransfer = () => {
    engine.acceptIncomingTransfer();
    setIncomingRequest(null);
  };

  const handleDeclineRealTransfer = () => {
    engine.declineIncomingTransfer();
    setIncomingRequest(null);
    setTransferProgress(null);
  };

  const handleCancelActiveTransfer = () => {
    engine.cancelActiveTransfer();
    setTransferProgress(null);
  };

  const handleRescan = () => {
    try {
      engine.getSignalingClient().requestPeerList();
    } catch (_) {}
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
      {/* 1. TOP GITHUB STAR BANNER (Restored from 8dabf0c) */}
      <GitHubStarBar />

      {/* 2. DRAG & DROP OVERLAY (Apple Minimal Monochrome) */}
      {isDraggingOver && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.85)',
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
          <div style={{ fontSize: '22px', fontWeight: 900, color: '#FFFFFF' }}>
            Drop files to stage for direct AuraDrop transfer
          </div>
          <div style={{ fontSize: '13px', color: '#A1A1AA', marginTop: '6px' }}>
            Transfers go directly via LAN HTTP Turbo or WebRTC Direct
          </div>
        </div>
      )}

      {/* 3. FLOATING 5-DOT VERTICAL PILL SIDE RAIL (Restored from 8dabf0c) */}
      <FloatingSideRail
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setCurrentTab('globe');
          if (tab === 'devices') setIsPairModalOpen(true);
          else if (tab === 'transfers') setIsHistoryOpen(true);
          else if (tab === 'chat') {
            if (selectedPeer) setIsChatOpen(true);
            else if (peers.length > 0) {
              setSelectedPeer(peers[0]);
              setIsChatOpen(true);
            } else {
              setIsPairModalOpen(true);
            }
          } else if (tab === 'specs') setIsDiagnosticsOpen(true);
        }}
        activeTransfersCount={stagedFiles.length}
        discoveredPeersCount={peers.length}
      />

      {/* 4. MINIMAL HEADER */}
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
            v21 Production
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
            title="AuraDrop Settings"
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
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="4" y1="21" x2="4" y2="14" />
              <line x1="4" y1="10" x2="4" y2="3" />
              <line x1="12" y1="21" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12" y2="3" />
              <line x1="20" y1="21" x2="20" y2="16" />
              <line x1="20" y1="12" x2="20" y2="3" />
              <line x1="1" y1="14" x2="7" y2="14" />
              <line x1="9" y1="8" x2="15" y2="8" />
              <line x1="17" y1="16" x2="23" y2="16" />
            </svg>
          </button>

          {/* Local Device Avatar */}
          <div
            onClick={() => setIsProfileOpen(true)}
            title={`Local Identity: ${engine.localName}`}
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

      {/* 5. DISCOVERY STATUS BAR */}
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
                ? `Connected to ${selectedPeer.name} — direct secure channel ready`
                : selectedPeer.connectionState === 'CONNECTING'
                ? `Connecting to ${selectedPeer.name}...`
                : `Device discovered: ${selectedPeer.name}`
              : peers.length === 0
              ? 'Listening for AuraDrop Android App & nearby devices...'
              : peers.length === 1
              ? '1 device nearby'
              : `${peers.length} devices nearby`}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '11px', color: '#636366' }}>{engine.localName}</span>
          <button
            onClick={() => setIsDiagnosticsOpen(true)}
            title="Inspect Live WebRTC & LAN Diagnostics"
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
            ●{' '}
            {selectedPeer?.connectionState === 'READY_TO_TRANSFER'
              ? `${selectedPeer.name.toUpperCase()} • READY TO TRANSFER`
              : selectedPeer?.connectionState === 'CONNECTING'
              ? `CONNECTING TO ${selectedPeer.name.toUpperCase()}...`
              : visibility === 'off'
              ? 'RECEIVING OFF'
              : 'RECEIVING ENABLED'}
          </button>
        </div>
      </div>

      {/* 6. MAIN VIEWPORT — AUTHORITATIVE NEARBY DEVICES DISCOVERY (ZERO FAKE GLOBE / FAKE RADAR) */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          position: 'relative',
          overflowY: 'auto',
          padding: '28px 24px 120px 24px',
        }}
      >
        <div style={{ width: '100%', maxWidth: '640px', zIndex: 10 }}>
          {/* Section Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '18px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1
                style={{
                  fontSize: '16px',
                  fontWeight: 800,
                  letterSpacing: '-0.3px',
                  color: '#FFFFFF',
                  margin: 0,
                }}
              >
                Nearby Devices
              </h1>
              <span
                style={{
                  background: peers.length > 0 ? 'rgba(52, 199, 89, 0.15)' : '#16161A',
                  border: peers.length > 0 ? '1px solid rgba(52, 199, 89, 0.4)' : '1px solid #28282E',
                  borderRadius: '12px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: peers.length > 0 ? '#34C759' : '#8E8E93',
                }}
              >
                {peers.length > 0 ? `${peers.length} Online` : 'Scanning'}
              </span>
            </div>

            <button
              onClick={handleRescan}
              title="Rescan Local Network & Signaling"
              style={{
                background: '#121216',
                border: '1px solid #24242A',
                borderRadius: '10px',
                color: '#A1A1AA',
                fontSize: '11px',
                fontWeight: 600,
                padding: '5px 11px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#FFFFFF')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#A1A1AA')}
            >
              <span>↻</span>
              <span>Rescan</span>
            </button>
          </div>

          {/* 7. REAL INCOMING REQUEST CARD (High Priority) */}
          {incomingRequest && (
            <div
              style={{
                background: '#111812',
                border: '1.5px solid #34C759',
                borderRadius: '18px',
                padding: '18px 20px',
                marginBottom: '18px',
                boxShadow: '0 12px 36px rgba(52, 199, 89, 0.18)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#34C759',
                      boxShadow: '0 0 8px #34C759',
                    }}
                  />
                  <span style={{ fontSize: '13px', fontWeight: 800, color: '#FFFFFF' }}>
                    Incoming Transfer Request
                  </span>
                </div>
                <span style={{ fontSize: '11px', color: '#8E8E93' }}>
                  From: <strong style={{ color: '#FFFFFF' }}>{incomingRequest.senderName}</strong>
                </span>
              </div>

              <div
                style={{
                  background: '#172218',
                  borderRadius: '12px',
                  padding: '12px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF' }}>
                    {incomingRequest.fileName}
                  </div>
                  <div style={{ fontSize: '11px', color: '#A1A1AA', marginTop: '2px' }}>
                    Size: {formatBytes(incomingRequest.fileSize)}
                    {incomingRequest.sha256 && (
                      <span style={{ marginLeft: '8px', fontFamily: 'monospace', color: '#34C759' }}>
                        SHA-256: {incomingRequest.sha256.substring(0, 12)}...
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  onClick={handleDeclineRealTransfer}
                  style={{
                    background: '#1F2024',
                    border: '1px solid #323238',
                    borderRadius: '12px',
                    padding: '8px 16px',
                    color: '#FF453A',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Decline
                </button>
                <button
                  onClick={handleAcceptRealTransfer}
                  style={{
                    background: '#34C759',
                    border: 'none',
                    borderRadius: '12px',
                    padding: '8px 20px',
                    color: '#000000',
                    fontSize: '12px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  Accept & Stream
                </button>
              </div>
            </div>
          )}

          {/* 8. REAL ACTIVE TRANSFER CARD (Live Byte Counters & Live MB/s) */}
          {transferProgress && (
            <div
              style={{
                background: '#111115',
                border: '1.5px solid #2C2C34',
                borderRadius: '18px',
                padding: '16px 20px',
                marginBottom: '18px',
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.7)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      background:
                        transferProgress.state === 'COMPLETED'
                          ? 'rgba(52, 199, 89, 0.2)'
                          : 'rgba(255, 255, 255, 0.1)',
                      border:
                        transferProgress.state === 'COMPLETED'
                          ? '1px solid rgba(52, 199, 89, 0.5)'
                          : '1px solid rgba(255, 255, 255, 0.2)',
                      color: transferProgress.state === 'COMPLETED' ? '#34C759' : '#FFFFFF',
                      fontSize: '10px',
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: '8px',
                    }}
                  >
                    {transferProgress.state}
                  </span>
                  <span style={{ fontSize: '13px', fontWeight: 800, color: '#FFFFFF' }}>
                    {transferProgress.fileName}
                  </span>
                </div>

                <span
                  style={{
                    fontSize: '11px',
                    color: '#34C759',
                    fontWeight: 700,
                  }}
                >
                  {transferProgress.transport || '⚡ Direct LAN'}
                </span>
              </div>

              {/* Progress Bar */}
              <div
                style={{
                  width: '100%',
                  height: '6px',
                  background: '#1F1F24',
                  borderRadius: '3px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${
                      transferProgress.fileSize > 0
                        ? Math.min(100, (transferProgress.transferredBytes / transferProgress.fileSize) * 100)
                        : 0
                    }%`,
                    background:
                      transferProgress.state === 'COMPLETED'
                        ? '#34C759'
                        : 'linear-gradient(90deg, #34C759 0%, #FFFFFF 100%)',
                    transition: 'width 0.2s linear',
                  }}
                />
              </div>

              {/* Stats Row */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '11px',
                  color: '#8E8E93',
                }}
              >
                <div>
                  {formatBytes(transferProgress.transferredBytes)} / {formatBytes(transferProgress.fileSize)} (
                  {transferProgress.fileSize > 0
                    ? Math.round((transferProgress.transferredBytes / transferProgress.fileSize) * 100)
                    : 0}
                  %)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {transferProgress.speedBytesPerSec > 0 && (
                    <span style={{ color: '#FFFFFF', fontWeight: 700 }}>
                      {(transferProgress.speedBytesPerSec / (1024 * 1024)).toFixed(1)} MB/s
                    </span>
                  )}
                  {transferProgress.etaSeconds > 0 && <span>ETA: {transferProgress.etaSeconds}s</span>}
                  {transferProgress.sha256 && (
                    <span style={{ color: '#34C759', fontFamily: 'monospace' }}>
                      SHA-256 ✓
                    </span>
                  )}
                </div>
              </div>

              {/* Controls */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '4px' }}>
                {transferProgress.state === 'COMPLETED' ? (
                  <button
                    onClick={() => setTransferProgress(null)}
                    style={{
                      background: '#1C1C22',
                      border: '1px solid #2E2E36',
                      borderRadius: '10px',
                      padding: '6px 16px',
                      color: '#FFFFFF',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Done
                  </button>
                ) : (
                  <button
                    onClick={handleCancelActiveTransfer}
                    style={{
                      background: '#1F1F24',
                      border: '1px solid #32323A',
                      borderRadius: '10px',
                      padding: '6px 14px',
                      color: '#FF453A',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel Transfer
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 9. DISCOVERED PEER CARDS (Section 3: Nearby Devices Cards) */}
          {peers.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {peers.map((peer) => {
                const isSelected = selectedPeer?.id === peer.id;
                const isAndroid = peer.platform === 'android';
                const isLanReady = Boolean(peer.localIp || (peer as any).lanIp || peer.capabilities?.includes('lan_http_turbo'));
                const endpointText = (peer.localIp || (peer as any).lanIp)
                  ? `${peer.localIp || (peer as any).lanIp}:${peer.localPort || (peer as any).lanPort || 53317}`
                  : 'WebRTC Direct P2P';

                return (
                  <div
                    key={peer.id}
                    onClick={() => {
                      setSelectedPeer(peer);
                      engine.connectToPeer(peer);
                    }}
                    style={{
                      background: isSelected ? '#16161C' : '#0F0F13',
                      border: isSelected ? '1.5px solid #FFFFFF' : '1px solid #222228',
                      borderRadius: '18px',
                      padding: '14px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px',
                      cursor: 'pointer',
                      boxShadow: isSelected
                        ? '0 8px 30px rgba(255, 255, 255, 0.08)'
                        : '0 4px 20px rgba(0, 0, 0, 0.6)',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {/* Avatar / Device Monogram */}
                    <div
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '50%',
                        background: isAndroid ? '#132317' : '#1C1C22',
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 800, color: '#FFFFFF' }}>
                          {peer.name}
                        </span>
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
                        {peer.deviceName} • {endpointText}
                      </div>

                      <div style={{ marginTop: '5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {isLanReady ? (
                          <span
                            style={{
                              background: 'rgba(52, 199, 89, 0.1)',
                              color: '#34C759',
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '5px',
                            }}
                          >
                            ⚡ Direct LAN (Ready)
                          </span>
                        ) : (
                          <span
                            style={{
                              background: 'rgba(255, 255, 255, 0.08)',
                              color: '#CCCCCC',
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '5px',
                            }}
                          >
                            🔗 WebRTC Direct P2P
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Quick Chat Action */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPeer(peer);
                        setIsChatOpen(true);
                      }}
                      title="Direct Encrypted Chat"
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        background: '#1C1C22',
                        border: '1px solid #2E2E36',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#FFFFFF',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                    </button>

                    {/* Send Files Action */}
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
                        background: isSelected && stagedFiles.length > 0 ? '#FFFFFF' : '#1C1C22',
                        border: isSelected && stagedFiles.length > 0 ? 'none' : '1px solid #2E2E36',
                        borderRadius: '14px',
                        padding: '8px 16px',
                        color: isSelected && stagedFiles.length > 0 ? '#000000' : '#FFFFFF',
                        fontSize: '12px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        flexShrink: 0,
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <span>
                        {isSelected && stagedFiles.length > 0
                          ? `Send (${stagedFiles.length})`
                          : 'Send Files'}
                      </span>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="12" y1="19" x2="12" y2="5" />
                        <polyline points="5 12 12 5 19 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Empty State: Listening for Android Phone */
            <div
              style={{
                background: '#0D0D11',
                border: '1px solid #202026',
                borderRadius: '20px',
                padding: '28px 24px',
                textAlign: 'center',
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.7)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  marginBottom: '10px',
                }}
              >
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#34C759',
                    boxShadow: '0 0 8px #34C759',
                  }}
                />
                <span style={{ fontSize: '14px', fontWeight: 800, color: '#FFFFFF' }}>
                  Listening for AuraDrop Android App
                </span>
              </div>
              <p
                style={{
                  fontSize: '12px',
                  color: '#8E8E93',
                  margin: '0 auto 16px auto',
                  lineHeight: '1.5',
                  maxWidth: '420px',
                }}
              >
                Open the AuraDrop Android app on your phone connected to this Wi-Fi. Real devices
                appear here automatically with zero configuration.
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
                  padding: '9px 20px',
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
      </main>

      {/* 10. DOCKED SHARE TRAY AT BOTTOM (Restored from 8dabf0c) */}
      <DockedShareTray
        files={stagedFiles}
        onAddFiles={handleRealFilesStaged}
        onRemoveFile={handleRemoveStagedFile}
        selectedPeer={selectedPeer}
        onSend={handleSendRealFiles}
      />

      {/* 11. MODALS (Floating over single-page layout) */}
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
      <DiagnosticsModal isOpen={isDiagnosticsOpen} onClose={() => setIsDiagnosticsOpen(false)} />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        visibility={visibility}
        onVisibilityChange={setVisibility}
      />
      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        deviceName={engine.localName}
      />
    </div>
  );
};
