import React from 'react';
import { LocalDeviceInfo } from '../types';
import { Network, ShieldCheck, HardDrive, Cpu, X, Check } from 'lucide-react';

interface DiagnosticsModalProps {
  info: LocalDeviceInfo | null;
  onDismiss: () => void;
  onSaveName: (name: string) => void;
}

export const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({
  info,
  onDismiss,
  onSaveName,
}) => {
  const [name, setName] = React.useState(info?.deviceName || '');

  if (!info) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md select-none">
      <div className="w-full max-w-md bg-[#0E0E12] border border-white/20 rounded-2xl shadow-2xl p-6 relative">
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="p-3 rounded-xl bg-white/10 text-white">
            <Network className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Network & System Info</h3>
            <p className="text-xs text-neutral-400">Native Windows Rust Engine</p>
          </div>
        </div>

        {/* Device Name Config */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
            Device Display Name
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl bg-black border border-white/20 text-white text-xs focus:outline-none focus:border-white transition-colors"
            />
            <button
              onClick={() => onSaveName(name)}
              className="px-4 py-2 rounded-xl bg-white hover:bg-neutral-200 text-black text-xs font-bold transition-all shadow-sm flex items-center gap-1"
            >
              <Check className="w-3.5 h-3.5" />
              Save
            </button>
          </div>
        </div>

        {/* Telemetry Grid */}
        <div className="space-y-2.5 text-xs">
          <div className="flex items-center justify-between p-3 rounded-xl bg-black border border-white/10">
            <span className="text-neutral-400 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-white" /> Device ID
            </span>
            <span className="font-mono text-white text-[11px] truncate max-w-[200px]">
              {info.deviceId}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-black border border-white/10">
            <span className="text-neutral-400 flex items-center gap-2">
              <Network className="w-4 h-4 text-white" /> Active Physical IP
            </span>
            <span className="font-mono text-white font-bold">
              {info.activeIp}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-black border border-white/10">
            <span className="text-neutral-400 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-white" /> Network Interface
            </span>
            <span className="text-white font-medium truncate max-w-[200px]">
              {info.activeInterface}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-black border border-white/10">
            <span className="text-neutral-400 flex items-center gap-2">
              <Network className="w-4 h-4 text-white" /> Discovery & Transfer Port
            </span>
            <span className="font-mono text-white font-semibold">
              {info.port} (UDP / HTTP)
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-black border border-white/10">
            <span className="text-neutral-400 flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-white" /> Downloads Directory
            </span>
            <span className="text-neutral-300 truncate max-w-[200px] text-[11px]">
              {info.downloadsDir}
            </span>
          </div>
        </div>

        <button
          onClick={onDismiss}
          className="w-full mt-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-all"
        >
          Close
        </button>
      </div>
    </div>
  );
};
