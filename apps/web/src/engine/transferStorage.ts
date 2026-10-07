// AuraDrop Persistent Transfer Database & Resume Storage
import { TransferRecord } from '../types';

export interface CheckpointRecord {
  transferId: string;
  fileId: string;
  fileName: string;
  fileSize: number;
  expectedSha256: string;
  verifiedOffset: number;
  updatedAt: string;
}

const STORAGE_KEY_HISTORY = 'auradrop_transfer_history_v1';
const STORAGE_KEY_CHECKPOINTS = 'auradrop_transfer_checkpoints_v1';

export class TransferStorage {
  private static instance: TransferStorage;

  private constructor() {}

  public static getInstance(): TransferStorage {
    if (!TransferStorage.instance) {
      TransferStorage.instance = new TransferStorage();
    }
    return TransferStorage.instance;
  }

  // ---------------------------------------------------------------------------
  // TRANSFER HISTORY
  // ---------------------------------------------------------------------------
  public getHistory(): TransferRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  public saveRecord(record: TransferRecord): void {
    try {
      const list = this.getHistory();
      // Prepend record
      const updated = [record, ...list.filter((r) => r.id !== record.id)].slice(0, 50);
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(updated));
    } catch (e) {
      console.warn('Failed to save transfer record', e);
    }
  }

  public clearHistory(): void {
    localStorage.removeItem(STORAGE_KEY_HISTORY);
  }

  // ---------------------------------------------------------------------------
  // CHECKPOINTS FOR RESUMABLE TRANSFERS (Section 19 & 22)
  // ---------------------------------------------------------------------------
  public getCheckpoint(transferId: string): CheckpointRecord | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_CHECKPOINTS);
      if (!raw) return null;
      const map: Record<string, CheckpointRecord> = JSON.parse(raw);
      return map[transferId] || null;
    } catch {
      return null;
    }
  }

  public saveCheckpoint(checkpoint: CheckpointRecord): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_CHECKPOINTS);
      const map: Record<string, CheckpointRecord> = raw ? JSON.parse(raw) : {};
      map[checkpoint.transferId] = checkpoint;
      localStorage.setItem(STORAGE_KEY_CHECKPOINTS, JSON.stringify(map));
    } catch (e) {
      console.warn('Failed to save checkpoint', e);
    }
  }

  public removeCheckpoint(transferId: string): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_CHECKPOINTS);
      if (!raw) return;
      const map: Record<string, CheckpointRecord> = JSON.parse(raw);
      delete map[transferId];
      localStorage.setItem(STORAGE_KEY_CHECKPOINTS, JSON.stringify(map));
    } catch (e) {
      console.warn('Failed to remove checkpoint', e);
    }
  }

  // ---------------------------------------------------------------------------
  // FILENAME SANITIZATION (Section 37: File Safety)
  // ---------------------------------------------------------------------------
  public sanitizeFilename(input: string): string {
    // 1. Strip path traversal (../, ..\, etc.)
    let safe = input.replace(/^.*[\\/]/, '');
    // 2. Remove null bytes and control chars
    safe = safe.replace(/[\x00-\x1f\x80-\x9f]/g, '');
    // 3. Remove illegal characters for Windows/Unix
    safe = safe.replace(/[<>:"/\\|?*]/g, '_');
    // 4. Neutralize Windows reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
    const base = safe.split('.')[0].toUpperCase();
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(base)) {
      safe = `file_${safe}`;
    }
    // 5. Fallback if empty
    return safe.trim() || 'auradrop_file';
  }
}
