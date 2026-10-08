import React, { useState, useEffect, useRef, useMemo } from 'react';
import { PeerDevice, ChatMessage } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  MessageSquare,
  Send,
  Paperclip,
  X,
  Smartphone,
  Monitor,
  Search,
  Wifi,
  WifiOff,
} from 'lucide-react';

interface ChatHubModalProps {
  peers: PeerDevice[];
  initialPeerId?: string | null;
  onClose: () => void;
  onSendFile: (peer: PeerDevice) => void;
}

interface ConversationSummary {
  peerId: string;
  peerName: string;
  lastMessage: ChatMessage;
  unreadCount?: number;
}

export const ChatHubModal: React.FC<ChatHubModalProps> = ({
  peers,
  initialPeerId,
  onClose,
  onSendFile,
}) => {
  const [allMessages, setAllMessages] = useState<ChatMessage[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(
    initialPeerId || (peers.length > 0 ? peers[0].id : null)
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // 1. Fetch initial message archive & register live event listeners
  useEffect(() => {
    invoke<ChatMessage[]>('get_all_chat_conversations')
      .then((history) => {
        if (history) {
          setAllMessages(history);
          if (!selectedPeerId && history.length > 0) {
            setSelectedPeerId(history[history.length - 1].peerId);
          }
        }
      })
      .catch((err) => console.error('Failed to load all chat messages:', err));

    const unlistenReceived = listen<ChatMessage>('chat-message-received', (event) => {
      const msg = event.payload;
      setAllMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    const unlistenSent = listen<ChatMessage>('chat-message-sent', (event) => {
      const msg = event.payload;
      setAllMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    return () => {
      unlistenReceived.then((fn) => fn());
      unlistenSent.then((fn) => fn());
    };
  }, []);

  // Compute conversation summaries
  const conversations = useMemo(() => {
    const map = new Map<string, ConversationSummary>();

    // First populate from all active discovered peers
    peers.forEach((peer) => {
      map.set(peer.id, {
        peerId: peer.id,
        peerName: peer.name,
        lastMessage: {
          id: `placeholder_${peer.id}`,
          peerId: peer.id,
          peerName: peer.name,
          senderId: peer.id,
          senderName: peer.name,
          text: 'No messages yet',
          timestamp: 0,
          isOutgoing: false,
        },
      });
    });

    // Then update with real messages
    allMessages.forEach((msg) => {
      const targetId = msg.peerId;
      const existing = map.get(targetId);
      if (!existing || msg.timestamp >= existing.lastMessage.timestamp) {
        map.set(targetId, {
          peerId: targetId,
          peerName: msg.peerName || (existing ? existing.peerName : 'Unknown Peer'),
          lastMessage: msg,
        });
      }
    });

    const list = Array.from(map.values());
    list.sort((a, b) => b.lastMessage.timestamp - a.lastMessage.timestamp);
    return list;
  }, [allMessages, peers]);

  // Filter conversations by search query
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        c.peerName.toLowerCase().includes(q) ||
        c.lastMessage.text.toLowerCase().includes(q)
    );
  }, [conversations, searchQuery]);

  // Active peer object if currently discovered
  const activePeer = peers.find((p) => p.id === selectedPeerId) || null;

  // Active conversation's messages
  const activeMessages = useMemo(() => {
    if (!selectedPeerId) return [];
    return allMessages
      .filter((m) => m.peerId === selectedPeerId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [allMessages, selectedPeerId]);

  // Scroll to bottom on message update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length, selectedPeerId]);

  // Send message
  const handleSendMessage = async () => {
    const text = inputText.trim();
    if (!text || isSending || !selectedPeerId) return;

    setIsSending(true);
    setInputText('');

    try {
      const sentMsg = await invoke<ChatMessage>('send_chat_message', {
        peerId: selectedPeerId,
        text,
        peerIp: activePeer?.ip,
        peerPort: activePeer?.port,
        peerName: activePeer?.name,
      });

      setAllMessages((prev) => {
        if (prev.some((m) => m.id === sentMsg.id)) return prev;
        return [...prev, sentMsg];
      });
    } catch (err) {
      console.error('Failed to send message:', err);
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
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const selectedConversation = conversations.find((c) => c.peerId === selectedPeerId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md select-none animate-fade-in">
      <div className="w-full max-w-4xl h-[620px] bg-[#0E0E12] border border-white/20 rounded-2xl shadow-2xl flex relative overflow-hidden">
        {/* Left Sidebar: Conversations List */}
        <div className="w-80 border-r border-white/10 flex flex-col bg-black/50">
          {/* Header */}
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-white" />
              <h2 className="text-sm font-bold text-white tracking-tight">Messages Hub</h2>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-neutral-300 font-mono">
              {conversations.length} {conversations.length === 1 ? 'Peer' : 'Peers'}
            </span>
          </div>

          {/* Search Box */}
          <div className="p-3 border-b border-white/10">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-neutral-900 border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-white transition-colors"
              />
            </div>
          </div>

          {/* Conversations List */}
          <div className="flex-1 overflow-y-auto divide-y divide-white/5">
            {filteredConversations.length === 0 ? (
              <div className="p-6 text-center text-neutral-500 text-xs">
                No conversations found.
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const isSelected = conv.peerId === selectedPeerId;
                const isOnline = peers.some((p) => p.id === conv.peerId);
                const peerObj = peers.find((p) => p.id === conv.peerId);
                const isAndroid = peerObj?.platform.toLowerCase().includes('android');

                return (
                  <button
                    key={conv.peerId}
                    onClick={() => setSelectedPeerId(conv.peerId)}
                    className={`w-full p-3.5 flex items-start gap-3 text-left transition-colors ${
                      isSelected
                        ? 'bg-white/10 border-l-2 border-white'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    <div className="relative">
                      <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-white text-xs font-bold">
                        {isAndroid ? <Smartphone className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-black ${
                          isOnline ? 'bg-white' : 'bg-neutral-600'
                        }`}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white truncate">
                          {conv.peerName}
                        </span>
                        {conv.lastMessage.timestamp > 0 && (
                          <span className="text-[10px] text-neutral-500 font-mono ml-1">
                            {formatTime(conv.lastMessage.timestamp)}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-neutral-400 truncate mt-0.5">
                        {conv.lastMessage.text}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Pane: Selected Conversation Chat */}
        <div className="flex-1 flex flex-col bg-[#000000]/60">
          {selectedConversation ? (
            <>
              {/* Chat Header */}
              <div className="h-16 border-b border-white/10 px-5 flex items-center justify-between bg-black/50">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-white">
                    {activePeer?.platform.toLowerCase().includes('android') ? (
                      <Smartphone className="w-5 h-5" />
                    ) : (
                      <Monitor className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      {selectedConversation.peerName}
                      {activePeer && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white text-black font-semibold font-mono">
                          {activePeer.ip}
                        </span>
                      )}
                    </h3>
                    <p className="text-xs flex items-center gap-1.5 mt-0.5">
                      {activePeer ? (
                        <>
                          <Wifi className="w-3 h-3 text-white" />
                          <span className="text-white font-medium text-[11px]">LAN Online</span>
                        </>
                      ) : (
                        <>
                          <WifiOff className="w-3 h-3 text-neutral-500" />
                          <span className="text-neutral-500 text-[11px]">Offline (Cached Thread)</span>
                        </>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {activePeer && (
                    <button
                      onClick={() => onSendFile(activePeer)}
                      title="Send File"
                      className="px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                      <span>Send File</span>
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    className="p-2 text-neutral-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Messages Timeline */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {activeMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-neutral-500">
                    <MessageSquare className="w-8 h-8 mb-2 opacity-40 text-white" />
                    <p className="text-xs font-semibold text-neutral-400">Direct Local Chat</p>
                    <p className="text-[11px] text-neutral-600 mt-1 max-w-[260px]">
                      Zero cloud dependency. Send end-to-end encrypted direct peer messages.
                    </p>
                  </div>
                ) : (
                  activeMessages.map((msg) => (
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
                {activePeer && (
                  <button
                    onClick={() => onSendFile(activePeer)}
                    title="Attach File"
                    className="p-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white transition-colors"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                )}
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    activePeer
                      ? `Message ${activePeer.name}...`
                      : 'Peer is offline; messages will queue when connected.'
                  }
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
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-neutral-500">
              <MessageSquare className="w-10 h-10 mb-3 opacity-30 text-white" />
              <p className="text-sm font-semibold text-neutral-400">Select a Conversation</p>
              <p className="text-xs text-neutral-600 mt-1 max-w-[280px]">
                Choose a peer device from the left panel to view and send direct local messages.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
