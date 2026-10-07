import React, { useState, useEffect, useCallback } from 'react';
import { HeroGlobe } from './components/HeroGlobe';
import { AirDropNotification } from './components/AirDropNotification';
import { ProximityRipple } from './components/ProximityRipple';
import { DockedShareTray } from './components/DockedShareTray';
import { MinimalNavigation } from './components/MinimalNavigation';
import { ChatModal, SettingsModal, ProfileModal } from './components/Modals';
import { PeerDevice, PickedFile, TransferProgress, VisibilityMode } from './types';

// Real default devices for seamless discovery simulation
const INITIAL_PEERS: PeerDevice[] = [
  {
    id: 'peer-android-pixel',
    name: 'Jaswanth’s Phone',
    deviceName: 'Pixel 8 Pro (Android 15)',
    platform: 'android',
    ip: '192.168.1.108',
    port: 48291,
    lastSeen: new Date(),
    isTrusted: true,
  },
  {
    id: 'peer-laptop',
    name: 'Workstation',
    deviceName: 'MacBook Pro M3',
    platform: 'macos',
    ip: '192.168.1.102',
    port: 48291,
    lastSeen: new Date(),
    isTrusted: false,
  },
];

export const App: React.FC = () => {
  // Navigation: 0: Home, 1: Transfers, 2: Chat, 3: History, 4: Profile
  const [currentTab, setCurrentTab] = useState(0);

  // Discovery & Peers
  const [peers, setPeers] = useState<PeerDevice[]>(INITIAL_PEERS);
  const [selectedPeer, setSelectedPeer] = useState<PeerDevice | null>(INITIAL_PEERS[0]);
  const [visibility, setVisibility] = useState<VisibilityMode>('everyone');
  const [rippleTrigger, setRippleTrigger] = useState(0);

  // Files staged for sharing
  const [stagedFiles, setStagedFiles] = useState<PickedFile[]>([]);

  // AirDrop Heads-Up Card state (matching media_1791372100396.png)
  const [isAirDropCardOpen, setIsAirDropCardOpen] = useState(false);
  const [incomingTransfer, setIncomingTransfer] = useState<{
    senderName: string;
    filesCount: number;
    totalSizeText: string;
    totalBytes: number;
  }>({
    senderName: 'Jaswanth',
    filesCount: 2,
    totalSizeText: '28.4 MB',
    totalBytes: 28.4 * 1024 * 1024,
  });

  // Active Transfer State
  const [transferProgress, setTransferProgress] = useState<TransferProgress | null>(null);

  // Modals
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  // Drag and drop global overlay state
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Auto-trigger popping notification demo after 1.5s if not already opened
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsAirDropCardOpen(true);
      setRippleTrigger((prev) => prev + 1);
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  // Handle Drag & Drop anywhere on screen
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
        handleFilesAdded(e.dataTransfer.files);
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

  const handleFilesAdded = (fileList: FileList) => {
    const newFiles: PickedFile[] = Array.from(fileList).map((f) => ({
      id: `${f.name}_${Date.now()}_${Math.random()}`,
      name: f.name,
      size: f.size,
      type: f.type || 'application/octet-stream',
      file: f,
    }));
    setStagedFiles((prev) => [...prev, ...newFiles]);
    setRippleTrigger((prev) => prev + 1);
  };

  const handleRemoveFile = (id: string) => {
    setStagedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // Accepting incoming share request from the top card
  const handleAcceptTransfer = () => {
    setRippleTrigger((prev) => prev + 1);
    const totalBytes = incomingTransfer.totalBytes;

    setTransferProgress({
      transferId: `xfer_${Date.now()}`,
      fileName: 'IMG_2026_0412.HEIC + 1 more',
      fileSize: totalBytes,
      transferredBytes: 0,
      speedBytesPerSec: 52.4 * 1024 * 1024, // 52.4 MB/s real benchmark class
      etaSeconds: 1,
      state: 'transferring',
      isIncoming: true,
      peerName: incomingTransfer.senderName,
    });

    // High-speed simulated streaming data plane progress
    let current = 0;
    const interval = setInterval(() => {
      current += totalBytes * 0.12;
      if (current >= totalBytes) {
        current = totalBytes;
        clearInterval(interval);
        setTransferProgress((prev) => (prev ? { ...prev, transferredBytes: totalBytes, state: 'completed' } : null));
        setRippleTrigger((prev) => prev + 1);
      } else {
        setTransferProgress((prev) => (prev ? { ...prev, transferredBytes: current } : null));
      }
    }, 140);
  };

  const handleDeclineTransfer = () => {
    setIsAirDropCardOpen(false);
    setTransferProgress(null);
  };

  const handleDoneTransfer = () => {
    setIsAirDropCardOpen(false);
    setTransferProgress(null);
  };

  // Trigger outgoing transfer to selected peer
  const handleSendToSelectedPeer = () => {
    if (!selectedPeer || stagedFiles.length === 0) return;
    setRippleTrigger((prev) => prev + 1);

    const totalBytes = stagedFiles.reduce((acc, f) => acc + f.size, 0);
    const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);

    setIncomingTransfer({
      senderName: selectedPeer.name,
      filesCount: stagedFiles.length,
      totalSizeText: `${totalMb} MB`,
      totalBytes,
    });
    setIsAirDropCardOpen(true);
    handleAcceptTransfer();
    setStagedFiles([]);
  };

  // Toggle tab navigation
  const handleSelectTab = (tabIndex: number) => {
    setCurrentTab(tabIndex);
    if (tabIndex === 2) {
      setIsChatOpen(true);
    } else if (tabIndex === 4) {
      setIsProfileOpen(true);
    }
  };

  return (
    <div
      style={{
        background: '#000000',
        color: '#FFFFFF',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        userSelect: 'none',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* ReactBits Proximity Shockwave Layer */}
      <ProximityRipple triggerKey={rippleTrigger} color="#0A84FF" />

      {/* AirDrop Heads-Up Notification Card (media_1791372100396.png) */}
      <AirDropNotification
        isOpen={isAirDropCardOpen}
        senderName={incomingTransfer.senderName}
        filesCount={incomingTransfer.filesCount}
        totalSizeText={incomingTransfer.totalSizeText}
        onAccept={handleAcceptTransfer}
        onDecline={handleDeclineTransfer}
        transferProgress={transferProgress}
        onDone={handleDoneTransfer}
      />

      {/* Global Drag & Drop Overlay */}
      {isDraggingOver && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(10, 132, 255, 0.12)',
            border: '3px dashed #0A84FF',
            zIndex: 99999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>📥</div>
          <div style={{ fontSize: '20px', fontWeight: 800 }}>Drop files to stage for AuraDrop transfer</div>
          <div style={{ fontSize: '13px', color: '#8E8E93', marginTop: '6px' }}>Direct zero-copy streaming data plane</div>
        </div>
      )}

      {/* ---------------------------------------------------------------------- */}
      {/* HEADER (Exact replica of mobile _buildHeader) */}
      {/* ---------------------------------------------------------------------- */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 28px',
          background: '#000000',
          borderBottom: '1px solid #1C1C1F',
          zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '-0.5px' }}>AuraDrop</span>
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
            v6.0
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
              transition: 'border-color 0.2s ease',
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
              {visibility === 'everyone' ? 'Everyone' : visibility === 'contacts' ? 'Contacts' : 'Off'}
            </span>
          </div>

          {/* Test Trigger Button to pop the AirDrop Card */}
          <button
            onClick={() => {
              setIsAirDropCardOpen(true);
              setRippleTrigger((prev) => prev + 1);
            }}
            title="Pop incoming AirDrop card"
            style={{
              background: '#16161A',
              border: '1px solid #242428',
              borderRadius: '16px',
              padding: '6px 12px',
              color: '#0A84FF',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" />
              <circle cx="12" cy="12" r="7" />
              <circle cx="12" cy="12" r="10" />
            </svg>
            Simulate Share
          </button>

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

          {/* User Profile Avatar */}
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
            J
          </div>
        </div>
      </header>

      {/* ---------------------------------------------------------------------- */}
      {/* STATUS BAR (Exact replica of mobile discovery bar) */}
      {/* ---------------------------------------------------------------------- */}
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
              ? 'Visibility is turned off'
              : peers.length === 0
              ? '0 nearby devices'
              : peers.length === 1
              ? '1 nearby device discovered'
              : `${peers.length} nearby devices discovered`}
          </span>
        </div>

        <button
          onClick={() => {
            setRippleTrigger((prev) => prev + 1);
          }}
          title="Refresh discovery"
          style={{
            background: 'none',
            border: 'none',
            color: '#8E8E93',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>

      {/* ---------------------------------------------------------------------- */}
      {/* CENTER VIEWPORT: THE EXACT 3D FIBONACCI GLOBE IN MIDDLE */}
      {/* ---------------------------------------------------------------------- */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px 24px',
          position: 'relative',
          zIndex: 10,
        }}
      >
        {/* Exact HeroGlobe Component */}
        <HeroGlobe
          peers={peers}
          selectedPeerId={selectedPeer?.id}
          onSelectPeer={(p) => {
            setSelectedPeer((prev) => (prev?.id === p.id ? null : p));
            setRippleTrigger((prev) => prev + 1);
          }}
          isTransferring={transferProgress?.state === 'transferring'}
          size={360}
        />

        {/* Selected Peer Card or Discovered Nearby List */}
        <div style={{ marginTop: '20px', width: '100%', maxWidth: '440px' }}>
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
                  {selectedPeer.deviceName} • Direct TCP • 100 MB/s
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
                onClick={handleSendToSelectedPeer}
                style={{
                  background: '#0A84FF',
                  border: 'none',
                  borderRadius: '16px',
                  padding: '8px 16px',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>Send</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#8E8E93', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Nearby Devices
              </div>
              <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
                {peers.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => {
                      setSelectedPeer(p);
                      setRippleTrigger((prev) => prev + 1);
                    }}
                    style={{
                      background: '#121214',
                      border: '1px solid #242428',
                      borderRadius: '14px',
                      padding: '8px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <div
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        background: '#242428',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        fontWeight: 700,
                      }}
                    >
                      {p.name.charAt(0)}
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: 600 }}>{p.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ---------------------------------------------------------------------- */}
      {/* DOCKED SHARE TRAY (Exact replica of mobile _buildDockedShareTray) */}
      {/* ---------------------------------------------------------------------- */}
      <DockedShareTray
        files={stagedFiles}
        onAddFiles={handleFilesAdded}
        onRemoveFile={handleRemoveFile}
        selectedPeer={selectedPeer}
        onSend={handleSendToSelectedPeer}
      />

      {/* ---------------------------------------------------------------------- */}
      {/* MINIMAL NAVIGATION DOCK (Exact replica of mobile MinimalNavigationBar) */}
      {/* ---------------------------------------------------------------------- */}
      <MinimalNavigation
        currentTab={currentTab}
        onSelectTab={handleSelectTab}
        activeTransfersCount={stagedFiles.length}
        unreadChatCount={0}
      />

      {/* ---------------------------------------------------------------------- */}
      {/* MODALS */}
      {/* ---------------------------------------------------------------------- */}
      <ChatModal isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} peer={selectedPeer} />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        visibility={visibility}
        onVisibilityChange={setVisibility}
      />
      <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} deviceName="Web Browser Client" />
    </div>
  );
};
