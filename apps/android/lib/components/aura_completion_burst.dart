import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class AuraCompletionModal extends StatefulWidget {
  final bool isSuccess;
  final String fileName;
  final int fileSize;
  final String sha256;
  final String? localPath;
  final String? errorMessage;
  final VoidCallback onOpen;
  final VoidCallback onShare;
  final VoidCallback onDismiss;
  final VoidCallback? onRetry;
  final Color accentColor;

  const AuraCompletionModal({
    super.key,
    required this.isSuccess,
    required this.fileName,
    required this.fileSize,
    required this.sha256,
    this.localPath,
    this.errorMessage,
    required this.onOpen,
    required this.onShare,
    required this.onDismiss,
    this.onRetry,
    required this.accentColor,
  });

  @override
  State<AuraCompletionModal> createState() => _AuraCompletionModalState();
}

class _AuraCompletionModalState extends State<AuraCompletionModal> with SingleTickerProviderStateMixin {
  late final AnimationController _animController;
  late final Animation<double> _scaleAnim;
  late final Animation<double> _burstAnim;
  late final Animation<double> _checkAnim;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 950),
    );

    _scaleAnim = CurvedAnimation(
      parent: _animController,
      curve: const Interval(0.0, 0.45, curve: Curves.easeOutBack),
    );

    _burstAnim = CurvedAnimation(
      parent: _animController,
      curve: const Interval(0.2, 0.75, curve: Curves.easeOutQuad),
    );

    _checkAnim = CurvedAnimation(
      parent: _animController,
      curve: const Interval(0.4, 0.9, curve: Curves.easeOutCubic),
    );

    _animController.forward();
    HapticFeedback.mediumImpact();
  }

  @override
  void dispose() {
    _animController.dispose();
    super.dispose();
  }

  String _formatBytes(int bytes) {
    if (bytes >= 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
    } else if (bytes >= 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    } else if (bytes >= 1024) {
      return '${(bytes / 1024).toStringAsFixed(0)} KB';
    }
    return '$bytes B';
  }

  @override
  Widget build(BuildContext context) {
    final statusColor = widget.isSuccess ? const Color(0xFF10B981) : const Color(0xFFF87171);

    return Center(
      child: Material(
        color: Colors.transparent,
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 24),
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: const Color(0xFF141926).withValues(alpha: 0.92),
            borderRadius: BorderRadius.circular(28),
            border: Border.all(
              color: statusColor.withValues(alpha: 0.4),
              width: 1.2,
            ),
            boxShadow: [
              BoxShadow(
                color: statusColor.withValues(alpha: 0.2),
                blurRadius: 40,
                spreadRadius: -4,
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Burst & Icon Layer
              SizedBox(
                width: 100,
                height: 100,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    AnimatedBuilder(
                      animation: _burstAnim,
                      builder: (context, _) {
                        return CustomPaint(
                          size: const Size(100, 100),
                          painter: _BurstPainter(
                            progress: _burstAnim.value,
                            color: statusColor,
                          ),
                        );
                      },
                    ),
                    ScaleTransition(
                      scale: _scaleAnim,
                      child: Container(
                        width: 68,
                        height: 68,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: statusColor.withValues(alpha: 0.2),
                          border: Border.all(color: statusColor, width: 2),
                        ),
                        child: AnimatedBuilder(
                          animation: _checkAnim,
                          builder: (context, _) {
                            return widget.isSuccess
                                ? CustomPaint(
                                    painter: _CheckmarkPainter(
                                      progress: _checkAnim.value,
                                      color: statusColor,
                                    ),
                                  )
                                : Icon(
                                    Icons.error_outline_rounded,
                                    color: statusColor,
                                    size: 36,
                                  );
                          },
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 16),

              Text(
                widget.isSuccess ? 'Transfer Complete' : 'Transfer Failed',
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  color: Colors.white,
                ),
              ),

              const SizedBox(height: 6),

              Text(
                widget.fileName,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: Colors.white70,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),

              const SizedBox(height: 4),

              Text(
                widget.isSuccess
                    ? _formatBytes(widget.fileSize)
                    : (widget.errorMessage ?? 'Integrity verification or network interrupted'),
                style: TextStyle(
                  fontSize: 12,
                  color: widget.isSuccess ? Colors.white54 : const Color(0xFFFCA5A5),
                ),
                textAlign: TextAlign.center,
              ),

              if (widget.isSuccess && widget.sha256.isNotEmpty) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.05),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: Colors.white12),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.verified_rounded, size: 14, color: Color(0xFF10B981)),
                      const SizedBox(width: 6),
                      Text(
                        'SHA-256: ${widget.sha256.substring(0, math.min(16, widget.sha256.length))}...',
                        style: const TextStyle(
                          fontSize: 11,
                          fontFamily: 'monospace',
                          color: Colors.white60,
                        ),
                      ),
                    ],
                  ),
                ),
              ],

              const SizedBox(height: 24),

              // Action Buttons
              if (widget.isSuccess)
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.white,
                          side: const BorderSide(color: Colors.white24),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          padding: const EdgeInsets.symmetric(vertical: 12),
                        ),
                        onPressed: widget.onShare,
                        icon: const Icon(Icons.share_rounded, size: 18),
                        label: const Text('Share'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: widget.accentColor,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          elevation: 0,
                        ),
                        onPressed: widget.onOpen,
                        icon: const Icon(Icons.folder_open_rounded, size: 18),
                        label: const Text('Open'),
                      ),
                    ),
                  ],
                )
              else
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.white70,
                          side: const BorderSide(color: Colors.white24),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          padding: const EdgeInsets.symmetric(vertical: 12),
                        ),
                        onPressed: widget.onDismiss,
                        child: const Text('Close'),
                      ),
                    ),
                    if (widget.onRetry != null) ...[
                      const SizedBox(width: 12),
                      Expanded(
                        child: ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFFEF4444),
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                            padding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                          onPressed: widget.onRetry,
                          icon: const Icon(Icons.refresh_rounded, size: 18),
                          label: const Text('Retry'),
                        ),
                      ),
                    ],
                  ],
                ),

              if (widget.isSuccess) ...[
                const SizedBox(height: 10),
                TextButton(
                  onPressed: widget.onDismiss,
                  child: const Text('Dismiss', style: TextStyle(color: Colors.white54, fontSize: 12)),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _BurstPainter extends CustomPainter {
  final double progress;
  final Color color;

  _BurstPainter({required this.progress, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    if (progress <= 0 || progress >= 1.0) return;

    final center = Offset(size.width / 2, size.height / 2);
    final count = 14;
    final maxRadius = size.width * 0.48;
    final pDist = progress * maxRadius;
    final alpha = (1.0 - progress) * 0.9;
    final pPaint = Paint()
      ..style = PaintingStyle.fill
      ..color = color.withValues(alpha: alpha);

    for (int i = 0; i < count; i++) {
      final angle = (i * (2 * math.pi / count));
      final px = center.dx + math.cos(angle) * pDist;
      final py = center.dy + math.sin(angle) * pDist;
      canvas.drawCircle(Offset(px, py), (1.0 - progress) * 2.8 + 0.8, pPaint);
    }
  }

  @override
  bool shouldRepaint(covariant _BurstPainter oldDelegate) => oldDelegate.progress != progress;
}

class _CheckmarkPainter extends CustomPainter {
  final double progress;
  final Color color;

  _CheckmarkPainter({required this.progress, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    if (progress <= 0) return;

    final p = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.5
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final w = size.width;
    final h = size.height;

    // Checkmark points: start, elbow, tip
    final start = Offset(w * 0.30, h * 0.52);
    final elbow = Offset(w * 0.45, h * 0.68);
    final tip = Offset(w * 0.72, h * 0.36);

    final path = Path();
    if (progress < 0.45) {
      final sub = progress / 0.45;
      path.moveTo(start.dx, start.dy);
      path.lineTo(
        start.dx + (elbow.dx - start.dx) * sub,
        start.dy + (elbow.dy - start.dy) * sub,
      );
    } else {
      final sub = (progress - 0.45) / 0.55;
      path.moveTo(start.dx, start.dy);
      path.lineTo(elbow.dx, elbow.dy);
      path.lineTo(
        elbow.dx + (tip.dx - elbow.dx) * sub,
        elbow.dy + (tip.dy - elbow.dy) * sub,
      );
    }

    canvas.drawPath(path, p);
  }

  @override
  bool shouldRepaint(covariant _CheckmarkPainter oldDelegate) => oldDelegate.progress != progress;
}
