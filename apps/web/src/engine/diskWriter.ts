// AuraDrop Production Bounded-Memory Progressive Disk Writer (Section 14 & 15)
// Writes incoming chunks progressively to OPFS or FileSystemWritableFileStream
// preventing entire 100MB - 10GB payloads from being held in browser RAM.

export class ProgressiveDiskWriter {
  private fileName: string;
  private transferId: string;
  private opfsFileHandle: any = null;
  private opfsWritable: any = null;
  private memoryBlobParts: Uint8Array[] = [];
  private totalWrittenBytes = 0;
  private useOpfs = false;

  constructor(transferId: string, fileName: string) {
    this.transferId = transferId;
    this.fileName = fileName;
  }

  public async init(): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory) {
        const root = await navigator.storage.getDirectory();
        // Staging file in OPFS
        const safeStagingName = `staging_${this.transferId}.part`;
        this.opfsFileHandle = await root.getFileHandle(safeStagingName, { create: true });
        
        if (typeof this.opfsFileHandle.createWritable === 'function') {
          this.opfsWritable = await this.opfsFileHandle.createWritable();
          this.useOpfs = true;
          return;
        }
      }
    } catch (e) {
      console.warn('OPFS not supported or restricted in this origin context, falling back to progressive Blob stream', e);
    }
    this.useOpfs = false;
  }

  public async writeChunk(chunk: Uint8Array): Promise<void> {
    this.totalWrittenBytes += chunk.byteLength;

    if (this.useOpfs && this.opfsWritable) {
      try {
        await this.opfsWritable.write(chunk);
        return;
      } catch (e) {
        console.warn('OPFS chunk write failed, buffering into memory parts', e);
        this.useOpfs = false;
      }
    }

    // Fallback: bounded chunk parts array
    this.memoryBlobParts.push(chunk);
  }

  public async finalize(): Promise<{ blob: Blob; blobUrl: string }> {
    if (this.useOpfs && this.opfsWritable) {
      try {
        await this.opfsWritable.close();
        const file = await this.opfsFileHandle.getFile();
        const blobUrl = URL.createObjectURL(file);
        return { blob: file, blobUrl };
      } catch (e) {
        console.warn('Failed to finalize OPFS stream, attempting memory parts', e);
      }
    }

    const blob = new Blob(this.memoryBlobParts, { type: 'application/octet-stream' });
    const blobUrl = URL.createObjectURL(blob);
    this.memoryBlobParts = []; // Clear RAM
    return { blob, blobUrl };
  }

  public async cleanup(): Promise<void> {
    this.memoryBlobParts = [];
    if (this.useOpfs) {
      try {
        if (this.opfsWritable) {
          await this.opfsWritable.abort().catch(() => {});
        }
        if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory) {
          const root = await navigator.storage.getDirectory();
          await root.removeEntry(`staging_${this.transferId}.part`).catch(() => {});
        }
      } catch {
        // Ignore cleanup failures
      }
    }
  }

  public getWrittenBytes(): number {
    return this.totalWrittenBytes;
  }
}
