/**
 * Section 35: Reusable Motion System Primitives & Spring Physics
 */

export const springConfig = {
  // Snappy responsive touches
  snappy: {
    stiffness: 400,
    damping: 28,
    mass: 0.8,
  },
  // Smooth natural device appearances
  natural: {
    stiffness: 260,
    damping: 22,
    mass: 1.0,
  },
  // Gentle floating aura rings
  gentle: {
    stiffness: 120,
    damping: 18,
    mass: 1.2,
  },
  // Bouncy completion celebration
  bouncy: {
    stiffness: 320,
    damping: 14,
    mass: 0.9,
  },
};

export const timing = {
  instant: 100,
  quick: 200,
  normal: 350,
  slow: 600,
  pulseCycle: 2400,
};

export interface MotionPresets {
  fadeIn: { opacityFrom: number; opacityTo: number; duration: number };
  scaleIn: { scaleFrom: number; scaleTo: number; duration: number };
  springPress: { scaleDown: number; spring: typeof springConfig.snappy };
  deviceAppear: { scaleFrom: number; opacityFrom: number; spring: typeof springConfig.natural };
  connectionPulse: { scaleTo: number; opacityTo: number; cycleDuration: number };
  progressMorph: { duration: number };
  successReveal: { scaleFrom: number; spring: typeof springConfig.bouncy };
}

export const motionPresets: MotionPresets = {
  fadeIn: {
    opacityFrom: 0,
    opacityTo: 1,
    duration: timing.normal,
  },
  scaleIn: {
    scaleFrom: 0.85,
    scaleTo: 1,
    duration: timing.normal,
  },
  springPress: {
    scaleDown: 0.94,
    spring: springConfig.snappy,
  },
  deviceAppear: {
    scaleFrom: 0.7,
    opacityFrom: 0,
    spring: springConfig.natural,
  },
  connectionPulse: {
    scaleTo: 1.6,
    opacityTo: 0,
    cycleDuration: timing.pulseCycle,
  },
  progressMorph: {
    duration: timing.quick,
  },
  successReveal: {
    scaleFrom: 0.5,
    spring: springConfig.bouncy,
  },
};

/**
 * Reduce Motion Adapter: replaces complex physics with accessible fades
 */
export function getMotionConfig(prefersReducedMotion: boolean) {
  if (prefersReducedMotion) {
    return {
      durationMultiplier: 0.5,
      spring: { stiffness: 9999, damping: 9999, mass: 1 }, // instantaneous
      enableParticles: false,
      enableAuraPulses: false,
    };
  }
  return {
    durationMultiplier: 1.0,
    spring: springConfig.natural,
    enableParticles: true,
    enableAuraPulses: true,
  };
}
