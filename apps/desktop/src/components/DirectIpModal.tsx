import React, { useState } from 'react';
import { PeerDevice } from '../types';
import { Target, X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

interface DirectIpModalProps {
  onDismiss: () => void;
  onConnect: (ip: string) => Promise<PeerDevice>;
  onSuccess: (peer: PeerDevice) => void;
}

export const DirectIpModal: React.FC<DirectIpModalProps> = ({
  onDismiss,
  onConnect,
  onSuccess,
}) => {
  const [ip, setIp] = useState('192.168.0.4');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ip.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const peer = await onConnect(ip.trim());
      onSuccess(peer);
      onDismiss();
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Could not reach device at this IP');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in select-none">
      <div className="w-full max-w-sm bg-[#0E0E12] border border-white/20 rounded-2xl shadow-2xl p-6 relative">
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 rounded-xl bg-white/10 text-white">
            <Target className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Direct IP Connect</h3>
            <p className="text-xs text-neutral-400">Probe device on local subnet</p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
              Device LAN IP Address
            </label>
            <input
              type="text"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="e.g. 192.168.0.4"
              className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/20 text-white font-mono text-sm focus:outline-none focus:border-white transition-colors"
              autoFocus
            />
            <p className="text-[11px] text-neutral-500 mt-1.5">
              Target port 53317 (UDP announce + HTTP probe)
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-neutral-900 border border-white/20 text-xs text-white flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-white mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-300 text-xs font-semibold transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !ip.trim()}
              className="flex-1 py-2.5 rounded-xl bg-white hover:bg-neutral-200 text-black text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Connect
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
