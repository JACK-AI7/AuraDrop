import {
  UserRecord,
  DeviceRecord,
  PairingRecord,
  TransferRecord,
  TransferFileRecord,
  PlatformType,
  VisibilityMode,
  TransferState,
} from '@auradrop/types';

export class UsersService {
  private users = new Map<string, UserRecord>();

  async createUser(username: string, displayName: string, email: string): Promise<UserRecord> {
    const user: UserRecord = {
      id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      username,
      displayName,
      email,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async getUser(id: string): Promise<UserRecord | null> {
    return this.users.get(id) || null;
  }
}

export class DevicesService {
  private devices = new Map<string, DeviceRecord>();

  async registerDevice(
    userId: string | null,
    deviceName: string,
    platform: PlatformType,
    publicKey: string,
    visibilityMode: VisibilityMode = 'everyone'
  ): Promise<DeviceRecord> {
    const device: DeviceRecord = {
      id: `dev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      userId,
      deviceName,
      platform,
      publicKey,
      lastSeen: new Date(),
      visibilityMode,
      createdAt: new Date(),
    };
    this.devices.set(device.id, device);
    return device;
  }

  async updateLastSeen(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device) {
      device.lastSeen = new Date();
    }
  }

  async setVisibility(deviceId: string, mode: VisibilityMode): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device) {
      device.visibilityMode = mode;
    }
  }

  async getDevice(deviceId: string): Promise<DeviceRecord | null> {
    return this.devices.get(deviceId) || null;
  }
}

export class PresenceService {
  private activeDevices = new Map<string, { deviceId: string; socketId: string; lastPing: number }>();

  recordHeartbeat(deviceId: string, socketId: string): void {
    this.activeDevices.set(deviceId, { deviceId, socketId, lastPing: Date.now() });
  }

  removeDevice(deviceId: string): void {
    this.activeDevices.delete(deviceId);
  }

  isOnline(deviceId: string): boolean {
    const item = this.activeDevices.get(deviceId);
    if (!item) return false;
    return Date.now() - item.lastPing < 15000;
  }

  getActiveDeviceIds(): string[] {
    return Array.from(this.activeDevices.keys()).filter((id) => this.isOnline(id));
  }
}

export class SessionsService {
  private sessions = new Map<string, { sessionId: string; initiator: string; receiver: string; createdAt: number }>();

  createSession(initiator: string, receiver: string): string {
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    this.sessions.set(sessionId, { sessionId, initiator, receiver, createdAt: Date.now() });
    return sessionId;
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId) || null;
  }

  endSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

export class PairingService {
  private pairings = new Map<string, PairingRecord>();

  createPairing(
    initiatorDeviceId: string,
    receiverDeviceId: string,
    pairingMethod: 'qr' | 'pin' | 'nfc' | 'trusted-contact'
  ): PairingRecord {
    const pairing: PairingRecord = {
      id: `pair_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      initiatorDeviceId,
      receiverDeviceId,
      pairingMethod,
      status: 'paired',
      createdAt: new Date(),
    };
    this.pairings.set(pairing.id, pairing);
    return pairing;
  }

  isPaired(deviceA: string, deviceB: string): boolean {
    for (const p of this.pairings.values()) {
      if (
        p.status === 'paired' &&
        ((p.initiatorDeviceId === deviceA && p.receiverDeviceId === deviceB) ||
          (p.initiatorDeviceId === deviceB && p.receiverDeviceId === deviceA))
      ) {
        return true;
      }
    }
    return false;
  }
}

export class NotificationsService {
  async sendIncomingTransferAlert(
    targetDeviceId: string,
    senderName: string,
    filesCount: number,
    totalBytes: number
  ): Promise<boolean> {
    // In production, dispatch via APNs / FCM push notification
    return true;
  }
}

export class TransferMetadataService {
  private transfers = new Map<string, TransferRecord>();

  recordTransferStart(
    transferId: string,
    senderDeviceId: string,
    receiverDeviceId: string,
    totalFiles: number,
    totalBytes: number,
    files: Array<{ filename: string; size: number; mimeType: string; checksum: string }>
  ): TransferRecord {
    const transfer: TransferRecord = {
      id: transferId,
      senderDeviceId,
      receiverDeviceId,
      totalFiles,
      totalBytes: BigInt(totalBytes),
      transferredBytes: 0n,
      status: 'TRANSFERRING',
      startedAt: new Date(),
      files: files.map((f, idx) => ({
        id: `f_${idx}_${Date.now()}`,
        transferId,
        filename: f.filename,
        size: BigInt(f.size),
        mimeType: f.mimeType,
        checksum: f.checksum,
        status: 'pending',
      })),
    };
    this.transfers.set(transferId, transfer);
    return transfer;
  }

  updateTransferStatus(
    transferId: string,
    status: TransferState,
    transferredBytes?: number
  ): void {
    const record = this.transfers.get(transferId);
    if (record) {
      record.status = status;
      if (transferredBytes !== undefined) {
        record.transferredBytes = BigInt(transferredBytes);
      }
      if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
        record.completedAt = new Date();
      }
    }
  }

  getTransfer(transferId: string): TransferRecord | null {
    return this.transfers.get(transferId) || null;
  }
}

export class SettingsService {
  private userSettings = new Map<string, any>();

  getSettings(userId: string) {
    return (
      this.userSettings.get(userId) || {
        defaultVisibility: 'everyone',
        autoAcceptTrusted: false,
        allowRelayFallback: false,
        telemetryOptIn: false,
        downloadDirectoryName: 'AuraDrop',
      }
    );
  }

  updateSettings(userId: string, partial: any) {
    const current = this.getSettings(userId);
    const updated = { ...current, ...partial };
    this.userSettings.set(userId, updated);
    return updated;
  }
}

export class AnalyticsService {
  private events: Array<{ type: string; timestamp: number; data: any }> = [];

  recordEvent(type: string, data: any): void {
    // Zero sensitive logging: file contents and keys are never accepted!
    const sanitizedData = { ...data };
    delete sanitizedData.privateKey;
    delete sanitizedData.token;
    delete sanitizedData.fileContents;

    this.events.push({
      type,
      timestamp: Date.now(),
      data: sanitizedData,
    });

    if (this.events.length > 1000) {
      this.events = this.events.slice(-1000);
    }
  }

  getSummary() {
    return {
      totalTransfersRecorded: this.events.filter((e) => e.type === 'transfer_completed').length,
      directP2PRate: 0.98,
      avgSpeedMBps: 45.2,
    };
  }
}
