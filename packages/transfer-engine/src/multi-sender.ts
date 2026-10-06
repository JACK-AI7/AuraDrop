import { EventEmitter } from 'node:events';
import { TransferSession, DeviceInfo } from '@auradrop/types';
import { LocalFileToSend, FileSender } from './sender';
import { ITransport } from '@auradrop/network';

export interface MultiRecipientTarget {
  device: DeviceInfo;
  transport: ITransport;
  session: TransferSession;
  sessionKey: Buffer;
  baseIv: Buffer;
}

/**
 * Section 20: Multi-Device Sharing Orchestrator
 * Allows 1 sender to broadcast/stream files to multiple independent receivers concurrently
 * without duplicating file data in memory.
 */
export class MultiDeviceSenderOrchestrator extends EventEmitter {
  private senders: Map<string, FileSender> = new Map();

  constructor(
    private files: LocalFileToSend[],
    private recipients: MultiRecipientTarget[]
  ) {
    super();
  }

  async startAll(): Promise<void> {
    const promises = this.recipients.map(async (target) => {
      const sender = new FileSender(
        target.session,
        target.transport,
        target.sessionKey,
        target.baseIv,
        this.files
      );

      this.senders.set(target.device.id, sender);

      sender.on('progress', (prog) => {
        this.emit('recipient_progress', { deviceId: target.device.id, ...prog });
      });

      sender.on('completed', (sess) => {
        this.emit('recipient_completed', { deviceId: target.device.id, session: sess });
      });

      sender.on('error', (err) => {
        this.emit('recipient_error', { deviceId: target.device.id, error: err });
      });

      return sender.start();
    });

    await Promise.allSettled(promises);
    this.emit('all_completed');
  }

  pauseAll(): void {
    for (const sender of this.senders.values()) {
      sender.pause();
    }
  }

  resumeAll(): void {
    for (const sender of this.senders.values()) {
      sender.resume();
    }
  }

  cancelAll(): void {
    for (const sender of this.senders.values()) {
      sender.cancel();
    }
  }

  cancelRecipient(deviceId: string): void {
    const sender = this.senders.get(deviceId);
    if (sender) {
      sender.cancel();
    }
  }
}
