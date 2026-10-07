import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/native_bridge.dart';
import '../theme/aura_theme.dart';
import '../components/minimal_components.dart';

class TransfersScreen extends StatefulWidget {
  final List<PickedFileMeta> selectedFiles;
  final VoidCallback onPickFiles;
  final Function(PickedFileMeta) onRemoveFile;
  final VoidCallback onClearFiles;
  final TransferState transferState;
  final String activeFileName;
  final int transferredBytes;
  final int totalTransferBytes;
  final int speedBytesPerSec;
  final int etaSeconds;
  final VoidCallback onCancelTransfer;
  final bool isIncoming;

  const TransfersScreen({
    super.key,
    required this.selectedFiles,
    required this.onPickFiles,
    required this.onRemoveFile,
    required this.onClearFiles,
    required this.transferState,
    required this.activeFileName,
    required this.transferredBytes,
    required this.totalTransferBytes,
    required this.speedBytesPerSec,
    this.etaSeconds = 0,
    required this.onCancelTransfer,
    this.isIncoming = false,
  });

  @override
  State<TransfersScreen> createState() => _TransfersScreenState();
}

class _TransfersScreenState extends State<TransfersScreen> {
  int _usableSpaceBytes = 0;
  int _totalSpaceBytes = 0;
  bool _loadingStorage = true;

  @override
  void initState() {
    super.initState();
    _loadStorageSpace();
  }

