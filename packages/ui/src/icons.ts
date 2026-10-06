/**
 * Original AuraDrop Vector Icon Path Definitions
 * 100% Bespoke Geometric Iconography (Clean, modern 24x24 viewBox)
 */

export interface IconDefinition {
  name: string;
  viewBox: string;
  paths: Array<{
    d: string;
    stroke?: string;
    strokeWidth?: number;
    fill?: string;
    strokeLinecap?: 'round' | 'square' | 'butt';
    strokeLinejoin?: 'round' | 'bevel' | 'miter';
  }>;
}

export const icons = {
  radar: {
    name: 'radar',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 2A10 10 0 0 0 2 12a10 10 0 0 0 10 10 10 10 0 0 0 10-10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z', fill: 'currentColor' },
      { d: 'M12 7a5 5 0 1 0 5 5 5 5 0 0 0-5-5zm0 8a3 3 0 1 1 3-3 3 3 0 0 1-3 3z', fill: 'currentColor' },
      { d: 'M12 11a1 1 0 1 0 1 1 1 1 0 0 0-1-1z', fill: 'currentColor' },
    ],
  },
  sendBurst: {
    name: 'send-burst',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M22 2L11 13', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
      { d: 'M22 2L15 22L11 13L2 9L22 2Z', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
    ],
  },
  phone: {
    name: 'phone',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M17 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
      { d: 'M12 18h.01', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
    ],
  },
  laptop: {
    name: 'laptop',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M20 16V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11m16 0H4m16 0a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-1a2 2 0 0 1 2-2m16 0', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
    ],
  },
  tablet: {
    name: 'tablet',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
      { d: 'M12 18h.01', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', fill: 'none' },
    ],
  },
  shieldSecure: {
    name: 'shield-secure',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
      { d: 'M9 12l2 2 4-4', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
    ],
  },
  qrCode: {
    name: 'qr-code',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M3 3h6v6H3V3zm12 0h6v6h-6V3zm0 12h6v6h-6v-6zM3 15h6v6H3v-6zm2-10v2h2V5H5zm12 0v2h2V5h-2zm-12 12v2h2v-2H5zm14 2h-2v2h2v-2zm-4-4h2v2h-2v-2zm2 2h2v2h-2v-2z', fill: 'currentColor' },
    ],
  },
  checkCircle: {
    name: 'check-circle',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M22 11.08V12a10 10 0 1 1-5.93-9.14', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
      { d: 'M22 4L12 14.01l-3-3', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
    ],
  },
  xCircle: {
    name: 'x-circle',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
      { d: 'M15 9l-6 6m0-6l6 6', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
    ],
  },
  fileImage: {
    name: 'file-image',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
      { d: 'M14 2v6h6', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
      { d: 'M8.5 13a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', fill: 'currentColor' },
      { d: 'M6 19l4-4 3 3 3-3 2 2', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
    ],
  },
  fileDocument: {
    name: 'file-document',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
      { d: 'M14 2v6h6', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
      { d: 'M16 13H8m8 4H8m2-8H8', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
    ],
  },
  wifiDirect: {
    name: 'wifi-direct',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
    ],
  },
  pause: {
    name: 'pause',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M6 4h4v16H6V4zm8 0h4v16h-4V4z', fill: 'currentColor' },
    ],
  },
  play: {
    name: 'play',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M5 3l14 9-14 9V3z', fill: 'currentColor' },
    ],
  },
  settings: {
    name: 'settings',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', fill: 'currentColor' },
      { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
    ],
  },
  history: {
    name: 'history',
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 8v4l3 3m6-3a9 9 0 1 1-2.63-6.36L21 6m0 0v-5m0 5h-5', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
    ],
  },
};
