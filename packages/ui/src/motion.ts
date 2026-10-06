/**
 * Section 4: Centralized Premium Motion System Primitives & Spring Physics
 * Target 60 FPS / 120 FPS performance with Reduced Motion accessibility respect.
 */

export const springConfig = {
  // Snappy responsive touches (buttons, card taps)
  snappy: {
    stiffness: 400,
    damping: 28,
    mass: 0.8,
  },
  // Smooth natural device appearances & radar pop-ins
  natural: {
    stiffness: 260,
    damping: 22,
    mass: 1.0,
  },
  // Gentle floating aura rings & ambient radar sweeps
  gentle: {
    stiffness: 120,
    damping: 18,
    mass: 1.2,
  },
  // Bouncy celebration & completion reveal
  bouncy: {
    stiffness: 320,
    damping: 14,
    mass: 0.9,
  },
  // Sheet presentation and dismissal transitions
  sheet: {
    stiffness: 340,
    damping: 30,
    mass: 1.0,
  },
};

export const timing = {
  instant: 80,
  quick: 180,
  normal: 320,
  slow: 550,
  pulseCycle: 2200,
  streamFlowCycle: 800,
};

export interface AnimationSpec {
  name: string;
  durationMs: number;
  spring?: typeof springConfig.natural;
  easing?: string;
  cssKeyframes?: string;
}

export const motionSystem = {
  // 1. Device Appear
  deviceAppear: {
    name: 'DeviceAppear',
    durationMs: timing.normal,
    spring: springConfig.natural,
    scaleFrom: 0.65,
    scaleTo: 1.0,
    opacityFrom: 0,
    opacityTo: 1,
    cssKeyframes: `
      @keyframes deviceAppear {
        0% { transform: scale(0.65); opacity: 0; }
        70% { transform: scale(1.05); opacity: 0.9; }
        100% { transform: scale(1.0); opacity: 1; }
      }
    `,
  },

  // 2. Device Disappear
  deviceDisappear: {
    name: 'DeviceDisappear',
    durationMs: timing.quick,
    scaleFrom: 1.0,
    scaleTo: 0.75,
    opacityFrom: 1,
    opacityTo: 0,
    cssKeyframes: `
      @keyframes deviceDisappear {
        0% { transform: scale(1.0); opacity: 1; }
        100% { transform: scale(0.75); opacity: 0; }
      }
    `,
  },

  // 3. Device Select
  deviceSelect: {
    name: 'DeviceSelect',
    durationMs: timing.quick,
    spring: springConfig.snappy,
    scaleDown: 0.95,
    glowColor: '#00F2FE',
  },

  // 4. Connection Start
  connectionStart: {
    name: 'ConnectionStart',
    durationMs: timing.normal,
    strokeDashoffset: [100, 0],
    pulseSpeed: 1200,
  },

  // 5. Connection Established (Secure Handshake)
  connectionEstablished: {
    name: 'ConnectionEstablished',
    durationMs: timing.normal,
    spring: springConfig.bouncy,
    shieldScale: [0.8, 1.1, 1.0],
  },

  // 6. Transfer Start
  transferStart: {
    name: 'TransferStart',
    durationMs: timing.quick,
    streamOpacity: [0, 1],
  },

  // 7. Transfer Progress
  transferProgress: {
    name: 'TransferProgress',
    lerpFactor: 0.15, // Smooth percentage interpolation
  },

  // 8. Transfer Pause
  transferPause: {
    name: 'TransferPause',
    durationMs: timing.quick,
    streamOpacity: 0.35,
    grayscale: true,
  },

  // 9. Transfer Resume
  transferResume: {
    name: 'TransferResume',
    durationMs: timing.quick,
    streamOpacity: 1.0,
    grayscale: false,
  },

  // 10. Transfer Complete
  transferComplete: {
    name: 'TransferComplete',
    durationMs: timing.slow,
    spring: springConfig.bouncy,
    particleCollapse: true,
  },

  // 11. Transfer Failed
  transferFailed: {
    name: 'TransferFailed',
    durationMs: timing.quick,
    shake: true,
    cssKeyframes: `
      @keyframes transferShake {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-8px); }
        40%, 80% { transform: translateX(8px); }
      }
    `,
  },

  // 12. Sheet Present
  sheetPresent: {
    name: 'SheetPresent',
    durationMs: timing.normal,
    spring: springConfig.sheet,
    translateYFrom: '100%',
    translateYTo: '0%',
  },

  // 13. Sheet Dismiss
  sheetDismiss: {
    name: 'SheetDismiss',
    durationMs: timing.quick,
    translateYFrom: '0%',
    translateYTo: '100%',
  },

  // 14. Success Reveal
  successReveal: {
    name: 'SuccessReveal',
    durationMs: timing.slow,
    spring: springConfig.bouncy,
    scaleFrom: 0.4,
    scaleTo: 1.0,
  },
};

/**
 * Haptic feedback trigger simulation & device native call abstraction
 */
export type HapticType = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

export function triggerHaptic(type: HapticType): void {
  if (typeof window !== 'undefined' && 'navigator' in window && 'vibrate' in navigator) {
    try {
      switch (type) {
        case 'light':
          navigator.vibrate(10);
          break;
        case 'medium':
          navigator.vibrate(25);
          break;
        case 'heavy':
          navigator.vibrate(45);
          break;
        case 'success':
          navigator.vibrate([15, 60, 25]);
          break;
        case 'warning':
          navigator.vibrate([25, 40, 25]);
          break;
        case 'error':
          navigator.vibrate([40, 60, 40, 60, 40]);
          break;
      }
    } catch {
      // Ignored if permissions restrict
    }
  }
}

/**
 * Smooth linear interpolation helper for percentage and speed
 */
export function lerp(start: number, end: number, factor: number): number {
  return start + (end - start) * factor;
}

/**
 * Reduce Motion Adapter: replaces complex physics with accessible fades
 */
export function getMotionConfig(prefersReducedMotion: boolean) {
  if (prefersReducedMotion) {
    return {
      durationMultiplier: 0.4,
      spring: { stiffness: 9999, damping: 9999, mass: 1 },
      enableParticles: false,
      enableAuraPulses: false,
      enableShake: false,
      transitionType: 'fade',
    };
  }
  return {
    durationMultiplier: 1.0,
    spring: springConfig.natural,
    enableParticles: true,
    enableAuraPulses: true,
    enableShake: true,
    transitionType: 'spring',
  };
}
