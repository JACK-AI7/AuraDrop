import React, { useState, useEffect, useRef } from 'react';
import { PeerDevice, ChatMessage } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Send, Paperclip, X, MessageSquare, Smartphone, Monitor } from 'lucide-react';

interface ChatModalProps {
  peer: PeerDevice;
  onClose: () => void;
  onSendFile: (peer: PeerDevice) => void;
}

export const ChatModal: React.FC<ChatModalProps> = ({ peer, onClose, onSendFile }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Load chat history and listen for live incoming messages
  useEffect(() => {
    // 1. Fetch initial chat history
    invoke<ChatMessage[]>('get_chat_history', { peerId: peer.id })
      .then((hist) => {
        if (hist) setMessages(hist);
      })
      .catch((err) => console.error('Failed to load chat history:', err));

    // 2. Listen for incoming chat messages
    const unlistenReceived = listen<ChatMessage>('chat-message-received', (event) => {
      const msg = event.payload;
      if (msg.peerId === peer.id || msg.senderId === peer.id) {
        setMessages((prev) => [...prev, msg]);
      }
    });

    // 3. Listen for outgoing chat messages
    const unlistenSent = listen<ChatMessage>('chat-message-sent', (event) => {
      const msg = event.payload;
      if (msg.peerId === peer.id) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
    });

    return () => {
      unlistenReceived.then((fn) => fn());
      unlistenSent.then((fn) => fn());
    };
  }, [peer.id]);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    const text = inputText.trim();
    if (!text || isSending) return;

    setIsSending(true);
    setInputText('');

    try {
      const sentMsg = await invoke<ChatMessage>('send_chat_message', {
        peerId: peer.id,
        text,
        peerIp: peer.ip,
        peerPort: peer.port,
        peerName: peer.name,
      });
      setMessages((prev) => {
        if (prev.some((m) => m.id === sentMsg.id)) return prev;
        return [...prev, sentMsg];
      });
    } catch (err) {
      console.error('Failed to send message:', err);
      // Restore input text on error
      setInputText(text);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const isAndroid = peer.platform.toLowerCase().includes('android');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md select-none animate-fade-in">
      <div className="w-full max-w-lg h-[540px] bg-[#0E0E12] border border-white/20 rounded-2xl shadow-2xl flex flex-col relative overflow-hidden">
        {/* Header */}
        <div className="h-16 border-b border-white/10 px-5 flex items-center justify-between bg-black/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-white">
              {isAndroid ? <Smartphone className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                {peer.name}
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white text-black font-semibold font-mono">
                  {peer.ip}
                </span>
              </h3>
              <p className="text-xs text-neutral-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white" />
                <span>LAN Direct Peer-to-Peer</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onSendFile(peer)}
              title="Send File"
              className="p-2 text-neutral-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-neutral-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Messages Scroll Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#000000]/60">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-neutral-500">
              <MessageSquare className="w-8 h-8 mb-2 opacity-40 text-white" />
              <p className="text-xs font-semibold text-neutral-400">Direct Local Chat</p>
              <p className="text-[11px] text-neutral-600 mt-1 max-w-[260px]">
                Messages are sent directly over your local Wi-Fi with zero internet dependency.
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.isOutgoing ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[78%] px-4 py-2.5 rounded-2xl text-xs font-medium break-words ${
                    msg.isOutgoing
                      ? 'bg-white text-black rounded-br-xs shadow-md shadow-white/5'
                      : 'bg-neutral-900 border border-white/15 text-white rounded-bl-xs'
                  }`}
                >
                  {msg.text}
                </div>
                <span className="text-[10px] text-neutral-500 mt-1 px-1 font-mono">
                  {formatTime(msg.timestamp)}
                </span>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-3 border-t border-white/10 bg-black flex items-center gap-2">
          <button
            onClick={() => onSendFile(peer)}
            title="Attach File"
            className="p-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white transition-colors"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${peer.name}...`}
            className="flex-1 bg-neutral-900 border border-white/15 rounded-xl px-4 py-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-white transition-colors"
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputText.trim() || isSending}
            className="p-2.5 rounded-xl bg-white text-black hover:bg-neutral-200 transition-all disabled:opacity-40 disabled:hover:bg-white"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
