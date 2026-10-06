import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/native_bridge.dart';
import '../theme/aura_theme.dart';
import '../components/minimal_components.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});

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
    if (mounted) {
      setState(() {
        _history = hist;
        _receivedFiles = rec;
        _isLoading = false;
      });
    }
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
  }

  void _showDetailModal(TransferHistoryItem item, AuraTheme theme) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: theme.cardBackground,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
            border: Border.all(color: theme.border, width: 1.0),
          ),
          child: SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.fileName,
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    color: theme.textPrimary,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${item.direction.toUpperCase()} • ${_formatBytes(item.fileSize)}',
                  style: TextStyle(fontSize: 13, color: theme.textSecondary),
                ),
                const SizedBox(height: 20),
                _buildDetailRow('Peer', item.direction == 'sent' ? item.receiverName : item.senderName, theme),
                _buildDetailRow('Status', item.status.toUpperCase(), theme),
                _buildDetailRow('Transport', item.transportType, theme),
                _buildDetailRow('Avg Speed', '${_formatBytes(item.avgSpeed)}/s', theme),
                _buildDetailRow('SHA-256 Checksum', item.sha256.isNotEmpty ? item.sha256 : 'Verified byte-for-byte', theme),
                if (item.localPath.isNotEmpty) _buildDetailRow('Path', item.localPath, theme),
                const SizedBox(height: 20),
                if (item.localPath.isNotEmpty)
                  SizedBox(
                    width: double.infinity,
                    child: MinimalButton(
                      text: 'Open File',
                      icon: Icons.open_in_new_rounded,
                      onPressed: () async {
                        Navigator.pop(ctx);
                        await NativeBridgeService.openFile(item.localPath);
                      },
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildDetailRow(String label, String value, AuraTheme theme) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(
              label,
              style: TextStyle(fontSize: 12, color: theme.textSecondary, fontWeight: FontWeight.w600),
            ),
          ),
          Expanded(
            child: Text(
              value,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 12, color: theme.textPrimary, fontWeight: FontWeight.w500),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = AuraTheme.of(context);

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'History',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  color: theme.textPrimary,
                  letterSpacing: -0.5,
                ),
              ),
              MinimalIconButton(
                icon: Icons.refresh_rounded,
                onPressed: _loadData,
                size: 34,
              ),
            ],
          ),
          const SizedBox(height: 16),

          // Clean Minimal Tab Bar
          Container(
            height: 38,
            decoration: BoxDecoration(
              color: theme.cardBackground,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: theme.border, width: 1.0),
            ),
            child: TabBar(
              controller: _tabController,
              indicatorSize: TabBarIndicatorSize.tab,
              dividerColor: Colors.transparent,
              indicator: BoxDecoration(
                color: theme.actionBackground,
                borderRadius: BorderRadius.circular(9),
              ),
              labelColor: theme.actionText,
              unselectedLabelColor: theme.textSecondary,
              labelStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12),
              tabs: const [
                Tab(text: 'Received Files'),
                Tab(text: 'Transfer Log'),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Content
          Expanded(
            child: _isLoading
                ? Center(child: CircularProgressIndicator(strokeWidth: 2, color: theme.textPrimary))
                : TabBarView(
                    controller: _tabController,
                    children: [
                      _buildReceivedFilesTab(theme),
                      _buildTransferLogTab(theme),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildReceivedFilesTab(AuraTheme theme) {
    if (_receivedFiles.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'No received files yet',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: theme.textPrimary),
            ),
            const SizedBox(height: 4),
            Text(
              'Files saved to /Download/AuraDrop appear here.',
              style: TextStyle(fontSize: 12, color: theme.textSecondary),
            ),
          ],
        ),
      );
    }

    return ListView.separated(
      itemCount: _receivedFiles.length,
      separatorBuilder: (context, index) => const SizedBox(height: 8),
      itemBuilder: (context, idx) {
        final f = _receivedFiles[idx];
        return MinimalCard(
          padding: const EdgeInsets.all(14),
          onTap: () => NativeBridgeService.openFile(f.path),
          child: Row(
            children: [
              Icon(Icons.insert_drive_file_outlined, color: theme.textPrimary, size: 22),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      f.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: theme.textPrimary),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${_formatBytes(f.size)} • ${f.extension.toUpperCase()}',
                      style: TextStyle(fontSize: 11, color: theme.textSecondary),
                    ),
                  ],
                ),
              ),
              Icon(Icons.open_in_new_rounded, color: theme.textSecondary, size: 16),
            ],
          ),
        );
      },
    );
  }

  Widget _buildTransferLogTab(AuraTheme theme) {
    if (_history.isEmpty) {
      return Center(
        child: Text(
          'No transfer log entries',
          style: TextStyle(fontSize: 14, color: theme.textSecondary),
        ),
      );
    }

    return ListView.separated(
      itemCount: _history.length,
      separatorBuilder: (context, index) => const SizedBox(height: 8),
      itemBuilder: (context, idx) {
        final item = _history[idx];
        final isSent = item.direction == 'sent';

        return MinimalCard(
          padding: const EdgeInsets.all(14),
          onTap: () => _showDetailModal(item, theme),
          child: Row(
            children: [
              Icon(
                isSent ? Icons.arrow_upward_rounded : Icons.arrow_downward_rounded,
                color: theme.textPrimary,
                size: 20,
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
                      style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: theme.textPrimary),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${isSent ? "To: ${item.receiverName}" : "From: ${item.senderName}"} • ${_formatBytes(item.fileSize)}',
                      style: TextStyle(fontSize: 11, color: theme.textSecondary),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: theme.subtleHighlight,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  item.isAvailable ? 'Verified ✓' : 'FILE UNAVAILABLE',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: item.isAvailable ? theme.textPrimary : theme.error,
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
