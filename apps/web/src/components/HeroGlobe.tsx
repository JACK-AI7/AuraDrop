import React, { useEffect, useRef, useState, useCallback } from 'react';
import { PeerDevice } from '../types';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface HeroGlobeProps {
  peers: PeerDevice[];
  selectedPeerId?: string | null;
  onSelectPeer?: (peer: PeerDevice) => void;
  isTransferring?: boolean;
  size?: number;
}

function generateSpherePoints(count: number): Vec3[] {
  const points: Vec3[] = [];
  const phi = 2.399963229728653; // golden angle: pi * (3 - sqrt(5))
  for (let i = 0; i < count; i++) {
    const y = 1.0 - (i / (count - 1)) * 2.0;
    const radiusAtY = Math.sqrt(Math.max(0.0, 1.0 - y * y));
    const theta = phi * i;
    const x = Math.cos(theta) * radiusAtY;
    const z = Math.sin(theta) * radiusAtY;
    points.push({ x, y, z });
  }
  return points;
}

function rotateY(pt: Vec3, angle: number): Vec3 {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  return {
    x: pt.x * cosA + pt.z * sinA,
    y: pt.y,
    z: -pt.x * sinA + pt.z * cosA,
  };
}

function rotateX(pt: Vec3, angle: number): Vec3 {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  return {
    x: pt.x,
    y: pt.y * cosA - pt.z * sinA,
    z: pt.y * sinA + pt.z * cosA,
  };
}

function latLonToVec3(lat: number, lon: number): Vec3 {
  return {
    x: Math.cos(lat) * Math.sin(lon),
    y: -Math.sin(lat),
    z: Math.cos(lat) * Math.cos(lon),
  };
}

const SPHERE_POINTS = generateSpherePoints(380);

export const HeroGlobe: React.FC<HeroGlobeProps> = ({
  peers,
  selectedPeerId,
  onSelectPeer,
  isTransferring = false,
  size = 320,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [yaw, setYaw] = useState(0.0);
  const [pitch, setPitch] = useState(-0.25);
  const isInteractingRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const visiblePeerPositionsRef = useRef<Map<string, { x: number; y: number; peer: PeerDevice }>>(new Map());

  // Animation frame loop
  useEffect(() => {
    let animId: number;
    const animate = () => {
      if (!isInteractingRef.current) {
        setYaw((prev) => (prev + 0.0035) % (Math.PI * 2));
      }
      animId = requestAnimationFrame(animate);
    };
    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Canvas render pass
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = size;
    const height = size;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const center = { x: width / 2, y: height / 2 };
    const radius = size * 0.42;

    visiblePeerPositionsRef.current.clear();

    // 1. Draw back hemisphere dots
    for (const pt of SPHERE_POINTS) {
      const rotY = rotateY(pt, yaw);
      const rot = rotateX(rotY, pitch);
      if (rot.z <= 0) {
        const sx = center.x + rot.x * radius;
        const sy = center.y + rot.y * radius;
        ctx.beginPath();
        ctx.arc(sx, sy, 0.9, 0, Math.PI * 2);
        ctx.fillStyle = '#1c1c1f';
        ctx.fill();
      }
    }

    // 2. Draw front hemisphere dots
    for (const pt of SPHERE_POINTS) {
      const rotY = rotateY(pt, yaw);
      const rot = rotateX(rotY, pitch);
      if (rot.z > 0) {
        const sx = center.x + rot.x * radius;
        const sy = center.y + rot.y * radius;
        const dotRadius = 1.0 + rot.z * 1.3;
        ctx.beginPath();
        ctx.arc(sx, sy, dotRadius, 0, Math.PI * 2);
        const alpha = Math.min(1.0, 0.3 + rot.z * 0.7);
        ctx.fillStyle = `rgba(220, 220, 225, ${alpha})`;
        ctx.fill();
      }
    }

    // 3. User Anchor Marker ("YOU")
    const userLat = 0.28;
    const userLon = 0.0;
    const userSpherical = latLonToVec3(userLat, userLon);
    const userRot = rotateX(rotateY(userSpherical, yaw), pitch);

    if (userRot.z > -0.2) {
      const ux = center.x + userRot.x * radius;
      const uy = center.y + userRot.y * radius;

      // Outer ring
      ctx.beginPath();
      ctx.arc(ux, uy, 6.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Inner dot
      ctx.beginPath();
      ctx.arc(ux, uy, 3.0, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();

      // "YOU" Label
      ctx.font = '700 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.fillText('YOU', ux, uy + 16);
    }

    // 4. Discovered Peer Markers
    const angleStep = (2 * Math.PI) / Math.max(1, peers.length);
    peers.forEach((peer, i) => {
      const hash = peer.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const lat = ((hash % 50) / 100.0) - 0.2;
      const lon = i * angleStep + 0.6;

      const peerVec = latLonToVec3(lat, lon);
      const peerRot = rotateX(rotateY(peerVec, yaw), pitch);

      if (peerRot.z > -0.15) {
        const px = center.x + peerRot.x * radius;
        const py = center.y + peerRot.y * radius;
        const isSelected = selectedPeerId === peer.id;

        visiblePeerPositionsRef.current.set(peer.id, { x: px, y: py, peer });

        // Orbital selection ring
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(px, py, 11, 0, Math.PI * 2);
          ctx.strokeStyle = '#0A84FF';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Outer pulsing ring if transferring
          if (isTransferring) {
            ctx.beginPath();
            ctx.arc(px, py, 17, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(10, 132, 255, 0.4)';
            ctx.lineWidth = 1.0;
            ctx.stroke();
          }
        }

        // Peer Dot
        ctx.beginPath();
        ctx.arc(px, py, isSelected ? 5.0 : 3.8, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? '#FFFFFF' : '#8E8E93';
        ctx.fill();

        // Peer name tag
        ctx.font = isSelected ? '700 11px -apple-system, sans-serif' : '600 10px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = isSelected ? '#FFFFFF' : 'rgba(200, 200, 200, 0.8)';
        ctx.fillText(peer.name, px, py + 18);
      }
    });
  }, [yaw, pitch, peers, selectedPeerId, isTransferring, size]);

  // Mouse & Touch interactions
  const handlePointerDown = (e: React.PointerEvent) => {
    isInteractingRef.current = true;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isInteractingRef.current) return;
    const dx = e.clientX - lastMousePosRef.current.x;
    const dy = e.clientY - lastMousePosRef.current.y;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };

    setYaw((prev) => prev + dx * 0.008);
    setPitch((prev) => Math.max(-0.8, Math.min(0.8, prev + dy * 0.008)));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isInteractingRef.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}

    // Tap hit-testing
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    let closestPeer: PeerDevice | null = null;
    let closestDist = 26;

    visiblePeerPositionsRef.current.forEach((pos) => {
      const dist = Math.hypot(pos.x - clickX, pos.y - clickY);
      if (dist < closestDist) {
        closestDist = dist;
        closestPeer = pos.peer;
      }
    });

    if (closestPeer && onSelectPeer) {
      onSelectPeer(closestPeer);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: size,
          height: size,
          cursor: 'grab',
          touchAction: 'none',
          userSelect: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      <div
        style={{
          fontSize: '11px',
          color: 'rgba(255, 255, 255, 0.45)',
          marginTop: '6px',
          letterSpacing: '0.2px',
          fontWeight: 500,
        }}
      >
        Drag globe to rotate • Tap device node to select
      </div>
    </div>
  );
};
