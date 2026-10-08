import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { PeerDevice, LocalDeviceInfo, SelectedFileInfo, TransferProgressPayload } from './types';
import { HeroGlobe } from './components/HeroGlobe';
import { DeviceShelf } from './components/DeviceShelf';
import { TransferModal } from './components/TransferModal';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import { HistoryView } from './components/HistoryView';
import {
  Send,
  FolderOpen,
  Settings,
  History,
  Sparkles,
  Wifi,
  FileUp,
} from 'lucide-react';

export const App: React.FC = () => {
  const [localInfo, setLocalInfo] = useState<LocalDeviceInfo | null>(null);
  const [peers, setPeers] = useState<PeerDevice[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [activeTransfer, setActiveTransfer] = useState<TransferProgressPayload | null>(null);
  const [history, setHistory] = useState<TransferProgressPayload[]>([]);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isPickingFiles, setIsPickingFiles] = useState(false);

  // Initialize Local Info and Listeners
  useEffect(() => {
    // 1. Fetch Local Device Info
    invoke<LocalDeviceInfo>('get_local_info')
      .then((info) => setLocalInfo(info))
      .catch((err) => console.error('Failed to get local info:', err));

    // 2. Fetch Initial Peers
    invoke<PeerDevice[]>('get_nearby_peers')
      .then((p) => {
        setPeers(p);
        if (p.length > 0 && !selectedPeerId) {
          setSelectedPeerId(p[0].id);
        }
      })
      .catch((err) => console.error('Failed to get initial peers:', err));

    // 3. Listen for Live Peer Updates from UDP Discovery
    const unlistenPeers = listen<PeerDevice[]>('peers-updated', (event) => {
      setPeers(event.payload);
      setSelectedPeerId((current) => {
        if (current && event.payload.some((p) => p.id === current)) {
          return current;
        }
        return event.payload.length > 0 ? event.payload[0].id : null;
      });
    });

    // 4. Listen for Real-Time Streaming Transfer Progress
    const unlistenTransfer = listen<TransferProgressPayload>('transfer-progress', (event) => {
      const payload = event.payload;
      setActiveTransfer(payload);

      if (payload.status === 'completed' || payload.status === 'failed') {
        setHistory((prev) => [payload, ...prev.slice(0, 49)]);
      }
    });

    return () => {
      unlistenPeers.then((fn) => fn());
      unlistenTransfer.then((fn) => fn());
    };
  }, []);

  // Action: Select Peer
  const handleSelectPeer = (peer: PeerDevice) => {
    setSelectedPeerId(peer.id);
  };

  // Action: Pick and Send Files
  const handleSendFiles = async (targetPeer?: PeerDevice) => {
    const peer = targetPeer || peers.find((p) => p.id === selectedPeerId);
    if (!peer) {
      alert('Please select a nearby device first.');
      return;
    }

    try {
      setIsPickingFiles(true);
      const files = await invoke<SelectedFileInfo[]>('pick_files');
      if (files && files.length > 0) {
        const paths = files.map((f) => f.path);
        await invoke('send_files_to_peer', {
          peerId: peer.id,
          filePaths: paths,
        });
      }
    } catch (err) {
      console.error('File pick or send error:', err);
    } finally {
      setIsPickingFiles(false);
    }
  };

  const handleOpenDownloads = () => {
    invoke('open_downloads_folder').catch(console.error);
  };

  const handleSaveDeviceName = (name: string) => {
    invoke('set_device_name', { name })
      .then(() => {
        setLocalInfo((prev) => (prev ? { ...prev, deviceName: name } : null));
        setShowDiagnostics(false);
      })
      .catch(console.error);
  };

  const selectedPeer = peers.find((p) => p.id === selectedPeerId) || peers[0] || null;

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0A0A0C] text-white overflow-hidden select-none font-sans">
      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-white/8 px-6 flex items-center justify-between bg-[#101014]/80 backdrop-blur-md z-20 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              AuraDrop
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/10 text-white/60 font-mono font-normal">
                v2.0 Native
              </span>
            </h1>
          </div>
        </div>

        {/* Network & Local Host Indicator */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/5 text-xs text-white/70">
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-mono text-[11px] text-white/50">{localInfo?.activeIp || '127.0.0.1'}</span>
            <span className="text-white/30">•</span>
            <span className="text-white/80 font-medium truncate max-w-[140px]">
              {localInfo?.deviceName || 'This PC'}
            </span>
          </div>

          <button
            onClick={() => setShowHistory(true)}
            title="Transfer History"
            className="p-2 text-white/60 hover:text-white rounded-lg hover:bg-white/5 transition-colors relative"
          >
            <History className="w-4 h-4" />
            {history.length > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400" />
            )}
          </button>

          <button
            onClick={handleOpenDownloads}
            title="Open Downloads Folder"
            className="p-2 text-white/60 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            <FolderOpen className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowDiagnostics(true)}
            title="Network Diagnostics & Settings"
            className="p-2 text-white/60 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col justify-between p-4 overflow-y-auto relative">
        {/* Central 3D HeroGlobe Viewport */}
        <div className="flex-1 flex flex-col items-center justify-center my-auto relative">
          <HeroGlobe
            peers={peers}
            selectedPeerId={selectedPeerId}
            onSelectPeer={handleSelectPeer}
            isTransferring={activeTransfer?.status === 'transferring'}
            transferSpeed={
              activeTransfer?.status === 'transferring'
                ? `${activeTransfer.speedMbps.toFixed(1)} MB/s`
                : null
            }
            size={340}
          />

          {/* Quick Action Bar under Globe */}
          {selectedPeer && (
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => handleSendFiles(selectedPeer)}
                disabled={isPickingFiles}
                className="px-6 py-2.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-500/20 hover:scale-105 active:scale-95 transition-all"
              >
                <Send className="w-3.5 h-3.5" />
                Send Files to {selectedPeer.name}
              </button>
            </div>
          )}
        </div>

        {/* Bottom Nearby Devices Shelf */}
        <div className="mt-4 pt-3 border-t border-white/5">
          <DeviceShelf
            peers={peers}
            selectedPeerId={selectedPeerId}
            onSelectPeer={handleSelectPeer}
            onSendFiles={handleSendFiles}
          />
        </div>
      </main>

      {/* Overlays / Modals */}
      <TransferModal
        transfer={activeTransfer}
        onDismiss={() => setActiveTransfer(null)}
        onOpenFolder={handleOpenDownloads}
      />

      {showDiagnostics && (
        <DiagnosticsModal
          info={localInfo}
          onDismiss={() => setShowDiagnostics(false)}
          onSaveName={handleSaveDeviceName}
        />
      )}

      {showHistory && (
        <HistoryView
          history={history}
          onOpenFolder={handleOpenDownloads}
          onClearHistory={() => setHistory([])}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
};
export default App;
