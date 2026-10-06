/**
 * Real-time Transfer Speed & ETA Estimator using Exponential Moving Average (EWMA)
 */
export class SpeedCalculator {
  private lastTimestamp: number = 0;
  private lastBytes: number = 0;
  private smoothedSpeedBytesPerSec: number = 0;
  private readonly alpha: number = 0.25; // Smoothing factor for EWMA

  constructor() {
    this.reset();
  }

  reset(): void {
    this.lastTimestamp = Date.now();
    this.lastBytes = 0;
    this.smoothedSpeedBytesPerSec = 0;
  }

  update(currentTotalBytes: number, totalExpectedBytes: number): { speedBytesPerSec: number; etaSeconds: number } {
    const now = Date.now();
    const deltaMs = now - this.lastTimestamp;

    if (deltaMs >= 400) {
      // Update measurement window every 400ms
      const deltaBytes = currentTotalBytes - this.lastBytes;
      const instantaneousSpeed = (deltaBytes / deltaMs) * 1000; // bytes/sec

      if (this.smoothedSpeedBytesPerSec === 0) {
        this.smoothedSpeedBytesPerSec = instantaneousSpeed;
      } else {
        // EWMA filter
        this.smoothedSpeedBytesPerSec =
          this.alpha * instantaneousSpeed + (1 - this.alpha) * this.smoothedSpeedBytesPerSec;
      }

      this.lastTimestamp = now;
      this.lastBytes = currentTotalBytes;
    }

    const remainingBytes = Math.max(0, totalExpectedBytes - currentTotalBytes);
    let etaSeconds = 0;

    if (this.smoothedSpeedBytesPerSec > 0) {
      etaSeconds = Math.ceil(remainingBytes / this.smoothedSpeedBytesPerSec);
    }

    return {
      speedBytesPerSec: Math.round(this.smoothedSpeedBytesPerSec),
      etaSeconds,
    };
  }

  static formatSpeed(bytesPerSec: number): string {
    if (bytesPerSec < 1024) return `${bytesPerSec} B/s`;
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    if (bytesPerSec < 1024 * 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
    return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
  }

  static formatEta(seconds: number): string {
    if (seconds <= 0) return 'Almost done';
    if (seconds < 60) return `${seconds}s remaining`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return `${mins}m ${secs}s remaining`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m remaining`;
  }

  static formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}
