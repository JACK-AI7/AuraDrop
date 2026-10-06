import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/models.dart';
import '../theme/aura_theme.dart';

class HeroGlobe extends StatefulWidget {
  final Map<String, PeerDevice> peers;
  final String? selectedPeerId;
  final ValueChanged<PeerDevice>? onPeerSelected;
  final bool isTransferring;
  final double size;

  const HeroGlobe({
    super.key,
    required this.peers,
    this.selectedPeerId,
    this.onPeerSelected,
    this.isTransferring = false,
    this.size = 280,
  });

  @override
  State<HeroGlobe> createState() => _HeroGlobeState();
}

class _HeroGlobeState extends State<HeroGlobe> with SingleTickerProviderStateMixin {
  late final AnimationController _rotationController;
  double _yaw = 0.0;
  double _pitch = -0.25;
  bool _isInteracting = false;
  final Map<String, Offset> _visiblePeerScreenPositions = {};

  // Precomputed Fibonacci sphere dot coordinates (x, y, z)
  static final List<_Vec3> _spherePoints = _generateSpherePoints(380);

  static List<_Vec3> _generateSpherePoints(int count) {
    final list = <_Vec3>[];
    const phi = 2.399963229728653; // golden angle: pi * (3 - sqrt(5))
    for (int i = 0; i < count; i++) {
      final y = 1.0 - (i / (count - 1)) * 2.0;
      final radiusAtY = math.sqrt(math.max(0.0, 1.0 - y * y));
      final theta = phi * i;
      final x = math.cos(theta) * radiusAtY;
      final z = math.sin(theta) * radiusAtY;
      list.add(_Vec3(x, y, z));
    }
    return list;
  }

