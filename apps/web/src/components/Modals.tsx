import React, { useState } from 'react';
import { PeerDevice, PickedFile, VisibilityMode } from '../types';

interface ModalWrapperProps {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export const ModalWrapper: React.FC<ModalWrapperProps> = ({
  title,
  isOpen,
  onClose,
  children,
}) => {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(16px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9000,
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#121214',
          border: '1px solid #242428',
          borderRadius: '24px',
          width: '100%',
          maxWidth: '520px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 24px',
            borderBottom: '1px solid #1C1C1E',
          }}
        >
          <div style={{ fontSize: '16px', fontWeight: 800, color: '#FFFFFF' }}>{title}</div>
          <button
            onClick={onClose}
            style={{
              background: '#1A1A1E',
              border: '1px solid #2A2A2E',
              borderRadius: '50%',
              width: '30px',
              height: '30px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#8E8E93',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>{children}</div>
      </div>
    </div>
  );
};

// Chat Modal
export const ChatModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  peer?: PeerDevice | null;
}> = ({ isOpen, onClose, peer }) => {
  const [messages, setMessages] = useState<Array<{ sender: string; text: string; time: string }>>([
    {
      sender: peer?.name || 'Peer',
      text: 'Connected via zero-relay local P2P. Ready to exchange files and instant messages.',
      time: 'Just now',
    },
  ]);
  const [input, setInput] = useState('');

  const sendMessage = () => {
    if (!input.trim()) return;
    setMessages((prev) => [...prev, { sender: 'You', text: input.trim(), time: 'Just now' }]);
    setInput('');
  };

  return (
    <ModalWrapper title={`Encrypted Chat • ${peer?.name || 'Nearby Device'}`} isOpen={isOpen} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '360px' }}>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingBottom: '12px' }}>
          {messages.map((m, idx) => {
            const isMe = m.sender === 'You';
            return (
              <div
                key={idx}
                style={{
                  alignSelf: isMe ? 'flex-end' : 'flex-start',
                  maxWidth: '75%',
                  background: isMe ? '#0A84FF' : '#1C1C1F',
                  color: '#FFFFFF',
                  padding: '10px 14px',
                  borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                  fontSize: '13px',
                  border: isMe ? 'none' : '1px solid #28282C',
                }}
              >
                <div>{m.text}</div>
                <div style={{ fontSize: '10px', color: isMe ? 'rgba(255,255,255,0.7)' : '#8E8E93', marginTop: '4px', textAlign: 'right' }}>
                  {m.time}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: '8px', paddingTop: '12px', borderTop: '1px solid #1C1C1E' }}>
          <input
            type="text"
            placeholder="Type encrypted message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            style={{
              flex: 1,
              background: '#09090B',
              border: '1px solid #242428',
              borderRadius: '16px',
              padding: '10px 16px',
              color: '#FFFFFF',
              fontSize: '13px',
              outline: 'none',
            }}
          />
          <button
            onClick={sendMessage}
            style={{
              background: '#0A84FF',
              border: 'none',
              borderRadius: '16px',
              padding: '10px 18px',
              color: '#FFFFFF',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Send
          </button>
        </div>
      </div>
    </ModalWrapper>
  );
};

// Settings Modal
export const SettingsModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  visibility: VisibilityMode;
  onVisibilityChange: (mode: VisibilityMode) => void;
}> = ({ isOpen, onClose, visibility, onVisibilityChange }) => {
  return (
    <ModalWrapper title="AuraDrop Settings" isOpen={isOpen} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#8E8E93', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Device Visibility
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {(['everyone', 'contacts', 'off'] as VisibilityMode[]).map((mode) => (
              <div
                key={mode}
                onClick={() => onVisibilityChange(mode)}
                style={{
                  background: visibility === mode ? '#18181E' : '#101012',
                  border: `1px solid ${visibility === mode ? '#0A84FF' : '#202024'}`,
                  borderRadius: '14px',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                }}
              >
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#FFFFFF', textTransform: 'capitalize' }}>
                    {mode === 'everyone' ? 'Everyone Nearby' : mode === 'contacts' ? 'Contacts Only' : 'Receiving Off'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#8E8E93', marginTop: '2px' }}>
                    {mode === 'everyone'
                      ? 'Discoverable by all AuraDrop devices on local Wi-Fi or subnet'
                      : mode === 'contacts'
                      ? 'Only known trusted peer devices can initiate transfers'
                      : 'Not discoverable; you can still send files to other devices'}
                  </div>
                </div>
                <div
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    border: `2px solid ${visibility === mode ? '#0A84FF' : '#3A3A3E'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {visibility === mode && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#0A84FF' }} />}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ borderTop: '1px solid #1C1C1E', paddingTop: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#8E8E93', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Android Native Companion
          </div>
          <p style={{ fontSize: '12px', color: '#8E8E93', lineHeight: '1.5', marginBottom: '12px' }}>
            Connect this desktop web browser to your Android device with zero cloud upload.
          </p>
          <a
            href="https://github.com/JACK-AI7/AuraDrop/releases"
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              background: '#0A84FF',
              color: '#FFFFFF',
              textDecoration: 'none',
              padding: '12px 20px',
              borderRadius: '16px',
              fontSize: '13px',
              fontWeight: 800,
            }}
          >
            Download AuraDrop-V11-Release.apk
          </a>
        </div>
      </div>
    </ModalWrapper>
  );
};

// Profile Modal
export const ProfileModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  deviceName: string;
}> = ({ isOpen, onClose, deviceName }) => {
  return (
    <ModalWrapper title="Device Identity" isOpen={isOpen} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '12px 0' }}>
        <div
          style={{
            width: '68px',
            height: '68px',
            borderRadius: '50%',
            background: '#0A84FF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
            fontWeight: 800,
            color: '#FFFFFF',
            boxShadow: '0 0 24px rgba(10, 132, 255, 0.4)',
          }}
        >
          {deviceName.charAt(0).toUpperCase()}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 800, color: '#FFFFFF' }}>{deviceName}</div>
          <div style={{ fontSize: '12px', color: '#8E8E93', marginTop: '4px' }}>WebRTC / TCP DataChannel Peer</div>
        </div>

        <div style={{ width: '100%', background: '#0D0D10', border: '1px solid #1F1F24', borderRadius: '16px', padding: '14px', marginTop: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '6px 0', borderBottom: '1px solid #1A1A1E' }}>
            <span style={{ color: '#8E8E93' }}>Protocol</span>
            <span style={{ color: '#FFFFFF', fontWeight: 600 }}>P2PFS/1 (AURA-0x41555241)</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '6px 0', borderBottom: '1px solid #1A1A1E' }}>
            <span style={{ color: '#8E8E93' }}>Encryption</span>
            <span style={{ color: '#FFFFFF', fontWeight: 600 }}>X25519 + AES-GCM + SHA-256</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '6px 0' }}>
            <span style={{ color: '#8E8E93' }}>Transfer Engine</span>
            <span style={{ color: '#34C759', fontWeight: 600 }}>Zero-Copy Chunk Stream</span>
          </div>
        </div>
      </div>
    </ModalWrapper>
  );
};
