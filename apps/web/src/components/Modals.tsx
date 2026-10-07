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

// Profile & Account Modal (Section 8: Real Users & Accounts)
export const ProfileModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  deviceName: string;
}> = ({ isOpen, onClose, deviceName }) => {
  const [tab, setTab] = useState<'device' | 'account'>('device');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [user, setUser] = useState<{ id: string; username: string; email: string; displayName: string } | null>(() => {
    try {
      const saved = localStorage.getItem('auradrop_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [loginInput, setLoginInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const getApiUrl = () => {
    return (
      (import.meta as any).env?.VITE_BACKEND_URL ||
      (window.location.hostname === 'localhost'
        ? `http://${window.location.hostname}:48280`
        : `https://${window.location.hostname}:48280`)
    );
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch(`${getApiUrl()}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login: loginInput.trim(),
          password: passwordInput,
          deviceId: `dev_web_${deviceName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }

      localStorage.setItem('auradrop_auth_token', data.accessToken);
      localStorage.setItem('auradrop_refresh_token', data.refreshToken);
      localStorage.setItem('auradrop_user', JSON.stringify(data.user));
      setUser(data.user);
      setLoginInput('');
      setPasswordInput('');
    } catch (err: any) {
      setAuthError(err.message || 'Authentication error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch(`${getApiUrl()}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginInput.trim(),
          email: emailInput.trim(),
          displayName: displayNameInput.trim() || loginInput.trim(),
          password: passwordInput,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Registration failed');
      }

      localStorage.setItem('auradrop_auth_token', data.accessToken);
      localStorage.setItem('auradrop_refresh_token', data.refreshToken);
      localStorage.setItem('auradrop_user', JSON.stringify(data.user));
      setUser(data.user);
      setPasswordInput('');
    } catch (err: any) {
      setAuthError(err.message || 'Registration error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      const refreshToken = localStorage.getItem('auradrop_refresh_token');
      if (refreshToken) {
        await fetch(`${getApiUrl()}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        }).catch(() => {});
      }
    } finally {
      localStorage.removeItem('auradrop_auth_token');
      localStorage.removeItem('auradrop_refresh_token');
      localStorage.removeItem('auradrop_user');
      setUser(null);
    }
  };

  return (
    <ModalWrapper title="Device & Account Identity" isOpen={isOpen} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Navigation Sub-Tabs */}
        <div style={{ display: 'flex', background: '#0D0D10', borderRadius: '12px', padding: '4px', gap: '4px' }}>
          <button
            onClick={() => setTab('device')}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: '8px',
              border: 'none',
              background: tab === 'device' ? '#1F1F24' : 'transparent',
              color: tab === 'device' ? '#FFFFFF' : '#8E8E93',
              fontWeight: 700,
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Device Identity
          </button>
          <button
            onClick={() => setTab('account')}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: '8px',
              border: 'none',
              background: tab === 'account' ? '#1F1F24' : 'transparent',
              color: tab === 'account' ? '#FFFFFF' : '#8E8E93',
              fontWeight: 700,
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            {user ? 'Account Profile' : 'Sign In / Register'}
          </button>
        </div>

        {tab === 'device' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '8px 0' }}>
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
              <div style={{ fontSize: '12px', color: '#8E8E93', marginTop: '4px' }}>
                {user ? `Linked to @${user.username}` : 'Standalone Anonymous Device'}
              </div>
            </div>

            <div style={{ width: '100%', background: '#0D0D10', border: '1px solid #1F1F24', borderRadius: '16px', padding: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '6px 0', borderBottom: '1px solid #1A1A1E' }}>
                <span style={{ color: '#8E8E93' }}>Protocol</span>
                <span style={{ color: '#FFFFFF', fontWeight: 600 }}>P2PFS/1 (AURA-0x41555241)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '6px 0', borderBottom: '1px solid #1A1A1E' }}>
                <span style={{ color: '#8E8E93' }}>Transport</span>
                <span style={{ color: '#FFFFFF', fontWeight: 600 }}>WebRTC DataChannel / Direct LAN</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '6px 0', borderBottom: '1px solid #1A1A1E' }}>
                <span style={{ color: '#8E8E93' }}>Integrity Check</span>
                <span style={{ color: '#FFFFFF', fontWeight: 600 }}>Incremental SHA-256</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '6px 0' }}>
                <span style={{ color: '#8E8E93' }}>Transfer Engine</span>
                <span style={{ color: '#34C759', fontWeight: 600 }}>Zero-Copy Chunk Stream</span>
              </div>
            </div>
          </div>
        ) : user ? (
          /* Logged In View */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', background: '#0D0D10', padding: '16px', borderRadius: '16px', border: '1px solid #1F1F24' }}>
              <div
                style={{
                  width: '50px',
                  height: '50px',
                  borderRadius: '50%',
                  background: '#30D158',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                  fontWeight: 800,
                  color: '#FFFFFF',
                }}
              >
                {user.displayName.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '16px', fontWeight: 800, color: '#FFFFFF' }}>{user.displayName}</div>
                <div style={{ fontSize: '12px', color: '#8E8E93' }}>@{user.username} • {user.email}</div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '4px', background: 'rgba(48, 209, 88, 0.15)', color: '#30D158', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700 }}>
                  ● Authenticated Account
                </div>
              </div>
            </div>

            <button
              onClick={handleLogout}
              style={{
                background: '#2C1517',
                border: '1px solid #4D1F23',
                color: '#FF453A',
                padding: '12px',
                borderRadius: '12px',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Sign Out of Account
            </button>
          </div>
        ) : (
          /* Auth Form View */
          <form onSubmit={authMode === 'login' ? handleLogin : handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {authError && (
              <div style={{ background: 'rgba(255, 69, 58, 0.15)', border: '1px solid #FF453A', color: '#FF453A', padding: '10px 14px', borderRadius: '10px', fontSize: '12px' }}>
                {authError}
              </div>
            )}

            {authMode === 'register' && (
              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#8E8E93', textTransform: 'uppercase', marginBottom: '4px', display: 'block' }}>
                  Full / Display Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Jaswanth"
                  value={displayNameInput}
                  onChange={(e) => setDisplayNameInput(e.target.value)}
                  style={{ width: '100%', background: '#0D0D10', border: '1px solid #1F1F24', borderRadius: '10px', padding: '10px 14px', color: '#FFF', fontSize: '13px' }}
                />
              </div>
            )}

            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#8E8E93', textTransform: 'uppercase', marginBottom: '4px', display: 'block' }}>
                {authMode === 'login' ? 'Username or Email' : 'Username'}
              </label>
              <input
                type="text"
                required
                placeholder={authMode === 'login' ? 'username or user@domain.com' : 'username'}
                value={loginInput}
                onChange={(e) => setLoginInput(e.target.value)}
                style={{ width: '100%', background: '#0D0D10', border: '1px solid #1F1F24', borderRadius: '10px', padding: '10px 14px', color: '#FFF', fontSize: '13px' }}
              />
            </div>

            {authMode === 'register' && (
              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#8E8E93', textTransform: 'uppercase', marginBottom: '4px', display: 'block' }}>
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="user@domain.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  style={{ width: '100%', background: '#0D0D10', border: '1px solid #1F1F24', borderRadius: '10px', padding: '10px 14px', color: '#FFF', fontSize: '13px' }}
                />
              </div>
            )}

            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#8E8E93', textTransform: 'uppercase', marginBottom: '4px', display: 'block' }}>
                Password
              </label>
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                style={{ width: '100%', background: '#0D0D10', border: '1px solid #1F1F24', borderRadius: '10px', padding: '10px 14px', color: '#FFF', fontSize: '13px' }}
              />
            </div>

            <button
              type="submit"
              disabled={authLoading}
              style={{
                background: '#0A84FF',
                border: 'none',
                borderRadius: '12px',
                padding: '12px',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: '13px',
                cursor: 'pointer',
                marginTop: '6px',
                opacity: authLoading ? 0.7 : 1,
              }}
            >
              {authLoading ? 'Authenticating...' : authMode === 'login' ? 'Sign In' : 'Create Account'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '6px' }}>
              <button
                type="button"
                onClick={() => {
                  setAuthMode(authMode === 'login' ? 'register' : 'login');
                  setAuthError('');
                }}
                style={{ background: 'none', border: 'none', color: '#0A84FF', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}
              >
                {authMode === 'login' ? "Don't have an account? Create one" : 'Already have an account? Sign In'}
              </button>
            </div>
          </form>
        )}
      </div>
    </ModalWrapper>
  );
};

