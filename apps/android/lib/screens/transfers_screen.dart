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
    final m = seconds ~/ 60;
    final s = seconds % 60;
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = AuraTheme.of(context);
    final isTransferring = widget.transferState == TransferState.transferring ||
        widget.transferState == TransferState.resuming ||
        widget.transferState == TransferState.verifying;
    final totalSelectedSize = widget.selectedFiles.fold(0, (acc, f) => acc + f.size);
    final progressPct = widget.totalTransferBytes > 0
        ? ((widget.transferredBytes / widget.totalTransferBytes) * 100).clamp(0, 100).toInt()
        : 0;

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

          // Active Transfer Stream Card (If Active)
          if (isTransferring) ...[
            Text(
              'ACTIVE',
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
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          widget.activeFileName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 16,
                            color: theme.textPrimary,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        '$progressPct%',
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 16,
                          color: theme.textPrimary,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '${_formatBytes(widget.transferredBytes)} / ${_formatBytes(widget.totalTransferBytes)} • ${_formatSpeed(widget.speedBytesPerSec)}',
                    style: TextStyle(
                      fontSize: 12,
                      color: theme.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 14),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: widget.totalTransferBytes > 0
                          ? (widget.transferredBytes / widget.totalTransferBytes).clamp(0.0, 1.0)
                          : 0.0,
                      backgroundColor: theme.border,
                      valueColor: AlwaysStoppedAnimation<Color>(theme.actionBackground),
                      minHeight: 4,
                    ),
                  ),
                  const SizedBox(height: 14),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'ETA ${_formatEta(widget.etaSeconds)}',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: theme.textSecondary,
                          letterSpacing: 0.5,
                        ),
                      ),
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
