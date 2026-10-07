import 'dart:math' as math;
import 'package:flutter/material.dart';

enum RippleTriggerType {
  peerDiscovered,
  peerSelected,
  connectionEstablished,
  transferStart,
  transferComplete,
}

class FourSidedRipplePulse {
  final RippleTriggerType type;
  final double intensity;
  final Duration duration;
  final DateTime startTime;

  FourSidedRipplePulse({
    required this.type,
    this.intensity = 1.0,
    this.duration = const Duration(milliseconds: 1400),
  }) : startTime = DateTime.now();

  double get progress {
    final elapsed = DateTime.now().difference(startTime).inMilliseconds;
    return (elapsed / duration.inMilliseconds).clamp(0.0, 1.0);
  }

  bool get isFinished => progress >= 1.0;
}

class AuraProximityRippleController extends ChangeNotifier {
  final List<FourSidedRipplePulse> _pulses = [];

  List<FourSidedRipplePulse> get pulses => List.unmodifiable(_pulses);

  void trigger({
    RippleTriggerType type = RippleTriggerType.peerDiscovered,
    double intensity = 1.0,
    Duration duration = const Duration(milliseconds: 1400),
  }) {
    _pulses.add(FourSidedRipplePulse(
      type: type,
      intensity: intensity,
      duration: duration,
    ));
    notifyListeners();
  }

  void triggerPeerDiscovered() {
    trigger(
      type: RippleTriggerType.peerDiscovered,
      intensity: 0.55,
      duration: const Duration(milliseconds: 1100),
    );
  }

  void triggerPeerSelected() {
    trigger(
      type: RippleTriggerType.peerSelected,
      intensity: 0.75,
      duration: const Duration(milliseconds: 1250),
    );
  }

  void triggerConnectionEstablished() {
    trigger(
      type: RippleTriggerType.connectionEstablished,
      intensity: 0.9,
      duration: const Duration(milliseconds: 1500),
    );
  }

  void triggerTransferStart() {
    trigger(
      type: RippleTriggerType.transferStart,
      intensity: 0.95,
      duration: const Duration(milliseconds: 1600),
    );
  }

  void triggerTransferComplete() {
    trigger(
      type: RippleTriggerType.transferComplete,
      intensity: 1.0,
      duration: const Duration(milliseconds: 1800),
    );
  }

  void prune() {
    final before = _pulses.length;
    _pulses.removeWhere((p) => p.isFinished);
    if (_pulses.length != before) {
      notifyListeners();
    }
  }
}

class AuraProximityRipple extends StatefulWidget {
  final AuraProximityRippleController controller;
  final Widget? child;

  const AuraProximityRipple({
    super.key,
    required this.controller,
    this.child,
  });

  @override
  State<AuraProximityRipple> createState() => _AuraProximityRippleState();
}

class _AuraProximityRippleState extends State<AuraProximityRipple>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 1),
    )..repeat();
    widget.controller.addListener(_onControllerChange);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onControllerChange);
    _ticker.dispose();
    super.dispose();
  }

  void _onControllerChange() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    widget.controller.prune();
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return RepaintBoundary(
      child: CustomPaint(
        foregroundPainter: widget.controller.pulses.isEmpty
            ? null
            : _FourSidedRipplePainter(
                pulses: widget.controller.pulses,
                isDark: isDark,
              ),
        child: widget.child,
      ),
    );
  }
}

class _FourSidedRipplePainter extends CustomPainter {
  final List<FourSidedRipplePulse> pulses;
  final bool isDark;

  _FourSidedRipplePainter({
    required this.pulses,
    required this.isDark,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (pulses.isEmpty || size.width <= 0 || size.height <= 0) return;

    final corners = [
      Offset.zero, // Top-Left
      Offset(size.width, 0), // Top-Right
      Offset(0, size.height), // Bottom-Left
      Offset(size.width, size.height), // Bottom-Right
    ];

    // Diagonal reach to center
    final maxDistance = math.sqrt(
      (size.width / 2) * (size.width / 2) +
          (size.height / 2) * (size.height / 2),
    ) * 1.5;

    for (final pulse in pulses) {
      final p = pulse.progress;
      if (p >= 1.0) continue;

      // Smooth deceleration curve
      final curve = Curves.easeOutCubic.transform(p);
      final radius = curve * maxDistance;

      // Fade out as it reaches the center
      final alpha = (1.0 - p) * pulse.intensity;
      final strokeAlpha = (alpha * 0.45).clamp(0.0, 1.0);
      final fillAlpha = (alpha * 0.08).clamp(0.0, 1.0);

      final Color baseColor = isDark ? Colors.white : Colors.black;

      final paintStroke = Paint()
        ..color = baseColor.withValues(alpha: strokeAlpha)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5 * (1.0 - p * 0.5)
        ..isAntiAlias = true;

      final paintFill = Paint()
        ..color = baseColor.withValues(alpha: fillAlpha)
        ..style = PaintingStyle.fill
        ..isAntiAlias = true;

      // Draw inward concentric arcs from each of the 4 corners
      for (final corner in corners) {
        canvas.drawCircle(corner, radius, paintFill);
        canvas.drawCircle(corner, radius, paintStroke);

        // Secondary subtle trailing echo wave
        if (p > 0.15) {
          final echoCurve = Curves.easeOutCubic.transform(
            ((p - 0.15) / 0.85).clamp(0.0, 1.0),
          );
          final echoRadius = echoCurve * maxDistance * 0.75;
          final echoAlpha = (alpha * 0.2).clamp(0.0, 1.0);

          final echoStroke = Paint()
            ..color = baseColor.withValues(alpha: echoAlpha)
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.0
            ..isAntiAlias = true;

          canvas.drawCircle(corner, echoRadius, echoStroke);
        }
      }
    }
  }

  @override
  bool shouldRepaint(covariant _FourSidedRipplePainter oldDelegate) => true;
}
