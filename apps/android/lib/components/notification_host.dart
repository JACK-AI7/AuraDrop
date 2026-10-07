import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/aura_theme.dart';

enum InAppNotificationType {
  transferRequest,
  chatMessage,
  transferCompleted,
  transferFailed,
  info,
}

class InAppNotificationItem {
  final String id;
  final InAppNotificationType type;
  final String title;
  final String message;
  final String? subtitle;
  final VoidCallback? onTap;
  final VoidCallback? onAccept;
  final VoidCallback? onDecline;
  final Duration duration;
  final DateTime createdAt;

  InAppNotificationItem({
    required this.id,
    required this.type,
    required this.title,
    required this.message,
    this.subtitle,
    this.onTap,
    this.onAccept,
    this.onDecline,
    this.duration = const Duration(seconds: 5),
  }) : createdAt = DateTime.now();
}

class InAppNotificationController extends ChangeNotifier {
  static final InAppNotificationController _instance = InAppNotificationController._internal();
  factory InAppNotificationController() => _instance;
  InAppNotificationController._internal();

  final List<InAppNotificationItem> _queue = [];
  Timer? _dismissTimer;

  InAppNotificationItem? get current => _queue.isNotEmpty ? _queue.first : null;

  void show(InAppNotificationItem item) {
    // If it's a transfer request with the same id, replace it
    _queue.removeWhere((existing) => existing.id == item.id);
    _queue.add(item);
    notifyListeners();

    if (_queue.length == 1) {
      _scheduleDismiss(item);
    }
  }

  void showTransferRequest({
    required String transferId,
    required String senderName,
    required String fileName,
    required int fileSize,
    required VoidCallback onAccept,
    required VoidCallback onDecline,
  }) {
    show(InAppNotificationItem(
      id: 'req_$transferId',
      type: InAppNotificationType.transferRequest,
      title: 'Incoming File Transfer',
      message: '$senderName wants to send $fileName',
      subtitle: '${(fileSize / (1024 * 1024)).toStringAsFixed(1)} MB',
      duration: const Duration(seconds: 45),
      onAccept: onAccept,
      onDecline: onDecline,
    ));
  }

  void showChatMessage({
    required String peerId,
    required String senderName,
    required String text,
    VoidCallback? onTap,
  }) {
    show(InAppNotificationItem(
      id: 'chat_${peerId}_${DateTime.now().millisecondsSinceEpoch}',
      type: InAppNotificationType.chatMessage,
      title: senderName,
      message: text,
      duration: const Duration(seconds: 4),
      onTap: onTap,
    ));
  }

  void showTransferComplete({
    required String fileName,
    VoidCallback? onOpen,
  }) {
    show(InAppNotificationItem(
      id: 'done_${DateTime.now().millisecondsSinceEpoch}',
      type: InAppNotificationType.transferCompleted,
      title: 'Transfer Complete',
      message: fileName,
      duration: const Duration(seconds: 4),
      onTap: onOpen,
    ));
  }

  void dismissCurrent() {
    _dismissTimer?.cancel();
    if (_queue.isNotEmpty) {
      _queue.removeAt(0);
      notifyListeners();
      if (_queue.isNotEmpty) {
        _scheduleDismiss(_queue.first);
      }
    }
  }

  void dismissById(String id) {
    final isCurrent = _queue.isNotEmpty && _queue.first.id == id;
    _queue.removeWhere((item) => item.id == id);
    if (isCurrent) {
      _dismissTimer?.cancel();
      notifyListeners();
      if (_queue.isNotEmpty) {
        _scheduleDismiss(_queue.first);
      }
    } else {
      notifyListeners();
    }
  }

  void _scheduleDismiss(InAppNotificationItem item) {
    _dismissTimer?.cancel();
    _dismissTimer = Timer(item.duration, () {
      dismissCurrent();
    });
  }
}

class InAppNotificationHost extends StatefulWidget {
  final Widget child;

  const InAppNotificationHost({
    super.key,
    required this.child,
  });

