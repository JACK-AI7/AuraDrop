/**
 * Section 11: Transfer Engine Error Taxonomy
 * Provides human-readable, actionable failure reasons with retry capability.
 */

export type TransferErrorCode =
  | 'CONNECTION_LOST'
  | 'STORAGE_UNAVAILABLE'
  | 'PERMISSION_DENIED'
  | 'INTEGRITY_FAILED'
  | 'RECEIVER_CANCELLED'
  | 'RECEIVER_DECLINED'
  | 'NETWORK_CHANGED'
  | 'TIMEOUT'
  | 'DUPLICATE_FILENAME'
  | 'CRYPTO_ERROR'
  | 'UNKNOWN';

export interface TransferErrorDetails {
  code: TransferErrorCode;
  message: string;
  userFacingExplanation: string;
  canRetry: boolean;
  suggestedAction: string;
  diagnostics?: Record<string, any>;
}

export class AuraTransferError extends Error {
  public details: TransferErrorDetails;

  constructor(details: TransferErrorDetails) {
    super(details.message);
    this.name = 'AuraTransferError';
    this.details = details;
  }

  static connectionLost(peerName?: string, diagnostics?: any): AuraTransferError {
    return new AuraTransferError({
      code: 'CONNECTION_LOST',
      message: `P2P connection with ${peerName || 'remote peer'} was abruptly interrupted.`,
      userFacingExplanation: 'Connection was lost during the transfer. Make sure both devices stay on the same Wi-Fi network.',
      canRetry: true,
      suggestedAction: 'Reconnect to the peer and resume transfer from saved checkpoint.',
      diagnostics,
    });
  }

  static storageUnavailable(requiredBytes?: number, availableBytes?: number): AuraTransferError {
    return new AuraTransferError({
      code: 'STORAGE_UNAVAILABLE',
      message: `Insufficient disk space for incoming transfer. Required: ${requiredBytes}, Available: ${availableBytes}`,
      userFacingExplanation: 'Storage full. The receiving device does not have enough free disk space to store the incoming files.',
      canRetry: false,
      suggestedAction: 'Free up disk space on the receiver device and try again.',
      diagnostics: { requiredBytes, availableBytes },
    });
  }

  static permissionDenied(pathAttempted?: string): AuraTransferError {
    return new AuraTransferError({
      code: 'PERMISSION_DENIED',
      message: `Filesystem permission denied when attempting to write to ${pathAttempted || 'download folder'}.`,
      userFacingExplanation: 'Permission denied. The application does not have write access to the destination folder.',
      canRetry: true,
      suggestedAction: 'Check operating system storage permissions in Settings.',
      diagnostics: { pathAttempted },
    });
  }

  static integrityFailed(fileId: string, expectedChecksum: string, computedChecksum: string): AuraTransferError {
    return new AuraTransferError({
      code: 'INTEGRITY_FAILED',
      message: `Full-file SHA-256 integrity validation failed for ${fileId}.`,
      userFacingExplanation: 'Integrity check failed. Some data packets were corrupted in transit. The incomplete file was safely removed.',
      canRetry: true,
      suggestedAction: 'Retry the transfer to re-stream verified chunks.',
      diagnostics: { fileId, expectedChecksum, computedChecksum },
    });
  }

  static receiverCancelled(receiverName?: string): AuraTransferError {
    return new AuraTransferError({
      code: 'RECEIVER_CANCELLED',
      message: `Transfer was cancelled by ${receiverName || 'the receiver'}.`,
      userFacingExplanation: 'The recipient cancelled the transfer.',
      canRetry: false,
      suggestedAction: 'Ask the recipient before transmitting again.',
    });
  }

  static receiverDeclined(receiverName?: string): AuraTransferError {
    return new AuraTransferError({
      code: 'RECEIVER_DECLINED',
      message: `Transfer was declined by ${receiverName || 'the receiver'}.`,
      userFacingExplanation: 'The recipient declined your transfer request.',
      canRetry: false,
      suggestedAction: 'Ensure recipient is ready and select them again.',
    });
  }

  static networkChanged(oldInterface?: string, newInterface?: string): AuraTransferError {
    return new AuraTransferError({
      code: 'NETWORK_CHANGED',
      message: `Network interface changed from ${oldInterface || 'unknown'} to ${newInterface || 'unknown'}.`,
      userFacingExplanation: 'Network changed. The Wi-Fi connection switched or disconnected.',
      canRetry: true,
      suggestedAction: 'AuraDrop will automatically attempt to resume when reconnected.',
      diagnostics: { oldInterface, newInterface },
    });
  }
}
