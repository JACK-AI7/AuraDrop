import React, { useState, useEffect, useRef } from 'react';
import { PeerDevice, PickedFile } from '../types';
import { TransferEngine } from '../engine/transferEngine';

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  client_msg_id?: string | null;
  text: string;
  type: 'TEXT' | 'FILE' | 'IMAGE' | 'SYSTEM';
  reply_to_id?: string | null;
  expires_at?: string | null;
  is_deleted_everyone: boolean;
  created_at: string;
  sender?: {
    id: string;
    username: string;
    display_name: string;
    avatar_url?: string | null;
  };
  attachments?: Array<{
    id?: string;
    file_name: string;
    file_size: number;
    mime_type: string;
    file_hash?: string | null;
    file_url?: string | null;
    transfer_id?: string | null;
  }>;
}

export interface ConversationItem {
  id: string;
  type: 'DIRECT' | 'GROUP';
  title?: string | null;
  avatar_url?: string | null;
  created_by?: string | null;
  disappearing_seconds: number;
  last_message_at: string;
  created_at: string;
  unread_count?: number;
  members?: Array<{
    id: string;
    username: string;
    display_name: string;
    avatar_url?: string | null;
    role: string;
  }>;
  last_message?: {
    id: string;
    text: string;
    type: string;
    created_at: string;
    is_deleted_everyone: boolean;
  } | null;
}

