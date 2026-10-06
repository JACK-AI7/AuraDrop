import {
  TransferState,
  DeviceInfo,
  FileMetadata,
  TransferSession,
  VisibilityMode,
  HistoryItem,
} from '@auradrop/types';

export interface MobileAppState {
  localDevice: {
    id: string;
    name: string;
    platform: 'android' | 'ios';
    publicKey: string;
    visibilityMode: VisibilityMode;
    temporaryVisibilityExpiresAt?: number;
  };
  appState: TransferState;
  nearbyDevices: DeviceInfo[];
  selectedFiles: FileMetadata[];
  selectedRecipients: DeviceInfo[];
  currentTransfer?: TransferSession;
  incomingRequest?: TransferSession;
  history: HistoryItem[];
  networkNotice?: {
    type: 'DIRECT_WIFI_P2P' | 'LOCAL_NETWORK' | 'RELAY_FALLBACK';
    label: string;
    color: string;
  };
}

type Listener = (state: MobileAppState) => void;

class TransferStore {
  private state: MobileAppState = {
    localDevice: {
      id: `m_${Math.random().toString(36).substring(2, 8)}`,
      name: 'Pixel Fold (My Device)',
      platform: 'android',
      publicKey: '04a1b2c3d4e5f6',
      visibilityMode: 'everyone',
    },
    appState: 'IDLE',
    nearbyDevices: [],
    selectedFiles: [],
    selectedRecipients: [],
    history: [],
    networkNotice: {
      type: 'LOCAL_NETWORK',
      label: 'Using local network',
      color: '#00F2FE',
    },
  };

  private listeners = new Set<Listener>();

  getState(): MobileAppState {
    return this.state;
  }

  setState(partial: Partial<MobileAppState>): void {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  setTransferState(appState: TransferState): void {
    this.state.appState = appState;
    if (this.state.currentTransfer) {
      this.state.currentTransfer.status = appState;
    }
    this.notify();
  }

  setNearbyDevices(devices: DeviceInfo[]): void {
    this.state.nearbyDevices = devices;
    if (devices.length > 0 && this.state.appState === 'DISCOVERING') {
      this.state.appState = 'DEVICE_FOUND';
    }
    this.notify();
  }

  setSelectedFiles(files: FileMetadata[]): void {
    this.state.selectedFiles = files;
    this.notify();
  }

  selectRecipient(device: DeviceInfo): void {
    const exists = this.state.selectedRecipients.some((d) => d.id === device.id);
    if (!exists) {
      this.state.selectedRecipients = [...this.state.selectedRecipients, device];
    } else {
      this.state.selectedRecipients = this.state.selectedRecipients.filter((d) => d.id !== device.id);
    }
    this.notify();
  }

  clearSelectedRecipients(): void {
    this.state.selectedRecipients = [];
    this.notify();
  }

  setVisibility(mode: VisibilityMode, temporaryMs?: number): void {
    this.state.localDevice.visibilityMode = mode;
    this.state.localDevice.temporaryVisibilityExpiresAt = temporaryMs ? Date.now() + temporaryMs : undefined;
    this.notify();
  }

  setIncomingRequest(req?: TransferSession): void {
    this.state.incomingRequest = req;
    if (req) {
      this.state.appState = 'WAITING_FOR_APPROVAL';
    }
    this.notify();
  }

  updateTransferProgress(transferredBytes: number, speedBytesPerSec: number, etaSeconds: number): void {
    if (this.state.currentTransfer) {
      this.state.currentTransfer.transferredBytes = transferredBytes;
      this.state.currentTransfer.speedBytesPerSec = speedBytesPerSec;
      this.state.currentTransfer.etaSeconds = etaSeconds;
      this.notify();
    }
  }

  completeTransfer(): void {
    if (this.state.currentTransfer) {
      this.state.appState = 'COMPLETED';
      this.state.currentTransfer.status = 'COMPLETED';
      this.state.currentTransfer.completedAt = Date.now();

      // Add to history
      const historyEntry: HistoryItem = {
        id: this.state.currentTransfer.transferId,
        direction: this.state.currentTransfer.direction === 'send' ? 'sent' : 'received',
        counterpartName: this.state.currentTransfer.receiverName,
        counterpartDevice: this.state.currentTransfer.receiverDeviceId,
        counterpartPlatform: 'windows',
        totalFiles: this.state.currentTransfer.totalFiles,
        totalBytes: this.state.currentTransfer.totalBytes,
        status: 'COMPLETED',
        timestamp: Date.now(),
        files: this.state.currentTransfer.files.map((f: any) => ({
          name: f.name,
          size: f.size,
          mimeType: f.mimeType,
        })),
        transport: this.state.currentTransfer.transport,
      };
      this.state.history = [historyEntry, ...this.state.history];
    }
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

export const store = new TransferStore();
