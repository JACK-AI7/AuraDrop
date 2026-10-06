import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/native_bridge.dart';
import '../components/glass_components.dart';

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
  final VoidCallback onCancelTransfer;
  final Color accentColor;

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
    required this.onCancelTransfer,
    required this.accentColor,
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
    if (bytes < 1024 * 1024 * 1024) return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
  }

  String _formatSpeed(int bps) {
    final mbps = bps / (1024 * 1024);
    if (mbps >= 1.0) return '${mbps.toStringAsFixed(1)} MB/s';
    return '${(bps / 1024).toStringAsFixed(1)} KB/s';
  }

  @override
  Widget build(BuildContext context) {
    final isTransferring = widget.transferState == TransferState.transferring ||
        widget.transferState == TransferState.resuming;
    final totalSelectedSize = widget.selectedFiles.fold(0, (acc, f) => acc + f.size);

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Transfers & Staging',
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      color: Colors.white,
                      letterSpacing: -0.5,
                    ),
                  ),
                  SizedBox(height: 2),
                  Text(
                    'Active streams and local file staging queue.',
                    style: TextStyle(fontSize: 12, color: Color(0xFF8A8A8A)),
                  ),
                ],
              ),
              if (widget.selectedFiles.isNotEmpty)
                GestureDetector(
                  onTap: widget.onClearFiles,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.06),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: Colors.white.withValues(alpha: 0.12), width: 0.6),
                    ),
                    child: const Text(
                      'Clear Queue',
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.white70),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 20),

          // Storage Capacity Check Bar (Section 58)
          GlassCard(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.storage_rounded, size: 16, color: Colors.white70),
                        const SizedBox(width: 8),
                        const Text(
                          'Destination Storage',
                          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Colors.white),
                        ),
                      ],
                    ),
                    Text(
                      _loadingStorage
                          ? 'Checking...'
                          : '${_formatBytes(_usableSpaceBytes)} free',
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Colors.white),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: Container(
                    height: 6,
                    color: Colors.white.withValues(alpha: 0.08),
                    child: _totalSpaceBytes > 0
                        ? FractionallySizedBox(
                            alignment: Alignment.centerLeft,
                            widthFactor: (1.0 - (_usableSpaceBytes / _totalSpaceBytes)).clamp(0.02, 1.0),
                            child: Container(color: Colors.white),
                          )
                        : const SizedBox(),
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      '/sdcard/Download/AuraDrop',
                      style: TextStyle(fontSize: 10, fontFamily: 'monospace', color: Color(0xFF8A8A8A)),
                    ),
                    if (_totalSpaceBytes > 0)
                      Text(
                        'Total: ${_formatBytes(_totalSpaceBytes)}',
                        style: const TextStyle(fontSize: 10, color: Color(0xFF8A8A8A)),
                      ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // Active Transfer Stream Card (If Active)
          if (isTransferring) ...[
            const Text(
              'ACTIVE P2P STREAM',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: Color(0xFF8A8A8A), letterSpacing: 1.0),
            ),
            const SizedBox(height: 10),
            GlassCard(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.10),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Icon(Icons.sync_rounded, color: Colors.white, size: 20),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              widget.activeFileName,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: Colors.white),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              '${_formatBytes(widget.transferredBytes)} of ${_formatBytes(widget.totalTransferBytes)}',
                              style: const TextStyle(fontSize: 12, color: Color(0xFF8A8A8A)),
                            ),
                          ],
                        ),
                      ),
                      Text(
                        _formatSpeed(widget.speedBytesPerSec),
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: Colors.white),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: LinearProgressIndicator(
                      value: widget.totalTransferBytes > 0
                          ? (widget.transferredBytes / widget.totalTransferBytes).clamp(0.0, 1.0)
                          : 0.0,
                      backgroundColor: Colors.white.withValues(alpha: 0.08),
                      valueColor: const AlwaysStoppedAnimation<Color>(Colors.white),
                      minHeight: 5,
                    ),
                  ),
                  const SizedBox(height: 14),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      GestureDetector(
                        onTap: widget.onCancelTransfer,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                          decoration: BoxDecoration(
                            color: Colors.red.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: Colors.red.withValues(alpha: 0.25), width: 0.6),
                          ),
                          child: const Text('Cancel', style: TextStyle(color: Color(0xFFF87171), fontSize: 12, fontWeight: FontWeight.w700)),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
          ],

          // Staged File Queue Header
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'STAGED QUEUE (${widget.selectedFiles.length})',
                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: Color(0xFF8A8A8A), letterSpacing: 1.0),
              ),
              if (widget.selectedFiles.isNotEmpty)
                Text(
                  _formatBytes(totalSelectedSize),
                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Colors.white70),
                ),
            ],
          ),
          const SizedBox(height: 10),

          // File List or Empty State
          if (widget.selectedFiles.isEmpty)
            GlassCard(
              padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 20),
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 52,
                      height: 52,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.white.withValues(alpha: 0.06),
                      ),
                      child: const Icon(Icons.file_upload_outlined, size: 24, color: Colors.white70),
                    ),
                    const SizedBox(height: 14),
                    const Text(
                      'No Files Staged',
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Colors.white),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Pick files from your device to stage them for transfer.\nAny peer you tap on the radar will receive them instantly.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 12, color: Color(0xFF8A8A8A), height: 1.4),
                    ),
                    const SizedBox(height: 18),
                    GlassButton(
                      text: 'Select Files',
                      icon: Icons.add,
                      onPressed: widget.onPickFiles,
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
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
                return GlassCard(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.08),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Icon(Icons.insert_drive_file_outlined, color: Colors.white, size: 18),
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
                              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: Colors.white),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              _formatBytes(file.size),
                              style: const TextStyle(fontSize: 11, color: Color(0xFF8A8A8A)),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close_rounded, size: 18, color: Colors.white54),
                        onPressed: () => widget.onRemoveFile(file),
                      ),
                    ],
                  ),
                );
              },
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: GlassButton(
                text: 'Add More Files',
                icon: Icons.add,
                onPressed: widget.onPickFiles,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
