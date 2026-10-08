import 'dart:math' as math;
import 'package:flutter/material.dart';

class AuraRippleEvent {
  final Offset origin;
  final Color color;
  final double intensity;
  final Duration duration;
  final DateTime startTime;

  AuraRippleEvent({
    required this.origin,
    required this.color,
    this.intensity = 1.0,
    this.duration = const Duration(milliseconds: 1400),
  }) : startTime = DateTime.now();

  double get progress {
    final elapsed = DateTime.now().difference(startTime).inMilliseconds;
    return (elapsed / duration.inMilliseconds).clamp(0.0, 1.0);
  }

  bool get isFinished => progress >= 1.0;
}

class AuraRippleController extends ChangeNotifier {
  final List<AuraRippleEvent> _activeRipples = [];

  List<AuraRippleEvent> get ripples => List.unmodifiable(_activeRipples);

  void trigger({
    required Offset origin,
    Color color = const Color(0xFF6366F1),
    double intensity = 1.0,
    Duration duration = const Duration(milliseconds: 1200),
  }) {
    _activeRipples.add(AuraRippleEvent(
      origin: origin,
      color: color,
      intensity: intensity,
      duration: duration,
    ));
    notifyListeners();
  }

  void _prune() {
    final before = _activeRipples.length;
    _activeRipples.removeWhere((r) => r.isFinished);
    if (_activeRipples.length != before) {
      notifyListeners();
    }
  }
}

class AuraRippleField extends StatefulWidget {
  final AuraRippleController controller;
  final Widget? child;
  final bool enableWarp;

  const AuraRippleField({
    super.key,
    required this.controller,
    this.child,
    this.enableWarp = true,
  });

  @override
  State<AuraRippleField> createState() => _AuraRippleFieldState();
}

class _AuraRippleFieldState extends State<AuraRippleField> with SingleTickerProviderStateMixin {
  late final AnimationController _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = AnimationController(vsync: this, duration: const Duration(seconds: 1));
    if (widget.controller.ripples.isNotEmpty) {
      _ticker.repeat();
    }
    widget.controller.addListener(_onControllerUpdate);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onControllerUpdate);
    _ticker.dispose();
    super.dispose();
  }

  void _onControllerUpdate() {
    if (mounted) {
      setState(() {});
      if (widget.controller.ripples.isEmpty) {
        _ticker.stop();
      } else if (!_ticker.isAnimating) {
        _ticker.repeat();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    widget.controller._prune();

    return RepaintBoundary(
      child: CustomPaint(
        foregroundPainter: widget.controller.ripples.isEmpty
            ? null
            : _AuraRipplePainter(
                ripples: widget.controller.ripples,
                enableWarp: widget.enableWarp,
              ),
        child: widget.child,
      ),
    );
  }
}

class _AuraRipplePainter extends CustomPainter {
  final List<AuraRippleEvent> ripples;
  final bool enableWarp;

  _AuraRipplePainter({
    required this.ripples,
    required this.enableWarp,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (ripples.isEmpty) return;

    final maxDim = math.sqrt(size.width * size.width + size.height * size.height);

    for (final ripple in ripples) {
      final p = ripple.progress;
      if (p >= 1.0) continue;

      // Cubic out easing for natural fluid shockwave expansion
      final easeOut = 1.0 - math.pow(1.0 - p, 3.0);
      final radius = easeOut * (maxDim * 0.95);
      final alpha = (1.0 - p) * 0.45 * ripple.intensity;

      // 1. Primary Refraction Wave Ring
      final strokePaint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = (1.0 - p) * 18.0 + 1.5
        ..shader = RadialGradient(
          center: Alignment(
            (ripple.origin.dx / size.width) * 2 - 1,
            (ripple.origin.dy / size.height) * 2 - 1,
          ),
          radius: (radius + 20) / size.width,
          colors: [
            ripple.color.withValues(alpha: alpha * 0.9),
            ripple.color.withValues(alpha: alpha * 0.3),
            Colors.white.withValues(alpha: alpha * 0.7),
            Colors.transparent,
          ],
          stops: const [0.85, 0.92, 0.96, 1.0],
        ).createShader(Rect.fromCircle(center: ripple.origin, radius: radius + 20));

      canvas.drawCircle(ripple.origin, radius, strokePaint);

      // 2. Secondary Compression Ring
      if (p > 0.1 && p < 0.85) {
        final innerRadius = radius * 0.72;
        final innerAlpha = alpha * 0.5;
        final innerPaint = Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2.0
          ..color = Colors.white.withValues(alpha: innerAlpha);
        canvas.drawCircle(ripple.origin, innerRadius, innerPaint);
      }

      // 3. Subtle Chromatic Particles
      if (enableWarp && p < 0.7) {
        final particleCount = 12;
        final particlePaint = Paint()..style = PaintingStyle.fill;
        for (int i = 0; i < particleCount; i++) {
          final angle = (i * (2 * math.pi / particleCount)) + (p * 0.5);
          final pDist = radius * 0.88 + (math.sin(i + p * 10) * 12);
          final px = ripple.origin.dx + math.cos(angle) * pDist;
          final py = ripple.origin.dy + math.sin(angle) * pDist;
          if (px >= 0 && px <= size.width && py >= 0 && py <= size.height) {
            particlePaint.color = (i % 2 == 0 ? ripple.color : Colors.white)
                .withValues(alpha: (1.0 - p) * 0.5);
            canvas.drawCircle(Offset(px, py), (1.0 - p) * 2.8 + 0.8, particlePaint);
          }
        }
      }
    }
  }

  @override
  bool shouldRepaint(covariant _AuraRipplePainter oldDelegate) => true;
}
