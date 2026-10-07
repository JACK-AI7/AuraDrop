import 'dart:math' as math;
import 'package:flutter/material.dart';

enum RippleTriggerType {
  peerDiscovered,
  peerSelected,
  connectionEstablished,
  transferStart,
  realTransferMilestone,
  transferComplete,
  transferFailed,
  chatReceived,
}

class FourSidedRipplePulse {
  final RippleTriggerType type;
  final double intensity;
  final Duration duration;
  final DateTime startTime;
  final Offset? origin;

  FourSidedRipplePulse({
    required this.type,
    this.intensity = 1.0,
    this.duration = const Duration(milliseconds: 1200),
    this.origin,
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
    Duration duration = const Duration(milliseconds: 1200),
    Offset? origin,
  }) {
    _pulses.add(FourSidedRipplePulse(
      type: type,
      intensity: intensity,
      duration: duration,
      origin: origin,
    ));
    notifyListeners();
  }

  void triggerPeerDiscovered({Offset? origin}) {
    trigger(
      type: RippleTriggerType.peerDiscovered,
      intensity: 0.6,
      duration: const Duration(milliseconds: 1000),
      origin: origin,
    );
  }

  void triggerPeerSelected({Offset? origin}) {
    trigger(
      type: RippleTriggerType.peerSelected,
      intensity: 0.8,
      duration: const Duration(milliseconds: 1100),
      origin: origin,
    );
  }

  void triggerConnectionEstablished({Offset? origin}) {
    trigger(
      type: RippleTriggerType.connectionEstablished,
      intensity: 0.9,
      duration: const Duration(milliseconds: 1250),
      origin: origin,
    );
  }

  void triggerTransferStart({Offset? origin}) {
    trigger(
      type: RippleTriggerType.transferStart,
      intensity: 1.0,
      duration: const Duration(milliseconds: 1300),
      origin: origin,
    );
  }

  void triggerRealTransferMilestone({Offset? origin}) {
    trigger(
      type: RippleTriggerType.realTransferMilestone,
      intensity: 0.7,
      duration: const Duration(milliseconds: 900),
      origin: origin,
    );
  }

  void triggerTransferComplete({Offset? origin}) {
    trigger(
      type: RippleTriggerType.transferComplete,
      intensity: 1.0,
      duration: const Duration(milliseconds: 1400),
      origin: origin,
    );
  }

  void triggerTransferFailed({Offset? origin}) {
    trigger(
      type: RippleTriggerType.transferFailed,
      intensity: 0.85,
      duration: const Duration(milliseconds: 1100),
      origin: origin,
    );
  }

  void triggerChatReceived({Offset? origin}) {
    trigger(
      type: RippleTriggerType.chatReceived,
      intensity: 0.65,
      duration: const Duration(milliseconds: 950),
      origin: origin,
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
    );
    if (widget.controller.pulses.isNotEmpty) {
      _ticker.repeat();
    }
    widget.controller.addListener(_onControllerChange);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onControllerChange);
    _ticker.dispose();
    super.dispose();
  }

  void _onControllerChange() {
    if (mounted) {
      setState(() {});
      if (widget.controller.pulses.isEmpty) {
        _ticker.stop();
      } else if (!_ticker.isAnimating) {
        _ticker.repeat();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    widget.controller.prune();
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return RepaintBoundary(
      child: CustomPaint(
        foregroundPainter: widget.controller.pulses.isEmpty
            ? null
            : _AuraShockwavePainter(
                pulses: widget.controller.pulses,
                isDark: isDark,
              ),
        child: widget.child,
      ),
    );
  }
}

class _AuraShockwavePainter extends CustomPainter {
  final List<FourSidedRipplePulse> pulses;
  final bool isDark;

  _AuraShockwavePainter({
    required this.pulses,
    required this.isDark,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (pulses.isEmpty || size.width <= 0 || size.height <= 0) return;

    final defaultCenter = Offset(size.width * 0.5, size.height * 0.46);
    final maxDistance = math.max(size.width, size.height) * 0.7;
    final Color baseColor = isDark ? Colors.white : Colors.black;

    for (final pulse in pulses) {
      final p = pulse.progress;
      if (p >= 1.0) continue;

      final center = pulse.origin ?? defaultCenter;
      final curve = Curves.easeOutCubic.transform(p);
      final radius = curve * maxDistance;

      // Alpha decays smoothly as the shockwave expands
      final alpha = (1.0 - p) * pulse.intensity;
      final strokeAlpha = (alpha * 0.55).clamp(0.0, 1.0);
      final glowAlpha = (alpha * 0.12).clamp(0.0, 1.0);

      // 1. Soft expanding aura glow behind the shockwave
      if (p < 0.7) {
        final glowRadius = radius * 0.6;
        final glowPaint = Paint()
          ..color = baseColor.withValues(alpha: glowAlpha * (1.0 - p / 0.7))
          ..style = PaintingStyle.fill
          ..isAntiAlias = true;
        canvas.drawCircle(center, glowRadius, glowPaint);
      }

      // 2. Primary sharp shockwave ring (expanding outward from event center)
      final primaryStroke = Paint()
        ..color = baseColor.withValues(alpha: strokeAlpha)
        ..style = PaintingStyle.stroke
        ..strokeWidth = (2.2 * (1.0 - p * 0.65)).clamp(0.5, 2.5)
        ..isAntiAlias = true;
      canvas.drawCircle(center, radius, primaryStroke);

      // 3. Secondary trailing echo shockwave
      if (p > 0.12) {
        final echoP = ((p - 0.12) / 0.88).clamp(0.0, 1.0);
        final echoCurve = Curves.easeOutCubic.transform(echoP);
        final echoRadius = echoCurve * maxDistance * 0.82;
        final echoAlpha = (alpha * 0.32).clamp(0.0, 1.0);

        final echoStroke = Paint()
          ..color = baseColor.withValues(alpha: echoAlpha)
          ..style = PaintingStyle.stroke
          ..strokeWidth = (1.4 * (1.0 - echoP * 0.5)).clamp(0.4, 1.5)
          ..isAntiAlias = true;
        canvas.drawCircle(center, echoRadius, echoStroke);
      }

      // 4. Tertiary faint outer shockwave ripple for dramatic impact (milestones/transfer)
      if (pulse.intensity >= 0.8 && p > 0.22) {
        final tertP = ((p - 0.22) / 0.78).clamp(0.0, 1.0);
        final tertCurve = Curves.easeOutQuad.transform(tertP);
        final tertRadius = tertCurve * maxDistance * 0.62;
        final tertAlpha = (alpha * 0.18).clamp(0.0, 1.0);

        final tertStroke = Paint()
          ..color = baseColor.withValues(alpha: tertAlpha)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.0
          ..isAntiAlias = true;
        canvas.drawCircle(center, tertRadius, tertStroke);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _AuraShockwavePainter oldDelegate) => true;
}