  Future<void> _loadStorageSpace() async {
    final storage = await NativeBridgeService.checkStorageSpace();
    if (mounted) {
      setState(() {
        _usableSpaceBytes = storage['usable'] ?? 0;
        _totalSpaceBytes = storage['total'] ?? 0;
        _loadingStorage = false;
      });
    }
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) return '${(bytes / (1024 * 1024)).toStringAsFixed(2)} MB';
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
  }

  String _formatSpeed(int bps) {
    final mbps = bps / (1024 * 1024);
    if (mbps >= 1.0) return '${mbps.toStringAsFixed(1)} MB/s';
    return '${(bps / 1024).toStringAsFixed(1)} KB/s';
  }

  String _formatEta(int seconds) {
    if (seconds <= 0) return '--:--';
    final m = seconds ~/ 60;
    final s = seconds % 60;
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }

  String _getProgressDisplay() {
    if (widget.transferState == TransferState.completed) {
      return '100.0%';
    }
    if (widget.transferState == TransferState.verifying) {
      return 'Verifying';
    }
    if (widget.transferState == TransferState.flushing) {
      return 'Flushing';
    }
    if (widget.transferState == TransferState.databaseCommit) {
      return 'Finalizing';
    }
    if (widget.totalTransferBytes <= 0) {
      return '0.0%';
    }

    // Strict rule: Clamped to 99.9% during transfer until verified and completed
    final rawPct = (widget.transferredBytes / widget.totalTransferBytes) * 100.0;
    final safePct = rawPct.clamp(0.0, 99.9);
    return '${safePct.toStringAsFixed(1)}%';
  }

  double _getProgressValue() {
    if (widget.transferState == TransferState.completed) return 1.0;
    if (widget.totalTransferBytes <= 0) return 0.0;
    final ratio = widget.transferredBytes / widget.totalTransferBytes;
    return ratio.clamp(0.0, 0.999);
  }

  @override
  Widget build(BuildContext context) {
    final theme = AuraTheme.of(context);
    final isTransferring = widget.transferState.isActive;
    final totalSelectedSize = widget.selectedFiles.fold(0, (acc, f) => acc + f.size);

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Transfers',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  color: theme.textPrimary,
                  letterSpacing: -0.5,
                ),
              ),
              if (widget.selectedFiles.isNotEmpty)
                GestureDetector(
                  onTap: widget.onClearFiles,
                  behavior: HitTestBehavior.opaque,
                  child: Text(
                    'Clear All',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: theme.textSecondary,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 20),

          // Active Transfer Stream Card (If Active or Verifying)
          if (isTransferring || widget.transferState == TransferState.completed) ...[
            Text(
              'ACTIVE STREAM',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w800,
                color: theme.textSecondary,
                letterSpacing: 1.2,
              ),
            ),
            const SizedBox(height: 10),
            MinimalCard(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      // Direction indicator
                      Container(
                        width: 32,
                        height: 32,
                        decoration: BoxDecoration(
                          color: theme.subtleHighlight,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: theme.border, width: 1.0),
                        ),
                        child: Center(
                          child: Icon(
                            widget.isIncoming
                                ? Icons.arrow_downward_rounded
                                : Icons.arrow_upward_rounded,
                            size: 18,
                            color: theme.textPrimary,
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              widget.activeFileName.isEmpty ? 'File Transfer' : widget.activeFileName,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 15,
                                color: theme.textPrimary,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              widget.transferState.label,
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                color: widget.transferState == TransferState.completed
                                    ? (theme.isDark ? Colors.white : Colors.black)
                                    : theme.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        _getProgressDisplay(),
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 16,
                          color: theme.textPrimary,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: _getProgressValue(),
                      backgroundColor: theme.border,
                      valueColor: AlwaysStoppedAnimation<Color>(theme.actionBackground),
                      minHeight: 5,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '${_formatBytes(widget.transferredBytes)} / ${_formatBytes(widget.totalTransferBytes)} • ${_formatSpeed(widget.speedBytesPerSec)}',
                        style: TextStyle(
                          fontSize: 12,
                          color: theme.textSecondary,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      if (widget.transferState != TransferState.completed)
                        Row(
                          children: [
                            Text(
                              'ETA ${_formatEta(widget.etaSeconds)}',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                color: theme.textSecondary,
                                letterSpacing: 0.3,
                              ),
                            ),
                            const SizedBox(width: 12),
                            GestureDetector(
                              onTap: widget.onCancelTransfer,
                              behavior: HitTestBehavior.opaque,
                              child: Text(
                                'Cancel',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w700,
                                  color: theme.error,
                                ),
                              ),
                            ),
                          ],
                        ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
          ],

          // Storage Capacity Check Bar
          Text(
            'STORAGE',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              color: theme.textSecondary,
              letterSpacing: 1.2,
            ),
          ),
          const SizedBox(height: 10),
          MinimalCard(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      _loadingStorage
                          ? 'Checking storage...'
                          : '${_formatBytes(_usableSpaceBytes)} free',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: theme.textPrimary,
                      ),
                    ),
                    if (_totalSpaceBytes > 0)
                      Text(
                        '${_formatBytes(_totalSpaceBytes)} total',
                        style: TextStyle(
                          fontSize: 12,
                          color: theme.textSecondary,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: Container(
                    height: 5,
                    color: theme.border,
                    child: _totalSpaceBytes > 0
                        ? FractionallySizedBox(
                            alignment: Alignment.centerLeft,
                            widthFactor: (1.0 - (_usableSpaceBytes / _totalSpaceBytes)).clamp(0.02, 1.0),
                            child: Container(color: theme.actionBackground),
                          )
                        : const SizedBox(),
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  '/sdcard/Download/AuraDrop',
                  style: TextStyle(
                    fontSize: 10,
                    fontFamily: 'monospace',
                    color: theme.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // Staged File Queue Header
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'STAGED QUEUE (${widget.selectedFiles.length})',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  color: theme.textSecondary,
                  letterSpacing: 1.2,
                ),
              ),
              if (widget.selectedFiles.isNotEmpty)
                Text(
                  _formatBytes(totalSelectedSize),
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: theme.textPrimary,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),

          // File List or Clean Empty State
          if (widget.selectedFiles.isEmpty)
            MinimalCard(
              padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 20),
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'No files staged',
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: theme.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Select files from device storage to share with nearby devices.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 12,
                        color: theme.textSecondary,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 18),
                    MinimalButton(
                      text: '+ Add Files',
                      onPressed: widget.onPickFiles,
                    ),
                  ],
                ),
              ),
            )
          else ...[
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: widget.selectedFiles.length,
              separatorBuilder: (context, index) => const SizedBox(height: 8),
              itemBuilder: (context, index) {
                final file = widget.selectedFiles[index];
                return MinimalCard(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  child: Row(
                    children: [
                      Icon(
                        Icons.insert_drive_file_outlined,
                        color: theme.textPrimary,
                        size: 20,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              file.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 13,
                                color: theme.textPrimary,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              _formatBytes(file.size),
                              style: TextStyle(
                                fontSize: 11,
                                color: theme.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                      GestureDetector(
                        onTap: () => widget.onRemoveFile(file),
                        behavior: HitTestBehavior.opaque,
                        child: Padding(
                          padding: const EdgeInsets.all(4),
                          child: Icon(
                            Icons.close_rounded,
                            size: 18,
                            color: theme.textSecondary,
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: MinimalButton(
                text: '+ Add More Files',
                onPressed: widget.onPickFiles,
                isPrimary: false,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
