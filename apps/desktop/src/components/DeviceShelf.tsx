import React from 'react';
import { PeerDevice } from '../types';
import { Smartphone, Monitor, Laptop, ArrowUpRight, CheckCircle2 } from 'lucide-react';

interface DeviceShelfProps {
  peers: PeerDevice[];
  selectedPeerId: string | null;
  onSelectPeer: (peer: PeerDevice) => void;
  onSendFiles: (peer: PeerDevice) => void;
}

export const DeviceShelf: React.FC<DeviceShelfProps> = ({
  peers,
  selectedPeerId,
  onSelectPeer,
  onSendFiles,
}) => {
  const getPlatformIcon = (platform: string) => {
    const p = platform.toLowerCase();
    if (p.includes('android') || p.includes('ios') || p.includes('phone')) {
      return <Smartphone className="w-5 h-5 text-emerald-400" />;
    } else if (p.includes('mac') || p.includes('laptop')) {
      return <Laptop className="w-5 h-5 text-indigo-400" />;
    }
    return <Monitor className="w-5 h-5 text-indigo-400" />;
  };

  if (peers.length === 0) {
    return (
      <div className="w-full max-w-xl mx-auto p-5 rounded-2xl bg-[#14141A]/70 border border-white/5 text-center backdrop-blur-md">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-indigo-500/10 text-indigo-400 mb-2">
          <Monitor className="w-5 h-5 animate-pulse" />
        </div>
        <h4 className="text-sm font-semibold text-white/90">No Nearby Devices Detected</h4>
        <p className="text-xs text-white/40 mt-1 max-w-sm mx-auto">
          Ensure your Android phone or another PC is connected to the same Wi-Fi network and has AuraDrop running.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="text-xs font-bold text-white/50 tracking-wider uppercase">
          Nearby Devices ({peers.length})
        </h3>
        <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
          Direct LAN
        </span>
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
                  ? 'bg-emerald-950/20 border-emerald-500/60 shadow-lg shadow-emerald-500/10'
                  : 'bg-[#14141A]/90 hover:bg-[#1A1A22] border-white/8 hover:border-white/20'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`p-2.5 rounded-lg ${
                      isSelected ? 'bg-emerald-500/20' : 'bg-white/5'
                    }`}
                  >
                    {getPlatformIcon(peer.platform)}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-white group-hover:text-emerald-300 transition-colors">
                      {peer.name}
                    </h4>
                    <p className="text-[11px] text-white/40 mt-0.5 font-mono">
                      {peer.ip}
                    </p>
                  </div>
                </div>

                {isSelected ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <div className="w-2 h-2 rounded-full bg-emerald-400/80" />
                )}
              </div>

              <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold tracking-wider text-white/40">
                  {peer.platform}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSendFiles(peer);
                  }}
                  className="px-2.5 py-1 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-1 transition-all"
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
