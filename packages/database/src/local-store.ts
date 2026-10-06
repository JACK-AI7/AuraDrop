import * as fs from 'node:fs';
import * as path from 'node:path';
import { HistoryItem, HistoryFilter, TransferRecord, TransferState } from '@auradrop/types';

/**
 * Section 24 & 26: Offline-First Local Transfer History Store
 * Saves transfer records locally on device so local sharing works seamlessly
 * without requiring any cloud or backend server.
 */
export class LocalTransferHistoryStore {
  private historyFile: string;
  private items: HistoryItem[] = [];

  constructor(storageDir: string) {
    try {
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }
    } catch {
      // Ignored
    }
    this.historyFile = path.join(storageDir, 'transfer_history.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.historyFile)) {
        const raw = fs.readFileSync(this.historyFile, 'utf8');
        this.items = JSON.parse(raw);
      }
    } catch {
      this.items = [];
    }
  }

  private persist(): void {
    try {
      fs.writeFileSync(this.historyFile, JSON.stringify(this.items, null, 2), 'utf8');
    } catch {
      // Ignored
    }
  }

  addRecord(record: HistoryItem): void {
    this.items.unshift(record);
    // Keep last 500 records
    if (this.items.length > 500) {
      this.items = this.items.slice(0, 500);
    }
    this.persist();
  }

  getHistory(filter: HistoryFilter = 'all'): HistoryItem[] {
    switch (filter) {
      case 'sent':
        return this.items.filter((item) => item.direction === 'sent');
      case 'received':
        return this.items.filter((item) => item.direction === 'received');
      case 'failed':
        return this.items.filter((item) => item.status === 'FAILED');
      case 'cancelled':
        return this.items.filter((item) => item.status === 'CANCELLED');
      case 'all':
      default:
        return this.items;
    }
  }

  deleteRecord(id: string): boolean {
    const idx = this.items.findIndex((item) => item.id === id);
    if (idx !== -1) {
      this.items.splice(idx, 1);
      this.persist();
      return true;
    }
    return false;
  }

  clearAll(): void {
    this.items = [];
    this.persist();
  }
}

export * from './local-store';
