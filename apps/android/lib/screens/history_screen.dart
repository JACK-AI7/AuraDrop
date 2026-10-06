import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/native_bridge.dart';
import '../components/glass_components.dart';

class HistoryScreen extends StatefulWidget {
  final Color accentColor;

  const HistoryScreen({super.key, required this.accentColor});

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<TransferHistoryItem> _history = [];
  List<ReceivedFileItem> _receivedFiles = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    final hist = await NativeBridgeService.getTransferHistory();
    final rec = await NativeBridgeService.getReceivedFiles();
    setState(() {
      _history = hist;
      _receivedFiles = rec;
      _isLoading = false;
    });
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
  }

  void _showDetailModal(TransferHistoryItem item) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return Container(
          margin: const EdgeInsets.all(16),
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: const Color(0xFF14161F),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: Colors.white.withValues(alpha: 0.15)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Icon(
                    item.direction == 'sent' ? Icons.upload_rounded : Icons.download_rounded,
                    color: widget.accentColor,
                    size: 28,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          item.fileName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white),
                        ),
                        Text(
                          '${item.direction.toUpperCase()} • ${_formatBytes(item.fileSize)}',
                          style: const TextStyle(fontSize: 12, color: Colors.white60),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              _buildDetailRow('Peer', item.direction == 'sent' ? item.receiverName : item.senderName),
              _buildDetailRow('Status', item.status.toUpperCase()),
              _buildDetailRow('Transport', item.transportType),
              _buildDetailRow('Avg Speed', '${_formatBytes(item.avgSpeed)}/s'),
              _buildDetailRow('SHA-256 Checksum', item.sha256.isNotEmpty ? item.sha256 : 'Verified'),
              if (item.localPath.isNotEmpty) _buildDetailRow('Path', item.localPath),
              const SizedBox(height: 20),
              Row(
                children: [
                  if (item.localPath.isNotEmpty)
                    Expanded(
                      child: GlassButton(
                        text: 'Open File',
                        icon: Icons.open_in_new_rounded,
                        accentColor: widget.accentColor,
                        onPressed: () async {
                          Navigator.pop(ctx);
                          await NativeBridgeService.openFile(item.localPath);
                        },
                      ),
                    ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(label, style: const TextStyle(fontSize: 12, color: Colors.white38, fontWeight: FontWeight.w600)),
          ),
          Expanded(
            child: Text(
              value,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, color: Colors.white, fontWeight: FontWeight.w500),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Transfers & Files',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Colors.white),
              ),
              GlassIconButton(
                icon: Icons.refresh_rounded,
                onPressed: _loadData,
                size: 36,
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Tab Bar
          Container(
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
            ),
            child: TabBar(
              controller: _tabController,
              indicatorSize: TabBarIndicatorSize.tab,
              dividerColor: Colors.transparent,
              indicator: BoxDecoration(
                color: widget.accentColor.withValues(alpha: 0.25),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: widget.accentColor.withValues(alpha: 0.6)),
              ),
              labelColor: Colors.white,
              unselectedLabelColor: Colors.white54,
              labelStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
              tabs: const [
                Tab(text: 'Received Library'),
                Tab(text: 'Transfer Log'),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Tab Content
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : TabBarView(
                    controller: _tabController,
                    children: [
                      _buildReceivedFilesTab(),
                      _buildTransferLogTab(),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildReceivedFilesTab() {
    if (_receivedFiles.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.folder_open_rounded, size: 48, color: Colors.white.withValues(alpha: 0.2)),
            const SizedBox(height: 12),
            const Text('No received files yet', style: TextStyle(fontSize: 15, color: Colors.white70)),
            const SizedBox(height: 4),
            const Text('Files saved to Downloads/AuraDrop appear here', style: TextStyle(fontSize: 12, color: Colors.white38)),
          ],
        ),
      );
    }

    return ListView.separated(
      itemCount: _receivedFiles.length,
      separatorBuilder: (_, _) => const SizedBox(height: 10),
      itemBuilder: (context, idx) {
        final f = _receivedFiles[idx];
        return GlassCard(
          padding: const EdgeInsets.all(12),
          onTap: () => NativeBridgeService.openFile(f.path),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: widget.accentColor.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: widget.accentColor.withValues(alpha: 0.3)),
                ),
                child: Icon(Icons.insert_drive_file_rounded, color: widget.accentColor, size: 24),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      f.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Colors.white),
                    ),
                    Text(
                      '${_formatBytes(f.size)} • ${f.extension.toUpperCase()}',
                      style: const TextStyle(fontSize: 11, color: Colors.white54),
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.open_in_new_rounded, color: Colors.white54, size: 18),
                onPressed: () => NativeBridgeService.openFile(f.path),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildTransferLogTab() {
    if (_history.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.history_rounded, size: 48, color: Colors.white.withValues(alpha: 0.2)),
            const SizedBox(height: 12),
            const Text('No transfer log entries', style: TextStyle(fontSize: 15, color: Colors.white70)),
          ],
        ),
      );
    }

    return ListView.separated(
      itemCount: _history.length,
      separatorBuilder: (_, _) => const SizedBox(height: 10),
      itemBuilder: (context, idx) {
        final item = _history[idx];
        final isSent = item.direction == 'sent';

        return GlassCard(
          padding: const EdgeInsets.all(12),
          onTap: () => _showDetailModal(item),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: isSent
                      ? widget.accentColor.withValues(alpha: 0.15)
                      : const Color(0xFF10B981).withValues(alpha: 0.15),
                ),
                child: Icon(
                  isSent ? Icons.upload_rounded : Icons.download_rounded,
                  color: isSent ? widget.accentColor : const Color(0xFF10B981),
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.fileName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Colors.white),
                    ),
                    Text(
                      '${isSent ? "To: ${item.receiverName}" : "From: ${item.senderName}"} • ${_formatBytes(item.fileSize)}',
                      style: const TextStyle(fontSize: 11, color: Colors.white54),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: item.isAvailable
                      ? const Color(0xFF10B981).withValues(alpha: 0.2)
                      : Colors.amber.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  item.isAvailable ? 'VERIFIED' : 'FILE UNAVAILABLE',
                  style: TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.bold,
                    color: item.isAvailable ? const Color(0xFF10B981) : Colors.amber,
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
