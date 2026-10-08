import React, { useState, useEffect, useRef } from 'react';
import jsQR from 'jsqr';
import { PeerDevice } from '../types';
import { LocalSignalingClient } from '../engine/localSignalingClient';
import { TransferStorage } from '../engine/transferStorage';

interface DevicePairModalProps {
  isOpen: boolean;
  onClose: () => void;
  localId: string;
  localName: string;
  peers: PeerDevice[];
}

type PairTab = 'scan_qr' | 'manual_ip' | 'cloud_sync';

export const DevicePairModal: React.FC<DevicePairModalProps> = ({
  isOpen,
  onClose,
  localId,
  localName,
  peers,
}) => {
  const [activeTab, setActiveTab] = useState<PairTab>('scan_qr');
  const [isCopied, setIsCopied] = useState(false);

  // Scanner state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const animFrameId = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Manual IP state
  const [manualEndpoint, setManualEndpoint] = useState('192.168.');
  const [isConnectingManual, setIsConnectingManual] = useState(false);
  const [manualStatus, setManualStatus] = useState<string | null>(null);

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const signalingUrl = `${currentOrigin}/api/signaling`;

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setScanStatus(null);
      setScanError(null);
      setManualStatus(null);
    }
  }, [isOpen]);

  const stopCamera = () => {
    if (animFrameId.current) {
      cancelAnimationFrame(animFrameId.current);
      animFrameId.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const startCamera = async () => {
    setScanError(null);
    setScanStatus('Starting camera...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        setCameraActive(true);
        setScanStatus('Scanning for AuraDrop QR code...');
        scanLoop();
      }
    } catch (e: any) {
      setCameraActive(false);
      setScanError(e?.message || 'Camera access denied or not available.');
      setScanStatus(null);
    }
  };

  const scanLoop = () => {
    if (!videoRef.current || !canvasRef.current || videoRef.current.readyState < 2) {
      animFrameId.current = requestAnimationFrame(scanLoop);
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (ctx && video.videoWidth > 0 && video.videoHeight > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });

      if (code && code.data) {
        try {
          const payload = JSON.parse(code.data);
          if (payload.protocol === 'AURADROP_LOCAL_V1') {
            stopCamera();
            handleQrPayloadDiscovered(payload);
            return;
          }
        } catch {
          // Non-JSON QR, continue scanning
        }
      }
    }

    animFrameId.current = requestAnimationFrame(scanLoop);
  };

  const handleQrPayloadDiscovered = async (payload: any) => {
    setScanStatus(`Pairing with ${payload.deviceName} (${payload.ip}:${payload.port})...`);
    const localClient = LocalSignalingClient.getInstance();

    const pairRes = await localClient.pair(payload.ip, payload.port, payload.bootstrapToken);
    if (!pairRes.success) {
      setScanError(`Pairing failed: ${pairRes.error || 'Connection refused'}`);
      setScanStatus(null);
      return;
    }

    // Connect WebSocket
    const wsConnected = await localClient.connectWebSocket(payload.ip, payload.port, pairRes.sessionToken);
    if (wsConnected) {
      // Save trusted device record
      TransferStorage.getInstance().saveTrustedDevice({
        deviceId: payload.deviceId,
        name: payload.deviceName,
        platform: 'android',
        relationshipId: `rel_${Date.now()}`,
        pairedAt: new Date().toISOString(),
        localIp: payload.ip,
        localPort: payload.port,
        sessionToken: pairRes.sessionToken,
        isLocal: true,
      });

      setScanStatus(`✓ Paired successfully with ${payload.deviceName} via Direct LAN!`);
      setTimeout(() => {
        onClose();
      }, 1500);
    } else {
      setScanError('Connected via HTTP, but WebSocket failed to upgrade.');
      setScanStatus(null);
    }
  };

  const handleManualConnect = async () => {
    let raw = manualEndpoint.trim();
    if (!raw) return;

    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      raw = raw.replace(/^https?:\/\//, '');
    }

    let ip = raw;
    let port = 53317;
    if (raw.includes(':')) {
      const parts = raw.split(':');
      ip = parts[0];
      port = parseInt(parts[1], 10) || 53317;
    }

    setIsConnectingManual(true);
    setManualStatus(`Testing ${ip}:${port}...`);

    const localClient = LocalSignalingClient.getInstance();
    const health = await localClient.testEndpoint(ip, port);

    if (!health.ok) {
      setManualStatus(`✕ Could not reach http://${ip}:${port}. Ensure devices are on same Wi-Fi.`);
      setIsConnectingManual(false);
      return;
    }

    const deviceName = health.info?.deviceName || 'Android Phone';
    const deviceId = health.info?.deviceId || `android_${Date.now()}`;

    setManualStatus(`Found ${deviceName}! Connecting local WebSocket...`);
    const wsConnected = await localClient.connectWebSocket(ip, port);

    setIsConnectingManual(false);
    if (wsConnected) {
      TransferStorage.getInstance().saveTrustedDevice({
        deviceId,
        name: deviceName,
        platform: 'android',
        relationshipId: `rel_${Date.now()}`,
        pairedAt: new Date().toISOString(),
        localIp: ip,
        localPort: port,
        isLocal: true,
      });
      setManualStatus(`✓ Connected to ${deviceName} over LAN!`);
      setTimeout(() => {
        onClose();
      }, 1500);
    } else {
      setManualStatus(`✕ WebSocket handshake failed at ws://${ip}:${port}/ws.`);
    }
  };

  const handleCopySignalingUrl = () => {
    navigator.clipboard.writeText(signalingUrl);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2200);
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.82)',
        backdropFilter: 'blur(20px)',
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
          background: '#0D0D10',
          border: '1px solid #27272A',
          borderRadius: '24px',
          width: '100%',
          maxWidth: '540px',
          padding: '24px',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.95)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>📱</span>
            <h2 style={{ fontSize: '17px', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
              Pair Android Mobile App
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: '#18181B',
              border: '1px solid #27272A',
              borderRadius: '50%',
              width: '30px',
              height: '30px',
              color: '#A1A1AA',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
            }}
          >
            ✕
          </button>
        </div>

        {/* This Desktop Info */}
        <div style={{ background: '#141418', border: '1px solid #222226', borderRadius: '16px', padding: '12px 14px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '10px', color: '#71717A', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.4px' }}>This Desktop</div>
              <div style={{ fontSize: '14px', fontWeight: 800, color: '#FFFFFF', marginTop: '2px' }}>{localName}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#34C759', boxShadow: '0 0 8px #34C759' }} />
              <span style={{ fontSize: '11px', color: '#34C759', fontWeight: 700 }}>Online & Ready</span>
            </div>
          </div>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', gap: '6px', background: '#121216', padding: '4px', borderRadius: '12px', marginBottom: '16px' }}>
          <button
            onClick={() => {
              setActiveTab('scan_qr');
              stopCamera();
            }}
            style={{
              flex: 1,
              padding: '8px 10px',
              borderRadius: '8px',
              border: 'none',
              background: activeTab === 'scan_qr' ? '#27272A' : 'transparent',
              color: activeTab === 'scan_qr' ? '#FFFFFF' : '#A1A1AA',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            📷 Scan QR Code
          </button>
          <button
            onClick={() => {
              setActiveTab('manual_ip');
              stopCamera();
            }}
            style={{
              flex: 1,
              padding: '8px 10px',
              borderRadius: '8px',
              border: 'none',
              background: activeTab === 'manual_ip' ? '#27272A' : 'transparent',
              color: activeTab === 'manual_ip' ? '#FFFFFF' : '#A1A1AA',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            ⌨️ Manual LAN IP
          </button>
          <button
            onClick={() => {
              setActiveTab('cloud_sync');
              stopCamera();
            }}
            style={{
              flex: 1,
              padding: '8px 10px',
              borderRadius: '8px',
              border: 'none',
              background: activeTab === 'cloud_sync' ? '#27272A' : 'transparent',
              color: activeTab === 'cloud_sync' ? '#FFFFFF' : '#A1A1AA',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            📋 Cloud Sync
          </button>
        </div>

        {/* TAB 1: SCAN QR CODE */}
        {activeTab === 'scan_qr' && (
          <div style={{ background: '#121216', border: '1px solid #1E1E24', borderRadius: '18px', padding: '16px', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#FFFFFF', marginBottom: '6px' }}>
              Scan Android QR Code
            </div>
            <p style={{ fontSize: '12px', color: '#A1A1AA', lineHeight: '1.45', margin: '0 0 12px 0' }}>
              Tap the <strong>QR icon</strong> on top of the AuraDrop Android App, then hold it up to your laptop camera to connect directly over local Wi-Fi.
            </p>

            <div style={{ position: 'relative', width: '100%', height: '200px', background: '#000000', borderRadius: '14px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <video
                ref={videoRef}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: cameraActive ? 'block' : 'none',
                }}
              />
              <canvas ref={canvasRef} style={{ display: 'none' }} />

              {!cameraActive && (
                <div style={{ textAlign: 'center', padding: '20px' }}>
                  <div style={{ fontSize: '32px', marginBottom: '10px' }}>📷</div>
                  <button
                    onClick={startCamera}
                    style={{
                      background: '#FFFFFF',
                      border: 'none',
                      borderRadius: '10px',
                      padding: '10px 20px',
                      color: '#000000',
                      fontSize: '13px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Open Camera Scanner
                  </button>
                </div>
              )}

              {cameraActive && (
                <div
                  style={{
                    position: 'absolute',
                    width: '140px',
                    height: '140px',
                    border: '2px dashed #34C759',
                    borderRadius: '16px',
                    pointerEvents: 'none',
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.45)',
                  }}
                />
              )}
            </div>

            {scanStatus && (
              <div style={{ marginTop: '10px', fontSize: '12px', color: '#34C759', fontWeight: 600, textAlign: 'center' }}>
                {scanStatus}
              </div>
            )}
            {scanError && (
              <div style={{ marginTop: '10px', fontSize: '12px', color: '#EF4444', fontWeight: 600, textAlign: 'center' }}>
                {scanError}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: MANUAL LAN IP */}
        {activeTab === 'manual_ip' && (
          <div style={{ background: '#121216', border: '1px solid #1E1E24', borderRadius: '18px', padding: '16px', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#FFFFFF', marginBottom: '6px' }}>
              Direct LAN IP & Port
            </div>
            <p style={{ fontSize: '12px', color: '#A1A1AA', lineHeight: '1.45', margin: '0 0 12px 0' }}>
              Enter the phone's local IP and port displayed on its screen (default port <strong>53317</strong>):
            </p>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              <input
                type="text"
                value={manualEndpoint}
                onChange={(e) => setManualEndpoint(e.target.value)}
                placeholder="192.168.0.8:53317"
                style={{
                  flex: 1,
                  background: '#09090B',
                  border: '1px solid #27272A',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  color: '#FFFFFF',
                  fontSize: '13px',
                  fontFamily: 'monospace',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleManualConnect}
                disabled={isConnectingManual}
                style={{
                  background: '#FFFFFF',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '10px 18px',
                  color: '#000000',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: isConnectingManual ? 'not-allowed' : 'pointer',
                  opacity: isConnectingManual ? 0.7 : 1,
                }}
              >
                {isConnectingManual ? 'Connecting...' : 'Connect'}
              </button>
            </div>

            {manualStatus && (
              <div style={{ fontSize: '12px', color: manualStatus.includes('✓') ? '#34C759' : '#EF4444', fontWeight: 600 }}>
                {manualStatus}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: CLOUD SYNC */}
        {activeTab === 'cloud_sync' && (
          <div style={{ background: '#121216', border: '1px solid #1E1E24', borderRadius: '18px', padding: '16px', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#FFFFFF', marginBottom: '6px' }}>
              Cloud Signaling URL
            </div>
            <p style={{ fontSize: '12px', color: '#A1A1AA', lineHeight: '1.45', margin: '0 0 12px 0' }}>
              Use this if your devices are on separate networks (e.g., PC on Wi-Fi and Android on 5G):
            </p>

            <div
              style={{
                background: '#09090B',
                border: '1px solid #27272A',
                borderRadius: '12px',
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                marginBottom: '10px',
              }}
            >
              <div style={{ fontFamily: 'monospace', fontSize: '12px', color: '#FFFFFF', wordBreak: 'break-all' }}>
                {signalingUrl}
              </div>
              <button
                onClick={handleCopySignalingUrl}
                style={{
                  background: '#FFFFFF',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '6px 14px',
                  color: '#000000',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                {isCopied ? 'Copied ✓' : 'Copy URL'}
              </button>
            </div>
          </div>
        )}

        {/* Discovered Devices List */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#A1A1AA', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Active Devices Nearby ({peers.length})
            </div>
            {peers.length > 0 && (
              <span style={{ fontSize: '11px', color: '#34C759', fontWeight: 700 }}>
                ● {peers.filter((p) => p.platform === 'android').length} Android Phone(s)
              </span>
            )}
          </div>

          {peers.length === 0 ? (
            <div style={{ background: '#141418', border: '1px solid #222226', borderRadius: '14px', padding: '16px', textAlign: 'center' }}>
              <div style={{ fontSize: '20px', marginBottom: '6px' }}>📡</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF' }}>Listening for Android Phone...</div>
              <div style={{ fontSize: '11px', color: '#71717A', marginTop: '4px' }}>
                Devices appear on the 3D Globe automatically once paired.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '150px', overflowY: 'auto' }}>
              {peers.map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: '#16161A',
                    border: '1px solid #27272A',
                    borderRadius: '14px',
                    padding: '10px 14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: '#27272A',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '15px',
                      }}
                    >
                      {p.platform === 'android' ? '📱' : '💻'}
                    </div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#FFFFFF' }}>{p.name}</div>
                      <div style={{ fontSize: '11px', color: '#A1A1AA' }}>
                        {p.transport || (p.platform === 'android' ? 'Android Mobile App' : p.deviceName)}
                      </div>
                    </div>
                  </div>
                  <span style={{ fontSize: '11px', color: '#34C759', fontWeight: 700 }}>● Online</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
