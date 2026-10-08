import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { UpdateInfo } from '../types';
import { Sparkles, Download, CheckCircle, RefreshCw, X, ArrowUpRight, ExternalLink } from 'lucide-react';

interface UpdateModalProps {
  onClose: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({ onClose }) => {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUpdate = async () => {
    setIsChecking(true);
    setError(null);
    try {
      const res = await invoke<UpdateInfo>('check_for_updates');
      setUpdateInfo(res);
    } catch (e: any) {
      setError(e?.toString() || 'Failed to check for updates');
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    fetchUpdate();
  }, []);

  const handleOpenDownload = () => {
    if (updateInfo?.downloadUrl) {
      window.open(updateInfo.downloadUrl, '_blank');
    } else {
      window.open('https://github.com/JACK-AI7/AuraDrop/releases/latest', '_blank');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md select-none animate-fade-in">
      <div className="w-full max-w-md bg-[#0E0E12] border border-white/20 rounded-2xl shadow-2xl p-6 relative flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white text-black flex items-center justify-center shadow-lg shadow-white/5">
              <Sparkles className="w-4 h-4 text-black" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">Over-the-Air Updates</h2>
              <p className="text-[11px] text-neutral-400">Direct Wireless Update Service</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        {isChecking ? (
          <div className="py-8 flex flex-col items-center justify-center text-center">
            <RefreshCw className="w-8 h-8 text-white animate-spin mb-3" />
            <p className="text-xs font-semibold text-white">Checking for Updates...</p>
            <p className="text-[11px] text-neutral-400 mt-1">Connecting to AuraDrop release server</p>
          </div>
        ) : error ? (
          <div className="py-6 flex flex-col items-center text-center">
            <p className="text-xs text-red-400 mb-3">{error}</p>
            <button
              onClick={fetchUpdate}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-2 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Try Again
            </button>
          </div>
        ) : updateInfo ? (
          <div className="space-y-4">
            {/* Version Badge Status */}
            <div className="p-4 rounded-xl border border-white/10 bg-black/50 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-mono">Installed Version</p>
                <p className="text-sm font-bold text-white font-mono mt-0.5">v{updateInfo.currentVersion}</p>
              </div>

              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-mono">Latest Available</p>
                <p className="text-sm font-bold text-white font-mono mt-0.5">v{updateInfo.latestVersion}</p>
              </div>
            </div>

            {updateInfo.hasUpdate ? (
              <div className="p-4 rounded-xl border border-white/30 bg-white/5 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-white font-bold text-xs">
                  <ArrowUpRight className="w-4 h-4 text-white" />
                  <span>Update Available!</span>
                </div>
                <p className="text-[11px] text-neutral-300 leading-relaxed max-h-28 overflow-y-auto font-mono bg-black/40 p-2.5 rounded-lg border border-white/10">
                  {updateInfo.releaseNotes}
                </p>
                <button
                  onClick={handleOpenDownload}
                  className="mt-2 w-full py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-neutral-200 transition-all flex items-center justify-center gap-2 shadow-lg shadow-white/10"
                >
                  <Download className="w-4 h-4" />
                  Download & Install v{updateInfo.latestVersion}
                </button>
              </div>
            ) : (
              <div className="p-5 rounded-xl border border-white/10 bg-black/40 flex flex-col items-center justify-center text-center">
                <CheckCircle className="w-8 h-8 text-white mb-2" />
                <p className="text-xs font-bold text-white">AuraDrop is Up to Date</p>
                <p className="text-[11px] text-neutral-400 mt-1 max-w-[240px]">
                  You are currently using the latest native high-speed release.
                </p>
              </div>
            )}
          </div>
        ) : null}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-white/10">
          <button
            onClick={fetchUpdate}
            disabled={isChecking}
            className="text-xs text-neutral-400 hover:text-white flex items-center gap-1.5 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3 h-3 ${isChecking ? 'animate-spin' : ''}`} />
            <span>Check again</span>
          </button>
          <button
            onClick={handleOpenDownload}
            className="text-xs text-neutral-400 hover:text-white flex items-center gap-1.5 transition-colors"
          >
            <span>GitHub Releases</span>
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};