  @override
  State<InAppNotificationHost> createState() => _InAppNotificationHostState();
}

class _InAppNotificationHostState extends State<InAppNotificationHost>
    with SingleTickerProviderStateMixin {
  final _controller = InAppNotificationController();
  late final AnimationController _animController;
  late final Animation<Offset> _offsetAnim;
  late final Animation<double> _fadeAnim;
  String? _lastId;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 320),
    );
    _offsetAnim = Tween<Offset>(
      begin: const Offset(0, -1.2),
      end: Offset.zero,
    ).animate(CurvedAnimation(
      parent: _animController,
      curve: Curves.easeOutCubic,
    ));
    _fadeAnim = CurvedAnimation(
      parent: _animController,
      curve: Curves.easeOut,
    );

    _controller.addListener(_onNotificationUpdate);
  }

  @override
  void dispose() {
    _controller.removeListener(_onNotificationUpdate);
    _animController.dispose();
    super.dispose();
  }

  void _onNotificationUpdate() {
    final current = _controller.current;
    if (current != null) {
      if (_lastId != current.id) {
        _lastId = current.id;
        _animController.forward(from: 0.0);
      }
    } else {
      _lastId = null;
      _animController.reverse();
    }
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final current = _controller.current;
    final theme = AuraTheme.of(context);

    return Stack(
      children: [
        widget.child,
        if (current != null)
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: SlideTransition(
                  position: _offsetAnim,
                  child: FadeTransition(
                    opacity: _fadeAnim,
                    child: Dismissible(
                      key: Key(current.id),
                      direction: DismissDirection.up,
                      onDismissed: (_) {
                        _controller.dismissCurrent();
                      },
                      child: _buildBanner(current, theme),
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildBanner(InAppNotificationItem item, AuraTheme theme) {
    final isRequest = item.type == InAppNotificationType.transferRequest;

    return Material(
      color: Colors.transparent,
      child: Container(
        decoration: BoxDecoration(
          color: theme.isDark ? const Color(0xFF141414) : const Color(0xFFFFFFFF),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: theme.border,
            width: 1.0,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: theme.isDark ? 0.5 : 0.12),
              blurRadius: 20,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        padding: const EdgeInsets.all(14),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _buildIcon(item.type, theme),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: theme.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        item.message,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 12,
                          color: theme.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                if (!isRequest)
                  IconButton(
                    icon: Icon(Icons.close_rounded, size: 18, color: theme.textSecondary),
                    onPressed: () {
                      _controller.dismissCurrent();
                    },
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                  ),
              ],
            ),
            if (isRequest) ...[
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  OutlinedButton(
                    onPressed: () {
                      HapticFeedback.lightImpact();
                      _controller.dismissCurrent();
                      item.onDecline?.call();
                    },
                    style: OutlinedButton.styleFrom(
                      foregroundColor: theme.textPrimary,
                      side: BorderSide(color: theme.border),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                      minimumSize: Size.zero,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    child: const Text('Decline', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton(
                    onPressed: () {
                      HapticFeedback.mediumImpact();
                      _controller.dismissCurrent();
                      item.onAccept?.call();
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: theme.actionBackground,
                      foregroundColor: theme.actionText,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      minimumSize: Size.zero,
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    child: const Text('Accept', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildIcon(InAppNotificationType type, AuraTheme theme) {
    IconData icon;
    switch (type) {
      case InAppNotificationType.transferRequest:
        icon = Icons.downloading_rounded;
        break;
      case InAppNotificationType.chatMessage:
        icon = Icons.chat_bubble_rounded;
        break;
      case InAppNotificationType.transferCompleted:
        icon = Icons.check_circle_rounded;
        break;
      case InAppNotificationType.transferFailed:
        icon = Icons.error_outline_rounded;
        break;
      case InAppNotificationType.info:
        icon = Icons.info_outline_rounded;
        break;
    }

    return Container(
      width: 32,
      height: 32,
      decoration: BoxDecoration(
        color: theme.subtleHighlight,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Icon(icon, size: 18, color: theme.textPrimary),
    );
  }
}
