import 'dart:math' as math;
import 'package:flutter/material.dart';

class AuraDataStreamVisualizer extends StatefulWidget {
  final int transferredBytes;
  final int totalBytes;
  final int speedBytesPerSec;
  final String fileName;
  final Color accentColor;
  final bool isSending;
  final VoidCallback? onCancel;
  final VoidCallback? onPauseResume;
  final bool isPaused;

  const AuraDataStreamVisualizer({
    super.key,
    required this.transferredBytes,
    required this.totalBytes,
    required this.speedBytesPerSec,
    required this.fileName,
    required this.accentColor,
    required this.isSending,
    this.onCancel,
    this.onPauseResume,
    this.isPaused = false,
  });

  @override
  State<AuraDataStreamVisualizer> createState() => _AuraDataStreamVisualizerState();
}

class _AuraDataStreamVisualizerState extends State<AuraDataStreamVisualizer> with SingleTickerProviderStateMixin {
  late final AnimationController _streamAnim;

  @override
  void initState() {
    super.initState();
    _streamAnim = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat();
  }

  @override
  void dispose() {
    _streamAnim.dispose();
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

  String _formatSpeed(int speedBytesPerSec) {
    final mbps = speedBytesPerSec / (1024 * 1024);
    return '${mbps.toStringAsFixed(1)} MB/s';
  }

  String _formatEta() {
    if (widget.speedBytesPerSec <= 0 || widget.totalBytes <= widget.transferredBytes) {
      return '--';
    }
    final remainingBytes = widget.totalBytes - widget.transferredBytes;
    final sec = (remainingBytes / widget.speedBytesPerSec).ceil();
    if (sec < 60) return '${sec}s';
    return '${sec ~/ 60}m ${sec % 60}s';
  }

  @override
  Widget build(BuildContext context) {
    final progress = widget.totalBytes > 0
        ? (widget.transferredBytes / widget.totalBytes).clamp(0.0, 1.0)
        : 0.0;
    final speedMbps = widget.speedBytesPerSec / (1024.0 * 1024.0);

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Colors.white.withValues(alpha: 0.12),
            Colors.white.withValues(alpha: 0.04),
          ],
        ),
        border: Border.all(
          color: widget.accentColor.withValues(alpha: 0.4),
          width: 1.2,
        ),
        boxShadow: [
          BoxShadow(
            color: widget.accentColor.withValues(alpha: 0.15),
            blurRadius: 30,
            spreadRadius: -5,
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Header info
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: widget.accentColor.withValues(alpha: 0.2),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  widget.isSending ? Icons.upload_rounded : Icons.download_rounded,
                  color: widget.accentColor,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.fileName,
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                        color: Colors.white,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '${_formatBytes(widget.transferredBytes)} / ${_formatBytes(widget.totalBytes)}',
                      style: const TextStyle(fontSize: 12, color: Colors.white60),
                    ),
                  ],
                ),
              ),
              // Live Speed Badge
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: Colors.black38,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.white12),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(
                        color: widget.speedBytesPerSec > 0 ? const Color(0xFF10B981) : Colors.amber,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      _formatSpeed(widget.speedBytesPerSec),
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 20),

          // Central Visualizer: Progress Ring + Animated Data Stream
          SizedBox(
            height: 120,
            child: Stack(
              alignment: Alignment.center,
              children: [
                // Flowing Particle Stream
                RepaintBoundary(
                  child: AnimatedBuilder(
                    animation: _streamAnim,
                    builder: (context, _) {
                      return CustomPaint(
                        size: const Size(double.infinity, 120),
                        painter: _AuraStreamPainter(
                          animValue: _streamAnim.value,
                          speedMbps: speedMbps,
                          progress: progress,
                          accentColor: widget.accentColor,
                          isSending: widget.isSending,
                          isPaused: widget.isPaused,
                        ),
                      );
                    },
                  ),
                ),

                // Percentage and ETA in center
                Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '${(progress * 100).toStringAsFixed(1)}%',
                      style: TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -0.5,
                        color: Colors.white,
                        shadows: [
                          Shadow(
                            color: widget.accentColor.withValues(alpha: 0.6),
                            blurRadius: 12,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      widget.isPaused ? 'PAUSED' : 'ETA: ${_formatEta()}',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: widget.isPaused ? Colors.amber : Colors.white54,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),

          const SizedBox(height: 14),

          // Action Controls (Pause/Resume, Cancel)
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              if (widget.onPauseResume != null)
                TextButton.icon(
                  onPressed: widget.onPauseResume,
                  icon: Icon(
                    widget.isPaused ? Icons.play_arrow_rounded : Icons.pause_rounded,
                    size: 16,
                    color: Colors.white70,
                  ),
                  label: Text(
                    widget.isPaused ? 'Resume' : 'Pause',
                    style: const TextStyle(color: Colors.white70, fontSize: 12),
                  ),
                ),
              if (widget.onCancel != null)
                TextButton.icon(
                  onPressed: widget.onCancel,
                  icon: const Icon(Icons.close_rounded, size: 16, color: Color(0xFFF87171)),
                  label: const Text(
                    'Cancel',
                    style: TextStyle(color: Color(0xFFF87171), fontSize: 12),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _AuraStreamPainter extends CustomPainter {
  final double animValue;
  final double speedMbps;
  final double progress;
  final Color accentColor;
  final bool isSending;
  final bool isPaused;

  _AuraStreamPainter({
    required this.animValue,
    required this.speedMbps,
    required this.progress,
    required this.accentColor,
    required this.isSending,
    required this.isPaused,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final ringRadius = 48.0;

    // 1. Background Arc Track
    final trackPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 6.0
      ..strokeCap = StrokeCap.round
      ..color = Colors.white.withValues(alpha: 0.08);
    canvas.drawCircle(center, ringRadius, trackPaint);

    // 2. Verified Progress Arc
    final sweepAngle = 2 * math.pi * progress;
    final progressPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 6.0
      ..strokeCap = StrokeCap.round
      ..shader = SweepGradient(
        startAngle: -math.pi / 2,
        endAngle: (3 * math.pi) / 2,
        colors: [
          accentColor.withValues(alpha: 0.5),
          accentColor,
          Colors.white,
        ],
        stops: const [0.0, 0.85, 1.0],
        transform: const GradientRotation(-math.pi / 2),
      ).createShader(Rect.fromCircle(center: center, radius: ringRadius));

    canvas.drawArc(
      Rect.fromCircle(center: center, radius: ringRadius),
      -math.pi / 2,
      sweepAngle,
      false,
      progressPaint,
    );

    if (isPaused) return;

    // 3. Flowing particles along the stream (speed responsive)
    // Speed factor: normalizes 0-100 MB/s to particle velocity and density
    final velocityMultiplier = (speedMbps / 15.0).clamp(0.5, 4.0);
    final particleCount = (speedMbps * 0.4).clamp(6, 32).toInt();
    final particlePaint = Paint()..style = PaintingStyle.fill;

    for (int i = 0; i < particleCount; i++) {
      final baseOffset = (i / particleCount);
      final phase = (baseOffset + (animValue * velocityMultiplier)) % 1.0;
      final angle = (phase * sweepAngle) - (math.pi / 2);

      final r = ringRadius + math.sin(phase * 12 + i) * 3.5;
      final px = center.dx + math.cos(angle) * r;
      final py = center.dy + math.sin(angle) * r;

      final alpha = math.sin(phase * math.pi).clamp(0.0, 1.0);
      particlePaint.color = (i % 3 == 0 ? Colors.white : accentColor)
          .withValues(alpha: alpha * 0.85);

      final pSize = 1.6 + (speedMbps > 40 ? 1.0 : 0.0);
      canvas.drawCircle(Offset(px, py), pSize, particlePaint);
    }
  }

  @override
  bool shouldRepaint(covariant _AuraStreamPainter oldDelegate) {
    return oldDelegate.animValue != animValue ||
        oldDelegate.progress != progress ||
        oldDelegate.speedMbps != speedMbps ||
        oldDelegate.isPaused != isPaused;
  }
}
