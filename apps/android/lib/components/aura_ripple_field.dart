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
    // Intentionally no-op to remove all fake ripple circles and background distortion
  }

  @override
  bool shouldRepaint(covariant _AuraRipplePainter oldDelegate) => true;
}
