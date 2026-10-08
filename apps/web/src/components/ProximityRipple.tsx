import React, { useEffect, useState } from 'react';

interface Ripple {
  id: number;
  size: number;
  opacity: number;
  color: string;
}

interface ProximityRippleProps {
  triggerKey: number;
  color?: string;
}

export const ProximityRipple: React.FC<ProximityRippleProps> = ({
  triggerKey,
  color = 'rgba(255, 255, 255, 0.45)',
}) => {
  const [ripples, setRipples] = useState<Ripple[]>([]);

  useEffect(() => {
    if (triggerKey === 0) return;
    const newId = Date.now();
    setRipples((prev) => [...prev, { id: newId, size: 40, opacity: 0.85, color }]);

    const timer = setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== newId));
    }, 1400);

    return () => clearTimeout(timer);
  }, [triggerKey, color]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        zIndex: 0,
      }}
    >
      {ripples.map((r) => (
        <div
          key={r.id}
          style={{
            position: 'absolute',
            width: '100px',
            height: '100px',
            borderRadius: '50%',
            border: `1.5px solid ${r.color}`,
            animation: 'proximityWave 1.4s cubic-bezier(0.15, 0.85, 0.35, 1) forwards',
          }}
        />
      ))}
      <style>{`
        @keyframes proximityWave {
          0% {
            transform: scale(0.6);
            opacity: 0.8;
          }
          100% {
            transform: scale(5.5);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
};
