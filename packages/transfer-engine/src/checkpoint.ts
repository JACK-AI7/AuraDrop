import * as fs from 'node:fs';
import * as path from 'node:path';

export interface FileCheckpoint {
  transferId: string;
  fileId: string;
  filename: string;
  totalSize: number;
  verifiedBytes: number;
  lastChunkIndex: number;
  checksum: string;
  updatedAt: number;
}

export class CheckpointManager {
  private checkpointDir: string;

  constructor(baseStorageDir: string) {
    this.checkpointDir = path.join(baseStorageDir, '.auradrop_checkpoints');
    try {
      if (!fs.existsSync(this.checkpointDir)) {
        fs.mkdirSync(this.checkpointDir, { recursive: true });
      }
    } catch {
      // Best effort
    }
  }

  saveCheckpoint(checkpoint: FileCheckpoint): void {
    try {
      const filePath = path.join(this.checkpointDir, `${checkpoint.transferId}_${checkpoint.fileId}.json`);
      fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), 'utf8');
    } catch {
      // Ignored
    }
  }

  getCheckpoint(transferId: string, fileId: string): FileCheckpoint | null {
    try {
      const filePath = path.join(this.checkpointDir, `${transferId}_${fileId}.json`);
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
      }
    } catch {
      // Ignored
    }
    return null;
  }

  clearCheckpoint(transferId: string, fileId: string): void {
    try {
      const filePath = path.join(this.checkpointDir, `${transferId}_${fileId}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignored
    }
  }

  clearTransferCheckpoints(transferId: string): void {
    try {
      const files = fs.readdirSync(this.checkpointDir);
      for (const file of files) {
        if (file.startsWith(`${transferId}_`)) {
          fs.unlinkSync(path.join(this.checkpointDir, file));
        }
      }
    } catch {
      // Ignored
    }
  }
}
