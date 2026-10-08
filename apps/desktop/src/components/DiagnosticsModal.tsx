import React from 'react';
import { LocalDeviceInfo } from '../types';
import { Network, ShieldCheck, HardDrive, Cpu, X } from 'lucide-react';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <div className="w-full max-w-md bg-[#131318] border border-white/10 rounded-2xl shadow-2xl p-6 relative">
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 p-1.5 text-white/40 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="p-3 rounded-xl bg-indigo-500/20 text-indigo-400">
            <Network className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Network & System Info</h3>
            <p className="text-xs text-white/50">Native Rust Engine Telemetry</p>
          </div>
        </div>

        {/* Device Name Config */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-white/60 mb-1.5">
            Device Display Name
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={() => onSaveName(name)}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all"
            >
              Save
            </button>
          </div>
        </div>

        {/* Telemetry Grid */}
        <div className="space-y-2.5 text-xs">
          <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
            <span className="text-white/50 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" /> Device ID
            </span>
            <span className="font-mono text-white/80 text-[11px] truncate max-w-[200px]">
              {info.deviceId}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
            <span className="text-white/50 flex items-center gap-2">
              <Network className="w-4 h-4 text-indigo-400" /> Active Local IP
            </span>
            <span className="font-mono text-emerald-400 font-bold">
              {info.activeIp}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
            <span className="text-white/50 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-indigo-400" /> Adapter
            </span>
            <span className="text-white/80 font-medium truncate max-w-[200px]">
              {info.activeInterface}
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
            <span className="text-white/50 flex items-center gap-2">
              <Network className="w-4 h-4 text-indigo-400" /> Service Port
            </span>
            <span className="font-mono text-white/80 font-semibold">
              {info.port} (UDP / HTTP)
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
            <span className="text-white/50 flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-indigo-400" /> Save Folder
            </span>
            <span className="text-white/70 truncate max-w-[200px] text-[11px]">
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