interface ChatViewProps {
  currentUserId?: string;
  currentUsername?: string;
  peers: PeerDevice[];
  initialPeer?: PeerDevice | null;
  onStartFileTransfer?: (peer: PeerDevice, file: File) => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  currentUserId = 'user_local',
  currentUsername = 'You',
  peers,
  initialPeer,
  onStartFileTransfer,
}) => {
  const engine = TransferEngine.getInstance();
  const [conversations, setConversations] = useState<ConversationItem[]>(() => {
    try {
      const cached = localStorage.getItem('auradrop_cached_conversations');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });

  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [groupTitleInput, setGroupTitleInput] = useState('');
  const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState<string[]>([]);
  const [disappearingSeconds, setDisappearingSeconds] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const activeConv = conversations.find((c) => c.id === activeConvId);

  // ---------------------------------------------------------------------------
  // SYNC CONVERSATIONS FROM BACKEND (NEON POSTGRESQL)
  // ---------------------------------------------------------------------------
  const fetchConversations = async () => {
    try {
      const token = localStorage.getItem('auradrop_access_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-user-id': currentUserId,
        'x-user-name': currentUsername,
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(
        `/api/conversations?userId=${encodeURIComponent(currentUserId)}&userName=${encodeURIComponent(currentUsername)}`,
        { headers }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.conversations) {
          setConversations(data.conversations);
          localStorage.setItem('auradrop_cached_conversations', JSON.stringify(data.conversations));
          if (!activeConvId && data.conversations.length > 0) {
            setActiveConvId(data.conversations[0].id);
          }
        }
      }
    } catch {
      // Offline fallback: keep cached conversations
    }
  };

  useEffect(() => {
    fetchConversations();
  }, [currentUserId, currentUsername]);

  // ---------------------------------------------------------------------------
  // FETCH MESSAGES FOR ACTIVE CONVERSATION
  // ---------------------------------------------------------------------------
  const fetchMessages = async (convId: string) => {
    try {
      const token = localStorage.getItem('auradrop_access_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-user-id': currentUserId,
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(
        `/api/conversations/${convId}/messages?limit=50&userId=${encodeURIComponent(currentUserId)}`,
        { headers }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.messages) {
          setMessages(data.messages);
        }
      }
    } catch {
      // Offline
    }
  };

  useEffect(() => {
    if (activeConvId) {
      fetchMessages(activeConvId);
      const conv = conversations.find((c) => c.id === activeConvId);
      if (conv) {
        setDisappearingSeconds(conv.disappearing_seconds || 0);
      }
    }
  }, [activeConvId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ---------------------------------------------------------------------------
  // REAL-TIME MESSAGING OVER WEBRTC / SIGNALING RELAY
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const unsubscribeChat = engine.onChatMessage((payload: any) => {
      if (!payload) return;
      const incomingMsg = payload.message || payload;
      const convId = payload.conversationId || incomingMsg.conversation_id;

      if (convId && convId === activeConvId) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === incomingMsg.id)) return prev;
          return [...prev, incomingMsg];
        });
      }

      // Play soft notification beep
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
        osc.start();
        osc.stop(ctx.currentTime + 0.18);
      } catch {}

      // Refresh conversations list to update last message preview and unread counts
      fetchConversations();
    });

    return () => {
      unsubscribeChat();
    };
  }, [activeConvId, currentUserId]);

  // ---------------------------------------------------------------------------
  // OPEN OR CREATE CONVERSATION WITH DISCOVERED PEER
  // ---------------------------------------------------------------------------
  const handleOpenPeerChat = async (peer: PeerDevice) => {
    // Check if direct conversation already exists
    const existing = conversations.find((c) => {
      if (c.type !== 'DIRECT') return false;
      return c.members?.some((m) => m.id === peer.id);
    });

    if (existing) {
      setActiveConvId(existing.id);
      return;
    }

    try {
      const token = localStorage.getItem('auradrop_access_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-user-id': currentUserId,
        'x-user-name': currentUsername,
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/conversations/direct', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          userAId: currentUserId,
          userBId: peer.id,
          peerName: peer.name,
          userName: currentUsername,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.conversation) {
          setConversations((prev) => [data.conversation, ...prev.filter((c) => c.id !== data.conversation.id)]);
          setActiveConvId(data.conversation.id);
        }
      }
    } catch (err) {
      console.error('[AuraDrop Chat] Failed to create direct conversation:', err);
    }
  };

  // Handle initial peer selection from globe or card
  useEffect(() => {
    if (initialPeer) {
      handleOpenPeerChat(initialPeer);
    }
  }, [initialPeer]);

  // ---------------------------------------------------------------------------
  // SEND MESSAGE (PERSIST IN NEON DB + RELAY IN REAL-TIME OVER NETWORK)
  // ---------------------------------------------------------------------------
  const handleSendMessage = async () => {
    if (!inputText.trim() || !activeConvId) return;
    const textToSend = inputText.trim();
    setInputText('');

    const tempMsg: ChatMessage = {
      id: `tmp_${Date.now()}`,
      conversation_id: activeConvId,
      sender_id: currentUserId,
      text: textToSend,
      type: 'TEXT',
      is_deleted_everyone: false,
      created_at: new Date().toISOString(),
      sender: {
        id: currentUserId,
        username: currentUsername,
        display_name: currentUsername,
      },
    };
    setMessages((prev) => [...prev, tempMsg]);

    try {
      const token = localStorage.getItem('auradrop_access_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-user-id': currentUserId,
        'x-user-name': currentUsername,
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/conversations/${activeConvId}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          text: textToSend,
          type: 'TEXT',
          senderId: currentUserId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.message) {
          setMessages((prev) => prev.map((m) => (m.id === tempMsg.id ? data.message : m)));

          // Real-time dispatch to other members via signaling / P2P
          const targetMembers = activeConv?.members?.filter((m) => m.id !== currentUserId) || [];
          for (const member of targetMembers) {
            engine.sendChatMessage(member.id, {
              conversationId: activeConvId,
              message: data.message,
            });
          }
        }
      }
    } catch {
      // In offline mode, message remains in state
    }
  };

  // ---------------------------------------------------------------------------
  // SEND FILE ATTACHMENT IN CHAT + P2P DATA TRANSFER
  // ---------------------------------------------------------------------------
  const handleSendFileAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeConvId) return;

    const tempMsg: ChatMessage = {
      id: `tmp_file_${Date.now()}`,
      conversation_id: activeConvId,
      sender_id: currentUserId,
      text: file.name,
      type: 'FILE',
      is_deleted_everyone: false,
      created_at: new Date().toISOString(),
      sender: {
        id: currentUserId,
        username: currentUsername,
        display_name: currentUsername,
      },
      attachments: [
        {
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || 'application/octet-stream',
        },
      ],
    };
    setMessages((prev) => [...prev, tempMsg]);

    // If active conversation is direct and peer is online, trigger P2P file transfer
    if (activeConv?.type === 'DIRECT') {
      const otherMember = activeConv.members?.find((m) => m.id !== currentUserId);
      if (otherMember) {
        const peer = peers.find((p) => p.id === otherMember.id);
        if (peer && onStartFileTransfer) {
          onStartFileTransfer(peer, file);
        }
      }
    }

    try {
      const token = localStorage.getItem('auradrop_access_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-user-id': currentUserId,
        'x-user-name': currentUsername,
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/conversations/${activeConvId}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          text: file.name,
          type: 'FILE',
          senderId: currentUserId,
          attachments: [
            {
              fileName: file.name,
              fileSize: file.size,
              mimeType: file.type || 'application/octet-stream',
            },
          ],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.message) {
          setMessages((prev) => prev.map((m) => (m.id === tempMsg.id ? data.message : m)));

          // Real-time dispatch to other members via signaling
          const targetMembers = activeConv?.members?.filter((m) => m.id !== currentUserId) || [];
          for (const member of targetMembers) {
            engine.sendChatMessage(member.id, {
              conversationId: activeConvId,
              message: data.message,
            });
          }
        }
      }
    } catch {
      // Kept in local state
    }
  };

  // ---------------------------------------------------------------------------
  // CLEAR CHAT
  // ---------------------------------------------------------------------------
  const handleClearChat = async () => {
    if (!activeConvId) return;
    if (!confirm('Clear all messages in this conversation for your account?')) return;
    try {
      const token = localStorage.getItem('auradrop_access_token');
      const headers: Record<string, string> = { 'x-user-id': currentUserId };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      await fetch(`/api/conversations/${activeConvId}/clear`, { method: 'DELETE', headers });
      setMessages([]);
    } catch {
      setMessages([]);
    }
  };

  // ---------------------------------------------------------------------------
  // SET DISAPPEARING TIMER
  // ---------------------------------------------------------------------------
  const handleSetDisappearing = async (seconds: number) => {
    if (!activeConvId) return;
    setDisappearingSeconds(seconds);
    try {
      const token = localStorage.getItem('auradrop_access_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-user-id': currentUserId,
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      await fetch(`/api/conversations/${activeConvId}/disappearing`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ seconds }),
      });
    } catch {
      // Local state updated
    }
  };

  // ---------------------------------------------------------------------------
  // DELETE MESSAGE FOR EVERYONE
  // ---------------------------------------------------------------------------
  const handleDeleteMessage = async (msgId: string) => {
    if (!confirm('Delete this message for everyone?')) return;
    try {
      const token = localStorage.getItem('auradrop_access_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-user-id': currentUserId,
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      await fetch(`/api/messages/${msgId}`, { method: 'DELETE', headers });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, is_deleted_everyone: true, text: 'This message was deleted' } : m
        )
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, is_deleted_everyone: true, text: 'This message was deleted' } : m
        )
      );
    }
  };

  // ---------------------------------------------------------------------------
  // CREATE GROUP CONVERSATION
  // ---------------------------------------------------------------------------
  const handleCreateGroup = async () => {
    if (!groupTitleInput.trim() || selectedGroupMemberIds.length === 0) return;
    try {
      const token = localStorage.getItem('auradrop_access_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-user-id': currentUserId,
        'x-user-name': currentUsername,
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/conversations/group', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: groupTitleInput.trim(),
          memberIds: selectedGroupMemberIds,
          creatorId: currentUserId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.conversation) {
          setConversations((prev) => [data.conversation, ...prev]);
          setActiveConvId(data.conversation.id);
          setIsGroupModalOpen(false);
          setGroupTitleInput('');
          setSelectedGroupMemberIds([]);
        }
      }
    } catch {
      // Fallback
    }
  };

  const filteredConversations = conversations.filter((c) => {
    const title =
      c.type === 'GROUP'
        ? c.title
        : c.members?.find((m) => m.id !== currentUserId)?.display_name || 'Direct Chat';
    return title?.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        maxWidth: '1040px',
        height: '78vh',
        background: '#121214',
        border: '1px solid #242428',
        borderRadius: '24px',
        overflow: 'hidden',
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.85)',
      }}
    >
      {/* ------------------------------------------------------------------- */}
      {/* LEFT PANE: DISCOVERED PEERS + CONVERSATION LIST                     */}
      {/* ------------------------------------------------------------------- */}
      <div
        style={{
          width: '340px',
          borderRight: '1px solid #202024',
          display: 'flex',
          flexDirection: 'column',
          background: '#141418',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #202024' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h2 style={{ fontSize: '17px', fontWeight: 800, color: '#FFFFFF', margin: 0, letterSpacing: '-0.3px' }}>
              Messages
            </h2>
            <button
              onClick={() => setIsGroupModalOpen(true)}
              style={{
                background: '#242428',
                border: '1px solid #323238',
                borderRadius: '14px',
                padding: '5px 12px',
                color: '#FFFFFF',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#FFFFFF')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#323238')}
            >
              + New Group
            </button>
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              background: '#09090B',
              border: '1px solid #242428',
              borderRadius: '12px',
              padding: '8px 12px',
              color: '#FFFFFF',
              fontSize: '13px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* SECTION 1: NEARBY DISCOVERED DEVICES ON WI-FI */}
        <div style={{ padding: '12px 18px 8px 18px', borderBottom: '1px solid #1C1C20' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 800, color: '#8E8E93', letterSpacing: '0.4px', textTransform: 'uppercase' }}>
              Nearby Devices ({peers.length})
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: peers.length > 0 ? '#34C759' : '#8E8E93',
                  boxShadow: peers.length > 0 ? '0 0 6px #34C759' : 'none',
                }}
              />
              <span style={{ fontSize: '10px', color: '#8E8E93' }}>
                {peers.length > 0 ? 'Wi-Fi Active' : 'Scanning'}
              </span>
            </div>
          </div>

          {peers.length === 0 ? (
            <div style={{ padding: '8px 0', fontSize: '11px', color: '#636366' }}>
              Searching for AuraDrop devices on your local network...
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '6px' }}>
              {peers.map((p) => {
                const isSelected = activeConv?.members?.some((m) => m.id === p.id);
                return (
                  <div
                    key={p.id}
                    onClick={() => handleOpenPeerChat(p)}
                    title={`Start chatting with ${p.name}`}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px',
                      cursor: 'pointer',
                      padding: '6px 8px',
                      borderRadius: '12px',
                      background: isSelected ? '#24242C' : 'transparent',
                      minWidth: '60px',
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        position: 'relative',
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        background: '#242428',
                        border: '1px solid #34343A',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '13px',
                        fontWeight: 800,
                        color: '#FFFFFF',
                      }}
                    >
                      {p.name.charAt(0).toUpperCase()}
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 0,
                          right: 0,
                          width: '9px',
                          height: '9px',
                          borderRadius: '50%',
                          background: '#34C759',
                          border: '2px solid #141418',
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        color: '#FFFFFF',
                        maxWidth: '64px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.name}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* SECTION 2: CONVERSATION LIST */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: '12px 18px 4px 18px', fontSize: '11px', fontWeight: 800, color: '#8E8E93', letterSpacing: '0.4px', textTransform: 'uppercase' }}>
            Conversations
          </div>
          {filteredConversations.length === 0 ? (
            <div style={{ padding: '24px 20px', textAlign: 'center', color: '#8E8E93', fontSize: '12px', lineHeight: 1.5 }}>
              No messages yet.<br />Click any nearby device above to start a direct chat!
            </div>
          ) : (
            filteredConversations.map((c) => {
              const isActive = c.id === activeConvId;
              const otherMember = c.members?.find((m) => m.id !== currentUserId);
              const displayName =
                c.type === 'GROUP'
                  ? c.title
                  : otherMember?.display_name || otherMember?.username || 'Direct Chat';
              const avatar = c.type === 'GROUP' ? c.avatar_url : otherMember?.avatar_url;
              const initials = (displayName || 'C').substring(0, 2).toUpperCase();

              return (
                <div
                  key={c.id}
                  onClick={() => setActiveConvId(c.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 18px',
                    borderBottom: '1px solid #1C1C20',
                    cursor: 'pointer',
                    background: isActive ? '#1E1E24' : 'transparent',
                    transition: 'background 0.15s ease',
                  }}
                >
                  {/* Avatar */}
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      background: c.type === 'GROUP' ? '#32323A' : '#24242A',
                      border: '1px solid #3A3A42',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#FFFFFF',
                      fontWeight: 800,
                      fontSize: '13px',
                      flexShrink: 0,
                      overflow: 'hidden',
                    }}
                  >
                    {avatar ? (
                      <img src={avatar} alt={displayName || 'Avatar'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      initials
                    )}
                  </div>

                  {/* Details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: 700,
                          color: '#FFFFFF',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {displayName}
                      </span>
                      <span style={{ fontSize: '10px', color: '#636366' }}>
                        {c.last_message_at
                          ? new Date(c.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : ''}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: '12px',
                        color: '#8E8E93',
                        marginTop: '2px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {c.last_message?.is_deleted_everyone
                        ? 'Deleted message'
                        : c.last_message?.text || (c.type === 'GROUP' ? 'Group created' : 'Start messaging')}
                    </div>
                  </div>

                  {/* Unread badge */}
                  {(c.unread_count || 0) > 0 && (
                    <div
                      style={{
                        background: '#FFFFFF',
                        color: '#000000',
                        borderRadius: '10px',
                        fontSize: '10px',
                        fontWeight: 900,
                        padding: '1px 6px',
                      }}
                    >
                      {c.unread_count}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* RIGHT PANE: ACTIVE CONVERSATION STREAM                              */}
      {/* ------------------------------------------------------------------- */}
      {activeConv ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0E0E10' }}>
          {/* Header */}
          <div
            style={{
              padding: '14px 22px',
              borderBottom: '1px solid #202024',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#141418',
            }}
          >
            <div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#FFFFFF' }}>
                {activeConv.type === 'GROUP'
                  ? activeConv.title
                  : activeConv.members?.find((m) => m.id !== currentUserId)?.display_name || 'Direct Chat'}
              </div>
              <div style={{ fontSize: '11px', color: '#34C759', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#34C759' }} />
                Real-Time Network Connected • Neon DB Synced
                {activeConv.type === 'GROUP' ? ` • ${activeConv.members?.length || 0} members` : ''}
              </div>
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Disappearing Messages Dropdown */}
              <select
                value={disappearingSeconds}
                onChange={(e) => handleSetDisappearing(parseInt(e.target.value, 10))}
                style={{
                  background: '#242428',
                  border: '1px solid #323238',
                  borderRadius: '12px',
                  color: disappearingSeconds > 0 ? '#FF9F0A' : '#8E8E93',
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '6px 10px',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <option value={0}>⏳ Disappearing: Off</option>
                <option value={30}>⏳ 30 seconds</option>
                <option value={60}>⏳ 1 minute</option>
                <option value={120}>⏳ 2 minutes (Quick)</option>
                <option value={300}>⏳ 5 minutes</option>
                <option value={600}>⏳ 10 minutes</option>
                <option value={3600}>⏳ 1 hour</option>
                <option value={86400}>⏳ 24 hours</option>
              </select>

              <button
                onClick={handleClearChat}
                style={{
                  background: '#242428',
                  border: '1px solid #323238',
                  borderRadius: '12px',
                  color: '#FF453A',
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '6px 12px',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Messages Stream */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            {messages.length === 0 ? (
              <div style={{ margin: 'auto', textAlign: 'center', color: '#636366', fontSize: '13px' }}>
                No messages yet. Send a message or attach a file below!
              </div>
            ) : (
              messages.map((m) => {
                const isMe = m.sender_id === currentUserId;
                return (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: isMe ? 'flex-end' : 'flex-start',
                      maxWidth: '72%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isMe ? 'flex-end' : 'flex-start',
                    }}
                  >
                    {!isMe && activeConv.type === 'GROUP' && (
                      <span style={{ fontSize: '11px', color: '#8E8E93', fontWeight: 700, marginBottom: '2px', marginLeft: '4px' }}>
                        {m.sender?.display_name || m.sender?.username || 'User'}
                      </span>
                    )}

                    <div
                      style={{
                        background: isMe ? '#282830' : '#1C1C20',
                        color: '#FFFFFF',
                        borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                        padding: '10px 14px',
                        fontSize: '13.5px',
                        lineHeight: 1.45,
                        border: isMe ? '1px solid #383842' : '1px solid #28282E',
                        wordBreak: 'break-word',
                        position: 'relative',
                      }}
                    >
                      {/* File Card Rendering if type is FILE */}
                      {m.type === 'FILE' && m.attachments && m.attachments.length > 0 ? (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            background: 'rgba(0, 0, 0, 0.35)',
                            padding: '8px 12px',
                            borderRadius: '12px',
                            marginBottom: '6px',
                            border: '1px solid #28282E',
                          }}
                        >
                          <span style={{ fontSize: '24px' }}>📁</span>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '12.5px' }}>{m.attachments[0].file_name}</div>
                            <div style={{ fontSize: '11px', color: '#8E8E93' }}>
                              {(m.attachments[0].file_size / (1024 * 1024)).toFixed(2)} MB
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {m.is_deleted_everyone ? (
                        <i style={{ opacity: 0.6 }}>{m.text}</i>
                      ) : (
                        <span>{m.text}</span>
                      )}

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          gap: '4px',
                          fontSize: '10px',
                          color: '#8E8E93',
                          marginTop: '4px',
                        }}
                      >
                        {m.expires_at && <span>⏳</span>}
                        <span>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {isMe && <span>✓✓</span>}
                      </div>
                    </div>

                    {/* Delete for everyone action if message is mine and not deleted */}
                    {isMe && !m.is_deleted_everyone && (
                      <button
                        onClick={() => handleDeleteMessage(m.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#636366',
                          fontSize: '10px',
                          cursor: 'pointer',
                          marginTop: '3px',
                          padding: '0 4px',
                        }}
                      >
                        Delete for everyone
                      </button>
                    )}
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input Bar */}
          <div
            style={{
              padding: '14px 20px',
              borderTop: '1px solid #202024',
              display: 'flex',
              gap: '10px',
              alignItems: 'center',
              background: '#141418',
            }}
          >
            {/* Attachment Button */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleSendFileAttachment}
              style={{ display: 'none' }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Attach File for P2P Transfer & Chat"
              style={{
                background: '#242428',
                border: '1px solid #323238',
                borderRadius: '50%',
                width: '38px',
                height: '38px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                cursor: 'pointer',
                fontSize: '16px',
              }}
            >
              📎
            </button>

            <input
              type="text"
              placeholder="Type message..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              style={{
                flex: 1,
                background: '#09090B',
                border: '1px solid #242428',
                borderRadius: '16px',
                padding: '10px 16px',
                color: '#FFFFFF',
                fontSize: '13.5px',
                outline: 'none',
              }}
            />

            <button
              onClick={handleSendMessage}
              style={{
                background: '#FFFFFF',
                border: 'none',
                borderRadius: '16px',
                padding: '10px 20px',
                color: '#000000',
                fontSize: '13px',
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'opacity 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              Send
            </button>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#636366', fontSize: '13px', gap: '8px' }}>
          <div style={{ fontSize: '32px' }}>💬</div>
          <div>Select a conversation or click a nearby device on your network to begin chatting.</div>
        </div>
      )}

      {/* CREATE GROUP MODAL */}
      {isGroupModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: '#16161A',
              border: '1px solid #28282E',
              borderRadius: '20px',
              padding: '24px',
              width: '100%',
              maxWidth: '420px',
            }}
          >
            <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#FFFFFF', margin: '0 0 16px 0' }}>
              Create Group Chat
            </h3>
            <input
              type="text"
              placeholder="Group Name (e.g. Project Team)"
              value={groupTitleInput}
              onChange={(e) => setGroupTitleInput(e.target.value)}
              style={{
                width: '100%',
                background: '#09090B',
                border: '1px solid #28282E',
                borderRadius: '12px',
                padding: '10px 14px',
                color: '#FFFFFF',
                fontSize: '14px',
                marginBottom: '16px',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: '12px', color: '#8E8E93', marginBottom: '8px', fontWeight: 700 }}>
              Select Members:
            </div>
            <div style={{ maxHeight: '160px', overflowY: 'auto', marginBottom: '16px' }}>
              {peers.length === 0 ? (
                <div style={{ color: '#636366', fontSize: '12px' }}>
                  No nearby peers online. You can still create the group now.
                </div>
              ) : (
                peers.map((p) => {
                  const isChecked = selectedGroupMemberIds.includes(p.id);
                  return (
                    <div
                      key={p.id}
                      onClick={() => {
                        setSelectedGroupMemberIds((prev) =>
                          isChecked ? prev.filter((id) => id !== p.id) : [...prev, p.id]
                        );
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '8px 10px',
                        cursor: 'pointer',
                        background: isChecked ? '#24242C' : 'transparent',
                        borderRadius: '8px',
                      }}
                    >
                      <input type="checkbox" checked={isChecked} readOnly />
                      <span style={{ fontSize: '13px', color: '#FFFFFF' }}>{p.name}</span>
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setIsGroupModalOpen(false)}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: '#242428',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#FFFFFF',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateGroup}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: '#FFFFFF',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#000000',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
