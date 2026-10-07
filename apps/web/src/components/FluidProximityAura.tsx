import React, { useEffect, useRef } from 'react';

interface FluidProximityAuraProps {
  isActive: boolean;
  onAnimationComplete?: () => void;
}

/**
 * FluidProximityAura
 * Recreates the Apple NameDrop & iOS 17 AirDrop proximity fluid light-ripple effect
 * (as shown in user-uploaded media_1791389705065.png and media_1791389716524.png):
 * - Shimmering, fluid, liquid-light plasma tentacles bursting from top of screen
 * - Iridescent prismatic chromatic aberration (cyan, violet, gold, radiant white)
 * - Dynamic sparkling light glints
 */
export const FluidProximityAura: React.FC<FluidProximityAuraProps> = ({
  isActive,
  onAnimationComplete,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!isActive) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let startTime = performance.now();
    const duration = 2400; // 2.4s organic burst

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    // Particle glints
    const glints: Array<{
      x: number;
      y: number;
      size: number;
      speed: number;
      alpha: number;
      angle: number;
    }> = [];
    for (let i = 0; i < 45; i++) {
      glints.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 200,
        y: (Math.random() - 0.5) * 50,
        size: 1 + Math.random() * 2.5,
        speed: 1.5 + Math.random() * 3,
        alpha: Math.random(),
        angle: Math.PI / 2 + (Math.random() - 0.5) * 1.2,
      });
    }

    const render = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (progress >= 1) {
        onAnimationComplete?.();
        return;
      }

      // Easing curve: swift expansive surge, then slow shimmering dissolve
      const expand = Math.sin(progress * Math.PI * 0.7);
      const fade = progress < 0.6 ? 1 : 1 - (progress - 0.6) / 0.4;

      const centerX = canvas.width / 2;
      const originY = 0; // burst starts from the top notch/bezel

      // Layer 1: Prismatic Iridescent Glow along top edge
      const rimGrad = ctx.createRadialGradient(
        centerX,
        originY,
        10,
        centerX,
        originY,
        320 * expand
      );
      rimGrad.addColorStop(0, `rgba(255, 255, 255, ${0.95 * fade})`);
      rimGrad.addColorStop(0.2, `rgba(160, 220, 255, ${0.85 * fade})`);
      rimGrad.addColorStop(0.45, `rgba(255, 130, 210, ${0.65 * fade})`);
      rimGrad.addColorStop(0.7, `rgba(100, 240, 255, ${0.4 * fade})`);
      rimGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = rimGrad;
      ctx.fillRect(0, 0, canvas.width, 420 * expand);

      // Layer 2: Organic Fluid Liquid Tentacles / Wave Ribbons (media_1791389705065.png)
      const numWaves = 7;
      for (let w = 0; w < numWaves; w++) {
        const waveProgress = Math.max(0, progress - w * 0.04);
        const waveRadius = 60 + waveProgress * 380 + w * 28;
        const waveAlpha = fade * (0.85 - w * 0.1);

        ctx.beginPath();
        const points = 72;
        for (let i = 0; i <= points; i++) {
          const angle = (i / points) * Math.PI; // semi-circle downward
          // Multi-frequency harmonic perturbation for liquid fluid texture
          const harmonic1 = Math.sin(angle * 6 + elapsed * 0.008 + w) * 24;
          const harmonic2 = Math.cos(angle * 12 - elapsed * 0.006) * 14;
          const harmonic3 = Math.sin(angle * 20 + elapsed * 0.012) * 8;
          const r = waveRadius + (harmonic1 + harmonic2 + harmonic3) * expand;

          const px = centerX + Math.cos(angle) * r * 1.35;
          const py = originY + Math.sin(angle) * r * 1.1;

          if (i === 0) {
            ctx.moveTo(px, py);
          } else {
            ctx.lineTo(px, py);
          }
        }

        ctx.lineWidth = 3.5 - w * 0.35;
        // Iridescent chromatic shift per wave
        const colors = [
          `rgba(255, 255, 255, ${waveAlpha})`,
          `rgba(180, 235, 255, ${waveAlpha * 0.9})`,
          `rgba(255, 170, 230, ${waveAlpha * 0.85})`,
          `rgba(220, 245, 255, ${waveAlpha * 0.8})`,
          `rgba(130, 210, 255, ${waveAlpha * 0.7})`,
          `rgba(255, 140, 190, ${waveAlpha * 0.6})`,
          `rgba(160, 255, 240, ${waveAlpha * 0.5})`,
        ];
        ctx.strokeStyle = colors[w % colors.length];
        ctx.shadowColor = '#FFFFFF';
        ctx.shadowBlur = 18;
        ctx.stroke();
      }

      // Layer 3: Sparkling Prismatic Glints & Star Flashes
      for (const g of glints) {
        g.x += Math.cos(g.angle) * g.speed * (1 + expand * 2);
        g.y += Math.sin(g.angle) * g.speed * (1 + expand * 2);
        const glintAlpha = fade * Math.sin((elapsed * 0.01 + g.alpha) * Math.PI);

        if (glintAlpha > 0) {
          ctx.beginPath();
          ctx.arc(g.x, g.y, g.size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${glintAlpha})`;
          ctx.shadowColor = '#80D0FF';
          ctx.shadowBlur = 10;
          ctx.fill();

          // 4-point star flash on larger glints
          if (g.size > 2) {
            ctx.strokeStyle = `rgba(255, 255, 255, ${glintAlpha * 0.8})`;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(g.x - 6, g.y);
            ctx.lineTo(g.x + 6, g.y);
            ctx.moveTo(g.x, g.y - 6);
            ctx.lineTo(g.x, g.y + 6);
            ctx.stroke();
          }
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
    };
  }, [isActive, onAnimationComplete]);

  if (!isActive) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9998,
      }}
    />
  );
};
