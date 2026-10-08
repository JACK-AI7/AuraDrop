import React from 'react';
import { PeerDevice } from '../types';
import { Smartphone, Monitor, Laptop, ArrowUpRight, CheckCircle2, RefreshCw, PlusCircle } from 'lucide-react';

interface DeviceShelfProps {
  peers: PeerDevice[];
  selectedPeerId: string | null;
  onSelectPeer: (peer: PeerDevice) => void;
  onSendFiles: (peer: PeerDevice) => void;
  onScanSubnet?: () => void;
  onAddDirectIp?: () => void;
  isScanning?: boolean;
}

export const DeviceShelf: React.FC<DeviceShelfProps> = ({
  peers,
  selectedPeerId,
  onSelectPeer,
  onSendFiles,
  onScanSubnet,
  onAddDirectIp,
  isScanning = false,
}) => {
  const getPlatformIcon = (platform: string) => {
    const p = platform.toLowerCase();
    if (p.includes('android') || p.includes('ios') || p.includes('phone')) {
      return <Smartphone className="w-5 h-5 text-white" />;
    } else if (p.includes('mac') || p.includes('laptop')) {
      return <Laptop className="w-5 h-5 text-white" />;
    }
    return <Monitor className="w-5 h-5 text-white" />;
  };

  if (peers.length === 0) {
    return (
      <div className="w-full max-w-xl mx-auto p-5 rounded-2xl bg-neutral-950/80 border border-dashed border-white/15 text-center backdrop-blur-md">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/5 text-white mb-2">
          <Monitor className="w-5 h-5 animate-pulse" />
        </div>
        <h4 className="text-sm font-semibold text-white">No Nearby Devices Detected Yet</h4>
        <p className="text-xs text-neutral-400 mt-1 max-w-sm mx-auto">
          Ensure your Android phone is on the same Wi-Fi with AuraDrop open.
        </p>

        <div className="mt-4 flex items-center justify-center gap-3">
          {onScanSubnet && (
            <button
              onClick={onScanSubnet}
              disabled={isScanning}
              className="px-4 py-2 rounded-xl bg-white hover:bg-neutral-200 text-black text-xs font-bold flex items-center gap-2 transition-all shadow-md active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              {isScanning ? 'Sweeping Subnet...' : 'Scan Subnet Now'}
            </button>
          )}

          {onAddDirectIp && (
            <button
              onClick={onAddDirectIp}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white border border-white/15 text-xs font-semibold flex items-center gap-2 transition-all active:scale-95"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              Direct IP Connect
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="text-xs font-bold text-neutral-400 tracking-wider uppercase">
          Nearby Devices ({peers.length})
        </h3>
        <div className="flex items-center gap-3">
          {onScanSubnet && (
            <button
              onClick={onScanSubnet}
              disabled={isScanning}
              title="Rescan Local Subnet"
              className="text-[11px] text-neutral-400 hover:text-white flex items-center gap-1 transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin text-white' : ''}`} />
              {isScanning ? 'Scanning...' : 'Rescan'}
            </button>
          )}
          <span className="text-[11px] text-white font-medium flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
            Direct LAN
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {peers.map((peer) => {
          const isSelected = selectedPeerId === peer.id;
          return (
            <div
              key={peer.id}
              onClick={() => onSelectPeer(peer)}
              className={`p-4 rounded-xl cursor-pointer transition-all duration-200 border relative group ${
                isSelected
                  ? 'bg-neutral-900 border-white shadow-xl shadow-black ring-1 ring-white/50'
                  : 'bg-[#0E0E12] hover:bg-neutral-900 border-white/10 hover:border-white/30'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`p-2.5 rounded-lg ${
                      isSelected ? 'bg-white text-black' : 'bg-white/10 text-white'
                    }`}
                  >
                    {isSelected ? (
                      <span className="text-black">{getPlatformIcon(peer.platform)}</span>
                    ) : (
                      getPlatformIcon(peer.platform)
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-white group-hover:text-white transition-colors">
                      {peer.name}
                    </h4>
                    <p className="text-[11px] text-neutral-400 mt-0.5 font-mono">
                      {peer.ip}
                    </p>
                  </div>
                </div>

                {isSelected ? (
                  <CheckCircle2 className="w-4 h-4 text-white" />
                ) : (
                  <div className="w-2 h-2 rounded-full bg-white/70" />
                )}
              </div>

              <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold tracking-wider text-neutral-400">
                  {peer.platform}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSendFiles(peer);
                  }}
                  className="px-2.5 py-1 rounded-md bg-white hover:bg-neutral-200 text-black text-xs font-bold flex items-center gap-1 transition-all"
                >
                  Send <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
