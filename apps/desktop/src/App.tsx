import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { PeerDevice, LocalDeviceInfo, SelectedFileInfo, TransferProgressPayload } from './types';
import { HeroGlobe } from './components/HeroGlobe';
import { DeviceShelf } from './components/DeviceShelf';
import { TransferModal } from './components/TransferModal';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import { HistoryView } from './components/HistoryView';
import { DirectIpModal } from './components/DirectIpModal';
import { ChatModal } from './components/ChatModal';
import {
  Send,
  FolderOpen,
  Settings,
  History,
  Sparkles,
  Wifi,
  RefreshCw,
  Target,
  MessageSquare,
} from 'lucide-react';

export const App: React.FC = () => {
  const [localInfo, setLocalInfo] = useState<LocalDeviceInfo | null>(null);
  const [peers, setPeers] = useState<PeerDevice[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [chatPeer, setChatPeer] = useState<PeerDevice | null>(null);
  const [activeTransfer, setActiveTransfer] = useState<TransferProgressPayload | null>(null);
  const [history, setHistory] = useState<TransferProgressPayload[]>([]);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showDirectIp, setShowDirectIp] = useState(false);
  const [isPickingFiles, setIsPickingFiles] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  // Initialize Local Info and Listeners
  useEffect(() => {
    // 1. Fetch Local Device Info
    invoke<LocalDeviceInfo>('get_local_info')
      .then((info) => setLocalInfo(info))
      .catch((err) => console.error('Failed to get local info:', err));

    const dedupePeers = (list: PeerDevice[]) =>
      list.filter((peer, idx, arr) => idx === arr.findIndex((p) => p.ip === peer.ip || p.id === peer.id));

    // 2. Fetch Initial Peers
    invoke<PeerDevice[]>('get_nearby_peers')
      .then((p) => {
        const unique = dedupePeers(p);
        setPeers(unique);
        if (unique.length > 0 && !selectedPeerId) {
          setSelectedPeerId(unique[0].id);
        }
      })
      .catch((err) => console.error('Failed to get initial peers:', err));

    // 3. Listen for Live Peer Updates from UDP / Subnet Discovery
    const unlistenPeers = listen<PeerDevice[]>('peers-updated', (event) => {
      const unique = dedupePeers(event.payload);
      setPeers(unique);
      setSelectedPeerId((current) => {
        if (current && unique.some((p) => p.id === current)) {
          return current;
        }
        return unique.length > 0 ? unique[0].id : null;
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

  // Action: Scan Subnet Now
  const handleScanSubnet = async () => {
    if (isScanning) return;
    setIsScanning(true);
    try {
      const updatedPeers = await invoke<PeerDevice[]>('rescan_network');
      setPeers(updatedPeers);
      if (updatedPeers.length > 0 && !selectedPeerId) {
        setSelectedPeerId(updatedPeers[0].id);
      }
    } catch (err) {
      console.error('Subnet scan error:', err);
    } finally {
      setTimeout(() => setIsScanning(false), 800);
    }
  };

  // Action: Connect to Single IP directly
  const handleConnectDirectIp = async (ip: string): Promise<PeerDevice> => {
    const peer = await invoke<PeerDevice>('probe_device_ip', { ip });
    setPeers((prev) => {
      const next = prev.filter((p) => p.id !== peer.id);
      return [peer, ...next];
    });
    setSelectedPeerId(peer.id);
    return peer;
  };

  const handleOpenDownloads = () => {
    invoke('open_downloads_folder').catch(console.error);
  };

  const handleOpenFile = (fileName: string) => {
    invoke('open_file', { fileName }).catch(console.error);
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
    <div className="flex flex-col h-screen w-screen bg-[#000000] text-white overflow-hidden select-none font-sans">
      {/* Top Navigation Bar - Minimal Black and White */}
      <header className="h-14 border-b border-white/10 px-6 flex items-center justify-between bg-black/90 backdrop-blur-md z-20 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-white text-black flex items-center justify-center shadow-lg shadow-white/5">
            <Sparkles className="w-4 h-4 text-black" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              AuraDrop
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-white/20 bg-white/5 text-white/80 font-mono font-normal">
                v2.0 Native
              </span>
            </h1>
          </div>
        </div>

        {/* Network & Local Host Indicator */}
        <div className="flex items-center gap-2.5">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-900 border border-white/10 text-xs text-neutral-300">
            <Wifi className="w-3.5 h-3.5 text-white" />
            <span className="font-mono text-[11px] text-neutral-400">{localInfo?.activeIp || '127.0.0.1'}</span>
            <span className="text-neutral-600">•</span>
            <span className="text-white font-medium truncate max-w-[140px]">
              {localInfo?.deviceName || 'This PC'}
            </span>
          </div>

          {/* Subnet Scan Trigger Button */}
          <button
            onClick={handleScanSubnet}
            disabled={isScanning}
            title="Scan Wi-Fi Subnet for Devices"
            className="px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-white text-xs font-medium flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-white' : 'text-neutral-400'}`} />
            <span className="hidden md:inline">{isScanning ? 'Scanning...' : 'Scan Subnet'}</span>
          </button>

          {/* Direct IP Quick Connect Button */}
          <button
            onClick={() => setShowDirectIp(true)}
            title="Direct IP Connect"
            className="px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-white text-xs font-medium flex items-center gap-1.5 transition-all active:scale-95"
          >
            <Target className="w-3.5 h-3.5 text-neutral-400" />
            <span className="hidden md:inline">Direct IP</span>
          </button>

          <button
            onClick={() => setShowHistory(true)}
            title="Transfer History"
            className="p-2 text-neutral-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors relative"
          >
            <History className="w-4 h-4" />
            {history.length > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-white" />
            )}
          </button>

          <button
            onClick={handleOpenDownloads}
            title="Open Downloads Folder"
            className="p-2 text-neutral-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            <FolderOpen className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowDiagnostics(true)}
            title="Network Diagnostics & Settings"
            className="p-2 text-neutral-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col justify-between p-4 overflow-y-auto relative bg-[#000000]">
        {/* Central Monochromatic 3D HeroGlobe Viewport */}
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
                className="px-6 py-2.5 rounded-full bg-white hover:bg-neutral-200 text-black text-xs font-bold flex items-center gap-2 shadow-xl shadow-white/10 hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                Send Files to {selectedPeer.name}
              </button>

              <button
                onClick={() => setChatPeer(selectedPeer)}
                className="px-5 py-2.5 rounded-full bg-neutral-900 hover:bg-neutral-800 text-white border border-white/20 text-xs font-semibold flex items-center gap-2 shadow-xl shadow-black hover:scale-105 active:scale-95 transition-all"
              >
                <MessageSquare className="w-3.5 h-3.5 text-white" />
                Chat
              </button>
            </div>
          )}
        </div>

        {/* Bottom Nearby Devices Shelf */}
        <div className="mt-4 pt-3 border-t border-white/10">
          <DeviceShelf
            peers={peers}
            selectedPeerId={selectedPeerId}
            onSelectPeer={handleSelectPeer}
            onSendFiles={handleSendFiles}
            onOpenChat={(peer) => setChatPeer(peer)}
            onScanSubnet={handleScanSubnet}
            onAddDirectIp={() => setShowDirectIp(true)}
            isScanning={isScanning}
          />
        </div>
      </main>

      {/* Overlays / Modals */}
      <TransferModal
        transfer={activeTransfer}
        onDismiss={() => setActiveTransfer(null)}
        onOpenFolder={handleOpenDownloads}
        onOpenFile={handleOpenFile}
      />

      {chatPeer && (
        <ChatModal
          peer={chatPeer}
          onClose={() => setChatPeer(null)}
          onSendFile={(peer) => handleSendFiles(peer)}
        />
      )}

      {showDirectIp && (
        <DirectIpModal
          onDismiss={() => setShowDirectIp(false)}
          onConnect={handleConnectDirectIp}
          onSuccess={(peer) => {
            setSelectedPeerId(peer.id);
          }}
        />
      )}

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
          onOpenFile={handleOpenFile}
          onClearHistory={() => setHistory([])}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
};
export default App;
