import React from 'react';
import { TransferProgressPayload } from '../types';
import { FolderOpen, ArrowDownLeft, ArrowUpRight, CheckCircle2, AlertCircle, Trash2, X } from 'lucide-react';

interface HistoryViewProps {
  history: TransferProgressPayload[];
  onOpenFolder: () => void;
  onOpenFile?: (fileName: string) => void;
  onClearHistory: () => void;
  onClose: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  history,
  onOpenFolder,
  onOpenFile,
  onClearHistory,
  onClose,
}) => {
  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return bytes + ' B';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md select-none animate-fade-in">
      <div className="w-full max-w-lg bg-[#0E0E12] border border-white/20 rounded-2xl shadow-2xl p-6 relative flex flex-col max-h-[80vh]">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center justify-between mb-5 pr-8">
          <div>
            <h3 className="text-base font-bold text-white">Transfer History</h3>
            <p className="text-xs text-neutral-400">Click any transferred file to open it directly</p>
          </div>
          <button
            onClick={onOpenFolder}
            className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-1.5 transition-all"
          >
            <FolderOpen className="w-4 h-4" />
            Downloads
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
          {history.length === 0 ? (
            <div className="text-center py-12 text-neutral-500 text-xs">
              No files transferred yet in this session.
            </div>
          ) : (
            history.map((item, idx) => (
              <div
                key={`${item.transferId}-${idx}`}
                onClick={() => onOpenFile && onOpenFile(item.filePath || item.fileName)}
                title="Click to open file"
                className="flex items-center gap-3 p-3 rounded-xl bg-black border border-white/10 hover:border-white/40 hover:bg-white/5 transition-all cursor-pointer group"
              >
                <div
                  className={`p-2 rounded-lg ${
                    item.isIncoming ? 'bg-white/10 text-white' : 'bg-white text-black'
                  }`}
                >
                  {item.isIncoming ? (
                    <ArrowDownLeft className="w-4 h-4" />
                  ) : (
                    <ArrowUpRight className="w-4 h-4" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h4 className="text-xs font-semibold text-white group-hover:underline truncate">
                    {item.fileName}
                  </h4>
                  <p className="text-[11px] text-neutral-400">
                    {formatBytes(item.fileSize)} • {item.isIncoming ? 'From' : 'To'} {item.peerName}
                  </p>
                </div>

                {item.status === 'completed' ? (
                  <span className="text-[11px] text-white font-semibold flex items-center gap-1 group-hover:bg-white group-hover:text-black px-2 py-1 rounded transition-colors">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Open
                  </span>
                ) : (
                  <span className="text-[11px] text-neutral-400 font-semibold flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> Failed
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {history.length > 0 && (
          <div className="pt-4 border-t border-white/10 flex justify-end">
            <button
              onClick={onClearHistory}
              className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white flex items-center gap-1.5 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear History
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
