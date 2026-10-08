import React from 'react';
import { TransferProgressPayload } from '../types';
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, AlertCircle, FileText, X } from 'lucide-react';

interface TransferModalProps {
  transfer: TransferProgressPayload | null;
  onDismiss: () => void;
  onOpenFolder: () => void;
}

export const TransferModal: React.FC<TransferModalProps> = ({
  transfer,
  onDismiss,
  onOpenFolder,
}) => {
  if (!transfer) return null;

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return bytes + ' B';
  };

  const isCompleted = transfer.status === 'completed';
  const isFailed = transfer.status === 'failed';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-md bg-[#131318] border border-white/10 rounded-2xl shadow-2xl p-6 relative">
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 p-1.5 text-white/40 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div
            className={`p-3 rounded-xl ${
              isCompleted
                ? 'bg-emerald-500/20 text-emerald-400'
                : isFailed
                ? 'bg-rose-500/20 text-rose-400'
                : 'bg-indigo-500/20 text-indigo-400'
            }`}
          >
            {isCompleted ? (
              <CheckCircle2 className="w-6 h-6" />
            ) : isFailed ? (
              <AlertCircle className="w-6 h-6" />
            ) : transfer.isIncoming ? (
              <ArrowDownLeft className="w-6 h-6 animate-pulse" />
            ) : (
              <ArrowUpRight className="w-6 h-6 animate-pulse" />
            )}
          </div>
          <div>
            <h3 className="text-base font-bold text-white">
              {isCompleted
                ? 'Transfer Completed'
                : isFailed
                ? 'Transfer Failed'
                : transfer.isIncoming
                ? 'Receiving File'
                : 'Sending File'}
            </h3>
            <p className="text-xs text-white/50">
              {transfer.isIncoming ? 'From: ' : 'To: '}
              <span className="text-white/80 font-semibold">{transfer.peerName}</span>
            </p>
          </div>
        </div>

        {/* File Card */}
        <div className="flex items-center gap-3 p-3.5 rounded-xl bg-white/5 border border-white/5 mb-5">
          <FileText className="w-6 h-6 text-indigo-400 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold text-white truncate">{transfer.fileName}</h4>
            <p className="text-xs text-white/40">
              {formatBytes(transfer.bytesTransferred)} / {formatBytes(transfer.fileSize)}
            </p>
          </div>
          <span className="text-xs font-mono font-bold text-white/80">
            {transfer.progressPercent.toFixed(0)}%
          </span>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-white/10 h-2.5 rounded-full overflow-hidden mb-4 relative">
          <div
            className={`h-full rounded-full transition-all duration-200 ${
              isCompleted
                ? 'bg-emerald-400'
                : isFailed
                ? 'bg-rose-500'
                : 'bg-gradient-to-r from-indigo-500 to-emerald-400'
            }`}
            style={{ width: `${Math.min(100, Math.max(0, transfer.progressPercent))}%` }}
          />
        </div>

        {/* Telemetry Stats */}
        {!isCompleted && !isFailed && (
          <div className="flex items-center justify-between text-xs text-white/50 px-1 mb-6">
            <span>Speed: <strong className="text-white font-mono">{transfer.speedMbps.toFixed(1)} MB/s</strong></span>
            <span>ETA: <strong className="text-white font-mono">{transfer.etaSeconds}s</strong></span>
          </div>
        )}

        {isCompleted && (
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-center justify-between mb-6">
            <span>Verified with SHA-256 Checksum</span>
            <span className="font-mono text-[10px] bg-emerald-500/20 px-2 py-0.5 rounded">MATCH</span>
          </div>
        )}

        {isFailed && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 mb-6">
            {transfer.error || 'Connection timed out or transfer interrupted.'}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          {isCompleted && transfer.isIncoming && (
            <button
              onClick={onOpenFolder}
              className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-all"
            >
              Open Downloads Folder
            </button>
          )}
          <button
            onClick={onDismiss}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${
              isCompleted
                ? 'bg-emerald-500 hover:bg-emerald-400 text-black'
                : 'bg-white/10 hover:bg-white/15 text-white'
            }`}
          >
            {isCompleted ? 'Done' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};