  @override
  void initState() {
    super.initState();
    _rotationController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 40),
    )..addListener(_onTick);
    _rotationController.repeat();
  }

  void _onTick() {
    if (!_isInteracting) {
      setState(() {
        _yaw += 0.0035;
        if (_yaw > 2 * math.pi) _yaw -= 2 * math.pi;
      });
    }
  }

  @override
  void dispose() {
    _rotationController.removeListener(_onTick);
    _rotationController.dispose();
    super.dispose();
  }

  void _handlePanStart(DragStartDetails details) {
    _isInteracting = true;
  }

  void _handlePanUpdate(DragUpdateDetails details) {
    setState(() {
      _yaw += details.delta.dx * 0.008;
      _pitch = (_pitch + details.delta.dy * 0.008).clamp(-0.8, 0.8);
    });
  }

  void _handlePanEnd(DragEndDetails details) {
    _isInteracting = false;
  }

  void _handleTapUp(TapUpDetails details) {
    final localPos = details.localPosition;
    String? hitPeerId;
    double closestDist = 32.0;

    _visiblePeerScreenPositions.forEach((peerId, pos) {
      final dist = (pos - localPos).distance;
      if (dist < closestDist) {
        closestDist = dist;
        hitPeerId = peerId;
      }
    });

    if (hitPeerId != null && widget.onPeerSelected != null) {
      final peer = widget.peers[hitPeerId];
      if (peer != null) {
        HapticFeedback.selectionClick();
        widget.onPeerSelected!(peer);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = AuraTheme.of(context);

    return RepaintBoundary(
      child: GestureDetector(
        onPanStart: _handlePanStart,
        onPanUpdate: _handlePanUpdate,
        onPanEnd: _handlePanEnd,
        onTapUp: _handleTapUp,
        child: SizedBox(
          width: widget.size,
          height: widget.size,
          child: CustomPaint(
            size: Size(widget.size, widget.size),
            painter: _GlobePainter(
              yaw: _yaw,
              pitch: _pitch,
              peers: widget.peers,
              selectedPeerId: widget.selectedPeerId,
              isTransferring: widget.isTransferring,
              theme: theme,
              onPeerPositionsComputed: (positions) {
                _visiblePeerScreenPositions
                  ..clear()
                  ..addAll(positions);
              },
            ),
          ),
        ),
      ),
    );
  }
}

class _Vec3 {
  final double x, y, z;
  const _Vec3(this.x, this.y, this.z);

  _Vec3 rotateY(double angle) {
    final cosA = math.cos(angle);
    final sinA = math.sin(angle);
    return _Vec3(x * cosA + z * sinA, y, -x * sinA + z * cosA);
  }

  _Vec3 rotateX(double angle) {
    final cosA = math.cos(angle);
    final sinA = math.sin(angle);
    return _Vec3(x, y * cosA - z * sinA, y * sinA + z * cosA);
  }

  double length() => math.sqrt(x * x + y * y + z * z);

  _Vec3 normalized() {
    final len = length();
    if (len == 0) return const _Vec3(0, 0, 1);
    return _Vec3(x / len, y / len, z / len);
  }
}

class _GlobePainter extends CustomPainter {
  final double yaw;
  final double pitch;
  final Map<String, PeerDevice> peers;
  final String? selectedPeerId;
  final bool isTransferring;
  final AuraTheme theme;
  final ValueChanged<Map<String, Offset>> onPeerPositionsComputed;

  _GlobePainter({
    required this.yaw,
    required this.pitch,
    required this.peers,
    required this.selectedPeerId,
    required this.isTransferring,
    required this.theme,
    required this.onPeerPositionsComputed,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width * 0.42;

    // 1. Subtle outline sphere ring
    final outlinePaint = Paint()
      ..color = theme.isDark
          ? const Color(0xFF222222)
          : const Color(0xFFE5E5E5)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;
    canvas.drawCircle(center, radius, outlinePaint);

    // 2. Subtle latitude / meridian rings for 3D depth
    final meridianPaint = Paint()
      ..color = theme.isDark
          ? const Color(0xFF141414)
          : const Color(0xFFF0F0F0)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.8;
    canvas.drawOval(
      Rect.fromCenter(center: center, width: radius * 2, height: radius * 0.7),
      meridianPaint,
    );
    canvas.drawOval(
      Rect.fromCenter(center: center, width: radius * 0.7, height: radius * 2),
      meridianPaint,
    );

    // 3. Render Sphere Dot Matrix
    final frontDotPaint = Paint()
      ..color = theme.isDark
          ? const Color(0xFFCCCCCC)
          : const Color(0xFF333333)
      ..style = PaintingStyle.fill;

    final backDotPaint = Paint()
      ..color = theme.isDark
          ? const Color(0xFF202020)
          : const Color(0xFFECECEC)
      ..style = PaintingStyle.fill;

    for (final pt in _HeroGlobeState._spherePoints) {
      final rot = pt.rotateY(yaw).rotateX(pitch);
      final screenX = center.dx + rot.x * radius;
      final screenY = center.dy + rot.y * radius;

      if (rot.z > 0) {
        // Front hemisphere: dynamic size and opacity based on z depth
        final dotRadius = 1.0 + rot.z * 1.3;
        canvas.drawCircle(Offset(screenX, screenY), dotRadius, frontDotPaint);
      } else {
        // Back hemisphere: faint background dots
        canvas.drawCircle(Offset(screenX, screenY), 0.9, backDotPaint);
      }
    }

    // 4. Fixed User Location Marker (Reference Point on Globe)
    const userLat = 0.28;
    const userLon = 0.0;
    final userSpherical = _latLonToVec3(userLat, userLon);
    final userRot = userSpherical.rotateY(yaw).rotateX(pitch);
    final userPos = Offset(center.dx + userRot.x * radius, center.dy + userRot.y * radius);

    final isUserFront = userRot.z > -0.2;
    if (isUserFront) {
      // User anchor ring
      final userRingPaint = Paint()
        ..color = theme.isDark ? Colors.white : Colors.black
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2;
      canvas.drawCircle(userPos, 6.0, userRingPaint);

      // User center solid point
      final userDotPaint = Paint()
        ..color = theme.isDark ? Colors.white : Colors.black
        ..style = PaintingStyle.fill;
      canvas.drawCircle(userPos, 3.0, userDotPaint);

      // Minimal "YOU" label
      final textPainter = TextPainter(
        text: TextSpan(
          text: 'YOU',
          style: TextStyle(
            fontSize: 9,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.8,
            color: theme.isDark ? Colors.white70 : Colors.black87,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      textPainter.paint(canvas, Offset(userPos.dx - textPainter.width / 2, userPos.dy + 8));
    }

    // 5. Render Discovered Peer Markers
    final peerPositions = <String, Offset>{};
    final peerList = peers.values.toList();

    for (int i = 0; i < peerList.length; i++) {
      final peer = peerList[i];
      // Deterministically space peers across the globe using index & id hash
      final angleStep = (2 * math.pi) / math.max(1, peerList.length);
      final lat = ((peer.id.hashCode % 50) / 100.0) - 0.2;
      final lon = (i * angleStep) + 0.6;

      final peerVec = _latLonToVec3(lat, lon);
      final peerRot = peerVec.rotateY(yaw).rotateX(pitch);
      final peerPos = Offset(center.dx + peerRot.x * radius, center.dy + peerRot.y * radius);

      final isPeerFront = peerRot.z > -0.15;
      if (isPeerFront) {
        peerPositions[peer.id] = peerPos;
        final isSelected = selectedPeerId == peer.id;

        // If selected: render orbital ring around marker (Circles concept)
        if (isSelected) {
          final ringPaint = Paint()
            ..color = theme.isDark ? Colors.white : Colors.black
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.2;
          canvas.drawCircle(peerPos, 10.0, ringPaint);
        }

        // Peer Dot Marker
        final peerMarkerPaint = Paint()
          ..color = isSelected
              ? (theme.isDark ? Colors.white : Colors.black)
              : (theme.isDark ? const Color(0xFF888888) : const Color(0xFF555555))
          ..style = PaintingStyle.fill;
        canvas.drawCircle(peerPos, isSelected ? 4.5 : 3.5, peerMarkerPaint);

        // Peer Name Label
        final peerLabelPainter = TextPainter(
          text: TextSpan(
            text: peer.name,
            style: TextStyle(
              fontSize: 10,
              fontWeight: isSelected ? FontWeight.w800 : FontWeight.w600,
              color: isSelected
                  ? (theme.isDark ? Colors.white : Colors.black)
                  : theme.textSecondary,
            ),
          ),
          textDirection: TextDirection.ltr,
          maxLines: 1,
          ellipsis: '...',
        )..layout(maxWidth: 80);
        peerLabelPainter.paint(
          canvas,
          Offset(peerPos.dx - peerLabelPainter.width / 2, peerPos.dy + (isSelected ? 13 : 8)),
        );

        // 6. Connection Arc between User and Selected Peer
        if (isSelected && isUserFront) {
          _drawConnectionArc(canvas, userSpherical, peerVec, center, radius, isTransferring);
        }
      }
    }

    onPeerPositionsComputed(peerPositions);
  }

  void _drawConnectionArc(
    Canvas canvas,
    _Vec3 p1,
    _Vec3 p2,
    Offset center,
    double radius,
    bool isTransferActive,
  ) {
    const int segments = 24;
    final path = Path();
    bool first = true;

    for (int s = 0; s <= segments; s++) {
      final t = s / segments.toDouble();
      // Spherical interpolation with parabolic radial lift above surface
      final interp = _slerp(p1, p2, t);
      final lift = 1.0 + 0.22 * math.sin(math.pi * t);
      final lifted = _Vec3(interp.x * lift, interp.y * lift, interp.z * lift);
      final rot = lifted.rotateY(yaw).rotateX(pitch);

      final screenPos = Offset(center.dx + rot.x * radius, center.dy + rot.y * radius);
      if (first) {
        path.moveTo(screenPos.dx, screenPos.dy);
        first = false;
      } else {
        path.lineTo(screenPos.dx, screenPos.dy);
      }
    }

    final arcPaint = Paint()
      ..color = theme.isDark ? Colors.white : Colors.black
      ..style = PaintingStyle.stroke
      ..strokeWidth = isTransferActive ? 2.0 : 1.2
      ..strokeCap = StrokeCap.round;

    canvas.drawPath(path, arcPaint);
  }

  static _Vec3 _latLonToVec3(double lat, double lon) {
    final cosLat = math.cos(lat);
    final sinLat = math.sin(lat);
    final cosLon = math.cos(lon);
    final sinLon = math.sin(lon);
    return _Vec3(cosLat * sinLon, -sinLat, cosLat * cosLon);
  }

  static _Vec3 _slerp(_Vec3 p1, _Vec3 p2, double t) {
    final dot = (p1.x * p2.x + p1.y * p2.y + p1.z * p2.z).clamp(-1.0, 1.0);
    final theta = math.acos(dot);
    if (theta.abs() < 1e-5) return p1;
    final sinTheta = math.sin(theta);
    final w1 = math.sin((1.0 - t) * theta) / sinTheta;
    final w2 = math.sin(t * theta) / sinTheta;
    return _Vec3(
      p1.x * w1 + p2.x * w2,
      p1.y * w1 + p2.y * w2,
      p1.z * w1 + p2.z * w2,
    ).normalized();
  }

  @override
  bool shouldRepaint(covariant _GlobePainter oldDelegate) {
    return oldDelegate.yaw != yaw ||
        oldDelegate.pitch != pitch ||
        oldDelegate.selectedPeerId != selectedPeerId ||
        oldDelegate.isTransferring != isTransferring ||
        oldDelegate.peers.length != peers.length ||
        oldDelegate.theme.isDark != theme.isDark;
  }
}
