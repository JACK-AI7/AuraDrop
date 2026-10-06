import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../models/models.dart';

class AuraBackground extends StatefulWidget {
  final AnimationQuality quality;
  final Color accentColor;
  final Widget? child;

  const AuraBackground({
    super.key,
    required this.quality,
    required this.accentColor,
    this.child,
  });

  @override
  State<AuraBackground> createState() => _AuraBackgroundState();
}

class _AuraBackgroundState extends State<AuraBackground> with SingleTickerProviderStateMixin {
  late final AnimationController _bgAnim;

  @override
  void initState() {
    super.initState();
    _bgAnim = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 12),
    );
    if (widget.quality != AnimationQuality.minimal) {
      _bgAnim.repeat();
    }
  }

  @override
  void didUpdateWidget(covariant AuraBackground oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.quality == AnimationQuality.minimal && _bgAnim.isAnimating) {
      _bgAnim.stop();
    } else if (widget.quality != AnimationQuality.minimal && !_bgAnim.isAnimating) {
      _bgAnim.repeat();
    }
  }

  @override
  void dispose() {
    _bgAnim.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.quality == AnimationQuality.minimal) {
      // Performance tier: Clean static gradient
      return Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              const Color(0xFF0B0F19),
              const Color(0xFF111827),
              widget.accentColor.withValues(alpha: 0.08),
            ],
          ),
        ),
        child: widget.child,
      );
    }

    return RepaintBoundary(
      child: AnimatedBuilder(
        animation: _bgAnim,
        builder: (context, child) {
          return CustomPaint(
            painter: _AuraBackgroundPainter(
              animValue: _bgAnim.value,
              quality: widget.quality,
              accentColor: widget.accentColor,
            ),
            child: widget.child,
          );
        },
      ),
    );
  }
}

class _AuraBackgroundPainter extends CustomPainter {
  final double animValue;
  final AnimationQuality quality;
  final Color accentColor;

  _AuraBackgroundPainter({
    required this.animValue,
    required this.quality,
    required this.accentColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    // 1. Base dark background
    final basePaint = Paint()..color = const Color(0xFF090D16);
    canvas.drawRect(Offset.zero & size, basePaint);

    // 2. Flowing Aurora Blob 1 (Top-Left / Center)
    final phase1 = animValue * 2 * math.pi;
    final cx1 = size.width * (0.35 + 0.15 * math.sin(phase1));
    final cy1 = size.height * (0.28 + 0.12 * math.cos(phase1));
    final r1 = size.width * (quality == AnimationQuality.immersive ? 0.75 : 0.60);

    final auraPaint1 = Paint()
      ..shader = RadialGradient(
        center: Alignment(
          (cx1 / size.width) * 2 - 1,
          (cy1 / size.height) * 2 - 1,
        ),
        radius: r1 / size.width,
        colors: [
          accentColor.withValues(alpha: quality == AnimationQuality.immersive ? 0.22 : 0.14),
          accentColor.withValues(alpha: 0.06),
          Colors.transparent,
        ],
        stops: const [0.0, 0.55, 1.0],
      ).createShader(Rect.fromCircle(center: Offset(cx1, cy1), radius: r1));

    canvas.drawCircle(Offset(cx1, cy1), r1, auraPaint1);

    // 3. Flowing Aurora Blob 2 (Bottom-Right)
    final cx2 = size.width * (0.70 + 0.15 * math.cos(phase1 * 0.8));
    final cy2 = size.height * (0.75 + 0.10 * math.sin(phase1 * 0.8));
    final r2 = size.width * 0.65;

    final auraPaint2 = Paint()
      ..shader = RadialGradient(
        center: Alignment(
          (cx2 / size.width) * 2 - 1,
          (cy2 / size.height) * 2 - 1,
        ),
        radius: r2 / size.width,
        colors: [
          const Color(0xFF3B82F6).withValues(alpha: quality == AnimationQuality.immersive ? 0.18 : 0.10),
          Colors.transparent,
        ],
        stops: const [0.0, 1.0],
      ).createShader(Rect.fromCircle(center: Offset(cx2, cy2), radius: r2));

    canvas.drawCircle(Offset(cx2, cy2), r2, auraPaint2);

    // 4. Immersive tier: Silk Waves & Ambient Dust Particles
    if (quality == AnimationQuality.immersive) {
      final particlePaint = Paint()..style = PaintingStyle.fill;
      for (int i = 0; i < 18; i++) {
        final pPhase = (animValue + (i / 18)) % 1.0;
        final px = (math.sin(i * 99 + pPhase * 4) * 0.5 + 0.5) * size.width;
        final py = (1.0 - pPhase) * size.height;
        final pAlpha = math.sin(pPhase * math.pi) * 0.25;

        particlePaint.color = Colors.white.withValues(alpha: pAlpha);
        canvas.drawCircle(Offset(px, py), 1.2, particlePaint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _AuraBackgroundPainter oldDelegate) {
    return oldDelegate.animValue != animValue ||
        oldDelegate.quality != quality ||
        oldDelegate.accentColor != accentColor;
  }
}
