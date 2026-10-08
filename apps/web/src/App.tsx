import React, { useState, useEffect, useRef } from 'react';
import { TransferEngine, TransferEngineEvent } from './engine/transferEngine';
import { TransferStorage } from './engine/transferStorage';
import { PeerDevice, PickedFile, TransferProgress, TransferRecord, VisibilityMode } from './types';
import { ChatView } from './components/ChatView';
import { DevicePairModal } from './components/DevicePairModal';
import {
  SettingsModal,
  ProfileModal,
  TransferHistoryModal,
  DiagnosticsModal,
} from './components/Modals';

export const App: React.FC = () => {
  const engine = TransferEngine.getInstance();
  const storage = TransferStorage.getInstance();

  // Peer State
  const [peers, setPeers] = useState<PeerDevice[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<PeerDevice | null>(null);
  const [visibility, setVisibility] = useState<VisibilityMode>('everyone');

  // Staged Files for Transfer
  const [stagedFiles, setStagedFiles] = useState<PickedFile[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Incoming Transfer Request State
  const [incomingRequest, setIncomingRequest] = useState<{
    transferId: string;
    senderName: string;
    fileName: string;
    fileSize: number;
    sha256?: string;
  } | null>(null);

  // Active Transfer Progress
  const [transferProgress, setTransferProgress] = useState<TransferProgress | null>(null);

  // Transfer History
  const [transferHistory, setTransferHistory] = useState<TransferRecord[]>(() => storage.getHistory());

  // UI Panels on the same page
  const [activeRightPanel, setActiveRightPanel] = useState<'chat' | 'history' | 'diagnostics'>('chat');
  const [isRightPanelExpanded, setIsRightPanelExpanded] = useState(true);

  // Modals for deep settings
  const [isPairModalOpen, setIsPairModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isDiagnosticsModalOpen, setIsDiagnosticsModalOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ---------------------------------------------------------------------------
  // SUBSCRIBE TO ENGINE EVENTS (Zero-simulation real data plane)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const unsubscribePeers = engine.onPeersUpdated((updatedPeers) => {
      setPeers(updatedPeers);
      setSelectedPeer((prev) => {
        if (!prev) {
          // Default to first Android device or first device
          const android = updatedPeers.find((p) => p.platform === 'android');
          return android || updatedPeers[0] || null;
        }
        const found = updatedPeers.find((p) => p.id === prev.id);
        return found || updatedPeers[0] || null;
      });
    });

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
        setTransferHistory(storage.getHistory());
      } else if (evt.type === 'error') {
        alert(evt.error || 'Transfer encountered an error');
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
  // FILE STAGING & DRAG-AND-DROP
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingOver(true);
    };
    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      if (e.relatedTarget === null) setIsDraggingOver(false);
    };
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingOver(false);
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        addFilesToStaging(e.dataTransfer.files);
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

  const addFilesToStaging = (fileList: FileList) => {
    const picked: PickedFile[] = Array.from(fileList).map((f) => ({
      id: `${f.name}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: f.name,
      size: f.size,
      type: f.type || 'application/octet-stream',
      file: f,
    }));
    setStagedFiles((prev) => [...prev, ...picked]);
  };

  const removeStagedFile = (id: string) => {
    setStagedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const clearStagedFiles = () => {
    setStagedFiles([]);
  };

  // ---------------------------------------------------------------------------
  // REAL TRANSFER ACTIONS (Direct LAN or WebRTC)
  // ---------------------------------------------------------------------------
  const handleSendToPeer = async (peer: PeerDevice, fileOverride?: File) => {
    const fileToSend = fileOverride || stagedFiles[0]?.file;
    if (!fileToSend) {
      fileInputRef.current?.click();
      return;
    }

    try {
      await engine.startOutgoingTransfer(peer, fileToSend);
      if (!fileOverride) {
        setStagedFiles((prev) => prev.slice(1));
      }
    } catch (err: any) {
      alert(`Transfer failed: ${err?.message || err}`);
    }
  };

  const handleAcceptIncoming = () => {
    engine.acceptIncomingTransfer();
    setIncomingRequest(null);
  };

  const handleDeclineIncoming = () => {
    engine.declineIncomingTransfer();
    setIncomingRequest(null);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatSpeed = (bytesPerSec: number) => {
    const mbps = bytesPerSec / (1024 * 1024);
    if (mbps >= 1) return `${mbps.toFixed(1)} MB/s`;
    const kbps = bytesPerSec / 1024;
    return `${kbps.toFixed(0)} KB/s`;
  };

  return (
    <div
      style={{
        background: '#09090B',
        color: '#FAFAFA',
        minHeight: '100vh',
        height: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            addFilesToStaging(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* DRAG-AND-DROP FULL-SCREEN OVERLAY */}
      {isDraggingOver && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(9, 9, 11, 0.88)',
            border: '2px dashed #FAFAFA',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📦</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#FFFFFF' }}>
            Drop files to transfer directly
          </div>
          <div style={{ fontSize: '13px', color: '#A1A1AA', marginTop: '6px' }}>
            Zero cloud storage • Direct LAN & WebRTC streaming
          </div>
        </div>
      )}

      {/* TOP BAR — Apple/Linear Monochrome Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 24px',
          background: '#09090B',
          borderBottom: '1px solid #18181B',
          zIndex: 50,
          flexShrink: 0,
        }}
      >
        {/* Brand & Client Identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              background: '#FFFFFF',
              color: '#000000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 900,
              fontSize: '14px',
              letterSpacing: '-0.5px',
            }}
          >
            A
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '16px', fontWeight: 800, letterSpacing: '-0.3px', color: '#FFFFFF' }}>
              AuraDrop
            </span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: '#71717A',
                letterSpacing: '0.2px',
              }}
            >
              V20 DIRECT
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: '#18181B',
              border: '1px solid #27272A',
              padding: '3px 9px',
              borderRadius: '12px',
              fontSize: '11px',
              color: '#A1A1AA',
            }}
          >
            <div
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: peers.length > 0 ? '#22C55E' : '#71717A',
                boxShadow: peers.length > 0 ? '0 0 6px #22C55E' : 'none',
              }}
            />
            <span>{peers.length > 0 ? `${peers.length} nearby` : 'Searching Wi-Fi / P2P'}</span>
          </div>
        </div>

        {/* Quick Actions & Profile */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Visibility Toggle */}
          <button
            onClick={() => {
              const modes: VisibilityMode[] = ['everyone', 'contacts', 'off'];
              const next = modes[(modes.indexOf(visibility) + 1) % modes.length];
              setVisibility(next);
            }}
            style={{
              background: '#18181B',
              border: '1px solid #27272A',
              borderRadius: '14px',
              padding: '5px 12px',
              color: '#D4D4D8',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'background 0.15s ease',
            }}
          >
            <div
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: visibility !== 'off' ? '#22C55E' : '#71717A',
              }}
            />
            <span style={{ textTransform: 'capitalize' }}>
              {visibility === 'everyone' ? 'Everyone Nearby' : visibility === 'contacts' ? 'Contacts' : 'Off'}
            </span>
          </button>

          {/* Pair Mobile Device */}
          <button
            onClick={() => setIsPairModalOpen(true)}
            style={{
              background: '#18181B',
              border: '1px solid #27272A',
              borderRadius: '14px',
              padding: '5px 12px',
              color: '#FFFFFF',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>📱</span>
            <span>Pair Mobile</span>
          </button>

          {/* Diagnostics Modal Toggle */}
          <button
            onClick={() => setIsDiagnosticsModalOpen(true)}
            style={{
              background: '#18181B',
              border: '1px solid #27272A',
              borderRadius: '14px',
              padding: '5px 10px',
              color: '#A1A1AA',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
            title="Inspect Data Plane & ICE Candidates"
          >
            Diagnostics
          </button>

          {/* Settings */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '50%',
              background: '#18181B',
              border: '1px solid #27272A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#A1A1AA',
              cursor: 'pointer',
            }}
            title="Settings"
          >
            ⚙
          </button>

          {/* Local User Avatar */}
          <div
            onClick={() => setIsProfileOpen(true)}
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '50%',
              background: '#27272A',
              border: '1px solid #3F3F46',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              fontWeight: 700,
              color: '#FFFFFF',
              cursor: 'pointer',
            }}
            title={`Local Device: ${engine.localName}`}
          >
            {engine.localName.charAt(0).toUpperCase()}
          </div>
        </div>
      </header>

      {/* INCOMING FILE TRANSFER CARD (Apple Heads-Up Dialog on this page) */}
      {incomingRequest && (
        <div
          style={{
            background: '#18181B',
            borderBottom: '1px solid #27272A',
            padding: '14px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 45,
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '12px',
                background: '#27272A',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '20px',
              }}
            >
              📥
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 700, color: '#FFFFFF' }}>
                  Incoming file from {incomingRequest.senderName}
                </span>
                <span
                  style={{
                    background: '#22C55E1A',
                    color: '#22C55E',
                    border: '1px solid #22C55E33',
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: '4px',
                  }}
                >
                  Direct Stream
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#A1A1AA', marginTop: '2px' }}>
                {incomingRequest.fileName} • {formatBytes(incomingRequest.fileSize)}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={handleDeclineIncoming}
              style={{
                background: '#27272A',
                border: '1px solid #3F3F46',
                borderRadius: '10px',
                padding: '8px 16px',
                color: '#D4D4D8',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Decline
            </button>
            <button
              onClick={handleAcceptIncoming}
              style={{
                background: '#FFFFFF',
                border: 'none',
                borderRadius: '10px',
                padding: '8px 20px',
                color: '#000000',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Accept
            </button>
          </div>
        </div>
      )}

      {/* ACTIVE TRANSFER PROGRESS BAR (Real byte counters & live MB/s) */}
      {transferProgress && transferProgress.state !== 'COMPLETED' && (
        <div
          style={{
            background: '#121215',
            borderBottom: '1px solid #27272A',
            padding: '12px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            zIndex: 40,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF' }}>
                {transferProgress.isIncoming ? 'Receiving' : 'Sending'} {transferProgress.fileName}
              </span>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  background: '#27272A',
                  color: '#A1A1AA',
                  padding: '2px 8px',
                  borderRadius: '6px',
                }}
              >
                {transferProgress.transport || 'Direct LAN'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12px', color: '#A1A1AA' }}>
              <span>
                {formatBytes(transferProgress.transferredBytes)} / {formatBytes(transferProgress.fileSize)}
              </span>
              <span style={{ color: '#FFFFFF', fontWeight: 700 }}>
                {formatSpeed(transferProgress.speedBytesPerSec)}
              </span>
              {transferProgress.etaSeconds > 0 && (
                <span>{transferProgress.etaSeconds}s left</span>
              )}
              <button
                onClick={() => engine.cancelActiveTransfer()}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#EF4444',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: '0 4px',
                }}
              >
                Cancel
              </button>
            </div>
          </div>

          {/* Progress Track */}
          <div
            style={{
              height: '4px',
              borderRadius: '2px',
              background: '#27272A',
              overflow: 'hidden',
              width: '100%',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.min(
                  100,
                  (transferProgress.transferredBytes / Math.max(1, transferProgress.fileSize)) * 100
                )}%`,
                background: '#FFFFFF',
                borderRadius: '2px',
                transition: 'width 0.1s linear',
              }}
            />
          </div>
        </div>
      )}

      {/* MAIN SINGLE-PAGE WORKSPACE (Left: Devices & Transfer Hub | Right: Integrated Real-time Chat) */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* LEFT COLUMN: DEVICES & DIRECT TRANSFER HUB */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px 28px',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            borderRight: '1px solid #18181B',
          }}
        >
          {/* SECTION 1: NEARBY DEVICES */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: '#FFFFFF', letterSpacing: '-0.2px' }}>
                  Nearby Devices
                </h2>
                <p style={{ fontSize: '12px', color: '#71717A', margin: '2px 0 0 0' }}>
                  Direct LAN HTTP Turbo & WebRTC P2P mesh
                </p>
              </div>

              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#71717A',
                }}
              >
                {peers.length} detected
              </span>
            </div>

            {peers.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                {peers.map((peer) => {
                  const isSelected = selectedPeer?.id === peer.id;
                  const isAndroid = peer.platform === 'android';
                  const hasLan = Boolean(peer.localIp && peer.localPort);

                  return (
                    <div
                      key={peer.id}
                      onClick={() => setSelectedPeer(peer)}
                      style={{
                        background: isSelected ? '#18181B' : '#121215',
                        border: isSelected ? '1px solid #52525B' : '1px solid #27272A',
                        borderRadius: '16px',
                        padding: '16px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div
                            style={{
                              width: '40px',
                              height: '40px',
                              borderRadius: '12px',
                              background: isAndroid ? '#18241C' : '#27272A',
                              border: isAndroid ? '1px solid #22C55E4D' : '1px solid #3F3F46',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: isAndroid ? '20px' : '15px',
                              fontWeight: 800,
                              color: isAndroid ? '#22C55E' : '#FFFFFF',
                            }}
                          >
                            {isAndroid ? '📱' : peer.name.charAt(0).toUpperCase()}
                          </div>

                          <div>
                            <div style={{ fontSize: '14px', fontWeight: 700, color: '#FFFFFF' }}>
                              {peer.name}
                            </div>
                            <div style={{ fontSize: '11px', color: '#71717A', marginTop: '2px' }}>
                              {peer.deviceName}
                            </div>
                          </div>
                        </div>

                        {/* Transport Badge */}
                        <div
                          style={{
                            background: hasLan ? '#22C55E1A' : '#27272A',
                            color: hasLan ? '#22C55E' : '#A1A1AA',
                            border: hasLan ? '1px solid #22C55E33' : '1px solid #3F3F46',
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <span>{hasLan ? '⚡ LAN Turbo' : '🔗 WebRTC P2P'}</span>
                        </div>
                      </div>

                      {/* Endpoint Details */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: '11px',
                          color: '#71717A',
                          borderTop: '1px solid #1F1F23',
                          paddingTop: '10px',
                        }}
                      >
                        <span>
                          {hasLan ? `${peer.localIp}:${peer.localPort}` : peer.ip}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#22C55E' }} />
                          <span style={{ color: '#A1A1AA' }}>Online</span>
                        </div>
                      </div>

                      {/* Device Action Buttons */}
                      <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPeer(peer);
                            handleSendToPeer(peer);
                          }}
                          style={{
                            flex: 1,
                            background: '#FFFFFF',
                            color: '#000000',
                            border: 'none',
                            borderRadius: '10px',
                            padding: '8px 12px',
                            fontSize: '12px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                          }}
                        >
                          <span>📤</span>
                          <span>Send Files</span>
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPeer(peer);
                            setActiveRightPanel('chat');
                            setIsRightPanelExpanded(true);
                          }}
                          style={{
                            background: '#27272A',
                            color: '#FAFAFA',
                            border: '1px solid #3F3F46',
                            borderRadius: '10px',
                            padding: '8px 14px',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                          }}
                        >
                          <span>💬</span>
                          <span>Chat</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Zero Device Discovery Guidance */
              <div
                style={{
                  background: '#121215',
                  border: '1px dashed #27272A',
                  borderRadius: '16px',
                  padding: '32px 24px',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div style={{ fontSize: '32px' }}>📡</div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#FFFFFF' }}>
                    Listening for AuraDrop Android App
                  </div>
                  <div style={{ fontSize: '12px', color: '#71717A', marginTop: '4px', maxWidth: '380px', lineHeight: 1.5 }}>
                    Open the AuraDrop APK on your Android phone on the same Wi-Fi. It will appear here automatically with direct LAN zero-hop transport.
                  </div>
                </div>
                <button
                  onClick={() => setIsPairModalOpen(true)}
                  style={{
                    background: '#27272A',
                    color: '#FFFFFF',
                    border: '1px solid #3F3F46',
                    borderRadius: '10px',
                    padding: '8px 16px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    marginTop: '4px',
                  }}
                >
                  Show Mobile Pairing QR
                </button>
              </div>
            )}
          </div>

          {/* SECTION 2: QUICK DROPZONE & STAGED FILES */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: '#FFFFFF', letterSpacing: '-0.2px' }}>
                  Staged Files
                </h2>
                <p style={{ fontSize: '12px', color: '#71717A', margin: '2px 0 0 0' }}>
                  Drop files to send directly to {selectedPeer ? selectedPeer.name : 'selected device'}
                </p>
              </div>

              {stagedFiles.length > 0 && (
                <button
                  onClick={clearStagedFiles}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#71717A',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Drop Target */}
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '1.5px dashed #27272A',
                borderRadius: '16px',
                padding: '24px',
                textAlign: 'center',
                cursor: 'pointer',
                background: '#121215',
                transition: 'border-color 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#52525B')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#27272A')}
            >
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>📂</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>
                Click to browse or drop files here
              </div>
              <div style={{ fontSize: '11px', color: '#71717A', marginTop: '4px' }}>
                Any file type or size • SHA-256 verified streaming
              </div>
            </div>

            {/* Staged File Items */}
            {stagedFiles.length > 0 && (
              <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {stagedFiles.map((f) => (
                  <div
                    key={f.id}
                    style={{
                      background: '#18181B',
                      border: '1px solid #27272A',
                      borderRadius: '12px',
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '16px' }}>📄</span>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>
                          {f.name}
                        </div>
                        <div style={{ fontSize: '11px', color: '#71717A' }}>
                          {formatBytes(f.size)}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {selectedPeer && (
                        <button
                          onClick={() => handleSendToPeer(selectedPeer, f.file)}
                          style={{
                            background: '#FFFFFF',
                            color: '#000000',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '6px 12px',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Send
                        </button>
                      )}
                      <button
                        onClick={() => removeStagedFile(f.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#71717A',
                          cursor: 'pointer',
                          fontSize: '14px',
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}

                {selectedPeer && (
                  <button
                    onClick={() => handleSendToPeer(selectedPeer)}
                    style={{
                      marginTop: '6px',
                      background: '#FFFFFF',
                      color: '#000000',
                      border: 'none',
                      borderRadius: '12px',
                      padding: '12px',
                      fontSize: '13px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                    }}
                  >
                    <span>Send {stagedFiles.length} {stagedFiles.length === 1 ? 'file' : 'files'} to {selectedPeer.name}</span>
                    <span>→</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* SECTION 3: RECENT TRANSFERS LEDGER */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: '#FFFFFF', letterSpacing: '-0.2px' }}>
                  Transfer History
                </h2>
                <p style={{ fontSize: '12px', color: '#71717A', margin: '2px 0 0 0' }}>
                  Persistent ledger of completed zero-loss transfers
                </p>
              </div>

              {transferHistory.length > 0 && (
                <button
                  onClick={() => setIsHistoryModalOpen(true)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#71717A',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  View all ({transferHistory.length})
                </button>
              )}
            </div>

            {transferHistory.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {transferHistory.slice(0, 4).map((rec) => (
                  <div
                    key={rec.id}
                    style={{
                      background: '#121215',
                      border: '1px solid #27272A',
                      borderRadius: '12px',
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '16px' }}>✓</span>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>
                          {rec.fileName}
                        </div>
                        <div style={{ fontSize: '11px', color: '#71717A' }}>
                          {formatBytes(rec.fileSize)} • {rec.receiverName || rec.senderName} • {rec.transport || 'Direct LAN'}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {rec.blobUrl && (
                        <a
                          href={rec.blobUrl}
                          download={rec.fileName}
                          style={{
                            background: '#27272A',
                            color: '#FFFFFF',
                            textDecoration: 'none',
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 600,
                          }}
                        >
                          Save
                        </a>
                      )}
                      <span
                        style={{
                          fontSize: '10px',
                          color: '#22C55E',
                          fontWeight: 700,
                          background: '#22C55E1A',
                          padding: '2px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        SHA-256
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: '#52525B', textAlign: 'center', padding: '16px 0' }}>
                No completed transfers yet.
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: INTEGRATED REAL-TIME ENCRYPTED CHAT */}
        {isRightPanelExpanded && (
          <div
            style={{
              width: '420px',
              maxWidth: '45vw',
              display: 'flex',
              flexDirection: 'column',
              background: '#09090B',
              flexShrink: 0,
            }}
          >
            {/* Embedded Chat View Component */}
            <ChatView
              peers={peers}
              initialPeer={selectedPeer}
              currentUserId={engine.localId}
              currentUsername={engine.localName}
              onStartFileTransfer={(peer, file) => {
                handleSendToPeer(peer, file);
              }}
            />
          </div>
        )}
      </div>

      {/* MODALS */}
      <DevicePairModal
        isOpen={isPairModalOpen}
        onClose={() => setIsPairModalOpen(false)}
        localId={engine.localId}
        localName={engine.localName}
        peers={peers}
      />

      <TransferHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        history={transferHistory}
      />

      <DiagnosticsModal
        isOpen={isDiagnosticsModalOpen}
        onClose={() => setIsDiagnosticsModalOpen(false)}
      />

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
