/**
 * AuraDrop Design System: Color Tokens, Elevation, Typography & Glassmorphism
 * Unique Identity: Deep Space Obsidian + Radiant Aura Cyan & Violet Gradients
 */

export const colors = {
  dark: {
    background: '#0B0D13',
    backgroundSecondary: '#131722',
    surface: '#1A1E2E',
    surfaceElevated: '#242B42',
    surfaceGlass: 'rgba(26, 30, 46, 0.72)',
    border: 'rgba(255, 255, 255, 0.08)',
    borderActive: 'rgba(0, 242, 254, 0.4)',

    textPrimary: '#FFFFFF',
    textSecondary: '#94A3B8',
    textMuted: '#64748B',

    // Aura Brand Accents
    primary: '#00F2FE',       // Aura Radiant Cyan
    secondary: '#4FACFE',     // Sky Blue
    accent: '#7928CA',        // Electric Violet
    accentGlow: 'rgba(0, 242, 254, 0.25)',

    // Status Colors
    success: '#10B981',       // Emerald
    successGlow: 'rgba(16, 185, 129, 0.25)',
    warning: '#F59E0B',       // Amber
    warningGlow: 'rgba(245, 158, 11, 0.25)',
    error: '#EF4444',         // Rose Red
    errorGlow: 'rgba(239, 68, 68, 0.25)',
    info: '#3B82F6',
  },
  light: {
    background: '#F8FAFC',
    backgroundSecondary: '#EDF2F7',
    surface: '#FFFFFF',
    surfaceElevated: '#F1F5F9',
    surfaceGlass: 'rgba(255, 255, 255, 0.85)',
    border: 'rgba(0, 0, 0, 0.08)',
    borderActive: 'rgba(0, 168, 204, 0.5)',

    textPrimary: '#0F172A',
    textSecondary: '#475569',
    textMuted: '#94A3B8',

    primary: '#00A8CC',
    secondary: '#2563EB',
    accent: '#6366F1',
    accentGlow: 'rgba(0, 168, 204, 0.2)',

    success: '#059669',
    successGlow: 'rgba(5, 150, 105, 0.2)',
    warning: '#D97706',
    warningGlow: 'rgba(217, 119, 6, 0.2)',
    error: '#DC2626',
    errorGlow: 'rgba(220, 38, 38, 0.2)',
    info: '#2563EB',
  },
};

export const typography = {
  display: {
    fontSize: 32,
    fontWeight: '800' as const,
    lineHeight: 40,
    letterSpacing: -0.5,
  },
  title1: {
    fontSize: 24,
    fontWeight: '700' as const,
    lineHeight: 30,
    letterSpacing: -0.3,
  },
  title2: {
    fontSize: 18,
    fontWeight: '600' as const,
    lineHeight: 24,
  },
  body: {
    fontSize: 15,
    fontWeight: '400' as const,
    lineHeight: 22,
  },
  bodyMedium: {
    fontSize: 15,
    fontWeight: '500' as const,
    lineHeight: 22,
  },
  caption: {
    fontSize: 12,
    fontWeight: '500' as const,
    lineHeight: 16,
  },
  mono: {
    fontFamily: 'Courier New, monospace',
    fontSize: 13,
    fontWeight: '600' as const,
    letterSpacing: 1.2,
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const borderRadius = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  full: 9999,
};

export const shadows = {
  glass: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
  glowPrimary: '0 0 24px rgba(0, 242, 254, 0.35)',
  glowSuccess: '0 0 24px rgba(16, 185, 129, 0.35)',
  card: '0 4px 20px rgba(0, 0, 0, 0.15)',
};
