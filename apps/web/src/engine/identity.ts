// AuraDrop Persistent Device Identity (FIPS / Section 6)
// Provides durable, cross-session identity without random per-tab generation.

export interface DeviceIdentity {
  deviceId: string;
  displayName: string;
  deviceName: string;
  platform: 'android' | 'ios' | 'macos' | 'windows' | 'linux' | 'web';
  visibility: 'everyone' | 'contacts' | 'off';
  createdAt: string;
}

const STORAGE_KEY_IDENTITY = 'auradrop_device_identity_v1';

export class IdentityManager {
  private static instance: IdentityManager;
  private currentIdentity: DeviceIdentity;

  private constructor() {
    this.currentIdentity = this.loadOrGenerateIdentity();
  }

  public static getInstance(): IdentityManager {
    if (!IdentityManager.instance) {
      IdentityManager.instance = new IdentityManager();
    }
    return IdentityManager.instance;
  }

  private loadOrGenerateIdentity(): DeviceIdentity {
    let baseDeviceId = '';
    let storedName = '';

    try {
      const stored = localStorage.getItem(STORAGE_KEY_IDENTITY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.deviceId) {
          baseDeviceId = parsed.deviceId;
          storedName = parsed.displayName || '';
        }
      }
    } catch {
      // Ignore storage errors
    }

    if (!baseDeviceId) {
      const randomHex = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '').substring(0, 10)
        : Math.random().toString(36).substring(2, 12);
      baseDeviceId = `aura_desktop_${randomHex}`;
    }

    const platform = this.detectPlatform();
    const deviceName = storedName || this.detectDeviceModel(platform);
    const deviceId = baseDeviceId;
    const displayName = deviceName;

    const identity: DeviceIdentity = {
      deviceId,
      displayName,
      deviceName,
      platform,
      visibility: 'everyone',
      createdAt: new Date().toISOString(),
    };

    try {
      localStorage.setItem(STORAGE_KEY_IDENTITY, JSON.stringify({ deviceId: baseDeviceId, displayName: deviceName }));
    } catch (e) {
      console.warn('Failed to persist identity to localStorage', e);
    }

    return identity;
  }

  private detectPlatform(): 'android' | 'ios' | 'macos' | 'windows' | 'linux' | 'web' {
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    if (/macintosh|mac os x/i.test(ua)) return 'macos';
    if (/windows/i.test(ua)) return 'windows';
    if (/linux/i.test(ua)) return 'linux';
    return 'web';
  }

  private detectDeviceModel(platform: string): string {
    const ua = navigator.userAgent || '';
    if (platform === 'android') {
      const match = ua.match(/Android[^;]+;\s*([^;)]+)\)/);
      if (match && match[1]) {
        const raw = match[1].trim();
        // Clean up common prefixes like "Build/..." or "Linux; "
        return raw.split(' Build')[0].trim() || 'Android Device';
      }
      return 'Android Device';
    }
    if (platform === 'macos') return 'MacBook';
    if (platform === 'windows') return 'Windows PC';
    if (platform === 'ios') return 'iPhone';
    if (platform === 'linux') return 'Linux Workstation';
    return 'AuraDrop Client';
  }

  public getIdentity(): DeviceIdentity {
    return { ...this.currentIdentity };
  }

  public updateDisplayName(newName: string): void {
    if (!newName.trim()) return;
    this.currentIdentity.displayName = newName.trim();
    this.persist();
  }

  public updateVisibility(visibility: 'everyone' | 'contacts' | 'off'): void {
    this.currentIdentity.visibility = visibility;
    this.persist();
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY_IDENTITY, JSON.stringify(this.currentIdentity));
    } catch (e) {
      console.warn('Failed to persist updated identity', e);
    }
  }
}
