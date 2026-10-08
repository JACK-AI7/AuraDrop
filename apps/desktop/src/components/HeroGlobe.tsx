import React, { useEffect, useRef, useState } from 'react';
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
  transferSpeed?: string | null;
  statusBadgeText?: string | null;
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

function slerp(p1: Vec3, p2: Vec3, t: number): Vec3 {
  let dot = p1.x * p2.x + p1.y * p2.y + p1.z * p2.z;
  dot = Math.max(-1.0, Math.min(1.0, dot));
  const theta = Math.acos(dot) * t;
  const relX = p2.x - p1.x * dot;
  const relY = p2.y - p1.y * dot;
  const relZ = p2.z - p1.z * dot;
  const len = Math.hypot(relX, relY, relZ) || 1.0;
  const normRel = { x: relX / len, y: relY / len, z: relZ / len };

  return {
    x: p1.x * Math.cos(theta) + normRel.x * Math.sin(theta),
    y: p1.y * Math.cos(theta) + normRel.y * Math.sin(theta),
    z: p1.z * Math.cos(theta) + normRel.z * Math.sin(theta),
  };
}

const SPHERE_POINTS = generateSpherePoints(380);

export const HeroGlobe: React.FC<HeroGlobeProps> = ({
  peers,
  selectedPeerId,
  onSelectPeer,
  isTransferring = false,
  transferSpeed = null,
  statusBadgeText = null,
  size = 360,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [yaw, setYaw] = useState(0.0);
  const [pitch, setPitch] = useState(-0.25);
  const isInteractingRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const visiblePeerPositionsRef = useRef<Map<string, { x: number; y: number; peer: PeerDevice }>>(new Map());

  const activePeer = peers.find((p) => p.id === selectedPeerId) || peers[0] || null;

  let computedBadge = statusBadgeText;
  let dotColor = '#FFFFFF';
  let isDotPulsing = false;

  if (!computedBadge) {
    if (isTransferring && transferSpeed) {
      computedBadge = `${activePeer ? activePeer.name : 'Device'} — Transferring ${transferSpeed}`;
      dotColor = '#FFFFFF';
      isDotPulsing = true;
    } else if (peers.length > 0 && activePeer) {
      computedBadge = `${activePeer.name} — Direct LAN Active`;
      dotColor = '#FFFFFF';
      isDotPulsing = true;
    } else {
      computedBadge = 'Searching LAN Subnet (UDP + HTTP)...';
      dotColor = '#71717A';
      isDotPulsing = true;
    }
  }

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
    const radius = size * 0.40;

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
        ctx.fillStyle = '#1A1A1E';
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
        const alpha = Math.min(1.0, 0.20 + rot.z * 0.80);
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.fill();
      }
    }

    // 3. User Anchor Marker ("THIS PC")
    const userLat = 0.28;
    const userLon = 0.0;
    const userSpherical = latLonToVec3(userLat, userLon);
    const userRot = rotateX(rotateY(userSpherical, yaw), pitch);

    if (userRot.z > -0.2) {
      const ux = center.x + userRot.x * radius;
      const uy = center.y + userRot.y * radius;

      ctx.beginPath();
      ctx.arc(ux, uy, 7, 0, Math.PI * 2);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(ux, uy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();

      ctx.font = '700 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillText('YOU', ux, uy + 17);
    }

    // 4. Dedicated 3D Connection Beam Pass for Selected Peer
    const angleStep = (2 * Math.PI) / Math.max(1, peers.length);
    const selectedPeer = peers.find((p) => p.id === selectedPeerId);
    if (selectedPeer) {
      const sIdx = peers.indexOf(selectedPeer);
      const sHash = selectedPeer.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const sLat = ((sHash % 50) / 100.0) - 0.2;
      const sLon = sIdx * angleStep + 0.6;
      const sPeerVec = latLonToVec3(sLat, sLon);

      const segments = 40;
      ctx.beginPath();
      let first = true;
      const arcScreenPoints: { x: number; y: number; z: number }[] = [];

      for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        const interp = slerp(userSpherical, sPeerVec, t);
        // Parabolic radial elevation above globe sphere
        const lift = 1.0 + 0.28 * Math.sin(Math.PI * t);
        const lifted: Vec3 = {
          x: interp.x * lift,
          y: interp.y * lift,
          z: interp.z * lift,
        };
        const rot = rotateX(rotateY(lifted, yaw), pitch);
        const sx = center.x + rot.x * radius;
        const sy = center.y + rot.y * radius;
        arcScreenPoints.push({ x: sx, y: sy, z: rot.z });

        if (first) {
          ctx.moveTo(sx, sy);
          first = false;
        } else {
          ctx.lineTo(sx, sy);
        }
      }

      ctx.save();
      ctx.strokeStyle = isTransferring ? '#FFFFFF' : 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = isTransferring ? 2.5 : 1.8;
      ctx.shadowColor = 'rgba(255, 255, 255, 0.7)';
      ctx.shadowBlur = isTransferring ? 12 : 6;
      ctx.stroke();
      ctx.restore();

      // Animated energy particle traversing the arc beam
      if (arcScreenPoints.length > 0) {
        const pulsePeriod = isTransferring ? 750 : 1600;
        const pulseT = ((Date.now() % pulsePeriod) / pulsePeriod);
        const idx = Math.min(
          arcScreenPoints.length - 1,
          Math.floor(pulseT * arcScreenPoints.length)
        );
        const packetPos = arcScreenPoints[idx];

        ctx.save();
        ctx.beginPath();
        ctx.arc(packetPos.x, packetPos.y, isTransferring ? 4.5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = '#FFFFFF';
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.restore();
      }
    }

    // 5. Discovered Peer Markers
    peers.forEach((peer, i) => {
      const hash = peer.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const lat = ((hash % 50) / 100.0) - 0.2;
      const lon = i * angleStep + 0.6;

      const peerVec = latLonToVec3(lat, lon);
      const peerRot = rotateX(rotateY(peerVec, yaw), pitch);
      const isSelected = selectedPeerId === peer.id;

      // Front hemisphere or selected peer (which stays visible with subtle back-fade)
      if (peerRot.z > -0.15 || isSelected) {
        const px = center.x + peerRot.x * radius;
        const py = center.y + peerRot.y * radius;
        const opacity = peerRot.z > -0.15 ? 1.0 : 0.55;

        visiblePeerPositionsRef.current.set(peer.id, { x: px, y: py, peer });

        // Selection ring
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(px, py, 13, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
          ctx.lineWidth = 2.0;
          ctx.stroke();

          if (isTransferring) {
            ctx.beginPath();
            ctx.arc(px, py, 19, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.6})`;
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
        }

        // Peer Dot
        const isAndroid = peer.platform.toLowerCase().includes('android');
        ctx.beginPath();
        ctx.arc(px, py, isSelected ? 5.5 : 4.2, 0, Math.PI * 2);
        ctx.fillStyle = isSelected
          ? `rgba(255, 255, 255, ${opacity})`
          : `rgba(240, 240, 245, ${opacity * 0.9})`;
        ctx.fill();

        // Label
        ctx.font = isSelected ? '700 11px Inter, sans-serif' : '600 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
        const displayLabel = isAndroid ? `📱 ${peer.name}` : peer.name;
        ctx.fillText(displayLabel, px, py + 19);
      }
    });
  }, [yaw, pitch, peers, selectedPeerId, isTransferring, size]);

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

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    let closestPeer: PeerDevice | null = null;
    let closestDist = 30;

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
    <div className="flex flex-col items-center justify-center relative select-none">
      {/* Minimal Black & White Status Badge */}
      <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-neutral-900/95 border border-white/15 backdrop-blur-md shadow-lg shadow-black/80 mb-3 text-xs font-semibold text-white">
        <span
          className="w-2 h-2 rounded-full transition-all duration-300"
          style={{
            backgroundColor: dotColor,
            boxShadow: isDotPulsing ? `0 0 8px ${dotColor}` : 'none',
          }}
        />
        <span>{computedBadge}</span>
      </div>

      <canvas
        ref={canvasRef}
        style={{
          width: size,
          height: size,
          cursor: 'grab',
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />

      <div className="text-[11px] text-neutral-500 mt-1 font-medium tracking-wide">
        Drag globe to rotate • Click device to select
      </div>
    </div>
  );
};
