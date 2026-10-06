import 'dart:ui';
import 'dart:math' as math;
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/models.dart';

// ---------------------------------------------------------------------------
// GLASS CARD
// ---------------------------------------------------------------------------
class GlassCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry? margin;
  final double borderRadius;
  final double? width;
  final double? height;
  final VoidCallback? onTap;
  final Color? borderColor;
  final Color? backgroundColor;

  const GlassCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.margin,
    this.borderRadius = 20,
    this.width,
    this.height,
    this.onTap,
    this.borderColor,
    this.backgroundColor,
  });

  @override
  Widget build(BuildContext context) {
    Widget content = Container(
      width: width,
      height: height,
      margin: margin,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(borderRadius),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
          child: Container(
            padding: padding,
            decoration: BoxDecoration(
              color: backgroundColor ?? Colors.white.withValues(alpha: 0.04),
              borderRadius: BorderRadius.circular(borderRadius),
              border: Border.all(
                color: borderColor ?? Colors.white.withValues(alpha: 0.10),
                width: 0.7,
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.40),
                  blurRadius: 24,
                  offset: const Offset(0, 10),
                ),
              ],
            ),
            child: child,
          ),
        ),
      ),
    );

    if (onTap != null) {
      return GestureDetector(
        onTap: () {
          HapticFeedback.lightImpact();
          onTap!();
        },
        child: content,
      );
    }
    return content;
  }
}

// ---------------------------------------------------------------------------
// GLASS BUTTON
// ---------------------------------------------------------------------------
class GlassButton extends StatefulWidget {
  final String text;
  final IconData? icon;
  final VoidCallback onPressed;
  final Color accentColor;
  final bool isPrimary;
  final EdgeInsetsGeometry padding;

  const GlassButton({
    super.key,
    required this.text,
    required this.onPressed,
    this.icon,
    this.accentColor = const Color(0xFF38BDF8),
    this.isPrimary = true,
    this.padding = const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
  });

  @override
  State<GlassButton> createState() => _GlassButtonState();
}

class _GlassButtonState extends State<GlassButton> {
  bool _isPressed = false;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: (_) => setState(() => _isPressed = true),
      onTapUp: (_) => setState(() => _isPressed = false),
      onTapCancel: () => setState(() => _isPressed = false),
      onTap: () {
        HapticFeedback.mediumImpact();
        widget.onPressed();
      },
      child: AnimatedScale(
        scale: _isPressed ? 0.96 : 1.0,
        duration: const Duration(milliseconds: 100),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
            child: Container(
              padding: widget.padding,
              decoration: BoxDecoration(
                color: widget.isPrimary
                    ? widget.accentColor.withValues(alpha: 0.85)
                    : Colors.white.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: widget.isPrimary
                      ? widget.accentColor.withValues(alpha: 0.9)
                      : Colors.white.withValues(alpha: 0.2),
                  width: 1.0,
                ),
                boxShadow: widget.isPrimary
                    ? [
                        BoxShadow(
                          color: widget.accentColor.withValues(alpha: 0.35),
                          blurRadius: 16,
                          offset: const Offset(0, 4),
                        )
                      ]
                    : [],
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (widget.icon != null) ...[
                    Icon(
                      widget.icon,
                      size: 18,
                      color: widget.isPrimary ? const Color(0xFF0C0E14) : Colors.white,
                    ),
                    const SizedBox(width: 8),
                  ],
                  Text(
                    widget.text,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: widget.isPrimary ? const Color(0xFF0C0E14) : Colors.white,
                      letterSpacing: 0.2,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// GLASS ICON BUTTON
// ---------------------------------------------------------------------------
class GlassIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onPressed;
  final Color? color;
  final double size;

  const GlassIconButton({
    super.key,
    required this.icon,
    required this.onPressed,
    this.color,
    this.size = 40,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () {
        HapticFeedback.lightImpact();
        onPressed();
      },
      child: ClipRRect(
        borderRadius: BorderRadius.circular(size / 2),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
          child: Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.08),
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white.withValues(alpha: 0.15)),
            ),
            child: Icon(icon, color: color ?? Colors.white, size: size * 0.5),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// CENTER AURA ORB & DISCOVERY RADAR
// ---------------------------------------------------------------------------
class AuraOrb extends StatelessWidget {
  final double pulseFactor;
  final Color accentColor;
  final bool isScanning;
  final VoidCallback? onTap;

  const AuraOrb({
    super.key,
    required this.pulseFactor,
    required this.accentColor,
    this.isScanning = true,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 88,
            height: 88,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: RadialGradient(
                colors: [
                  Colors.white.withValues(alpha: 0.95),
                  Colors.white.withValues(alpha: 0.20),
                  Colors.transparent,
                ],
                stops: const [0.0, 0.55, 1.0],
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.white.withValues(alpha: 0.15 + 0.15 * pulseFactor),
                  blurRadius: 32 + 16 * pulseFactor,
                  spreadRadius: 2,
                ),
              ],
            ),
            child: Center(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(34),
                child: BackdropFilter(
                  filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
                  child: Container(
                    width: 68,
                    height: 68,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: Colors.black.withValues(alpha: 0.35),
                      border: Border.all(
                        color: Colors.white.withValues(alpha: 0.5),
                        width: 1.0,
                      ),
                    ),
                    child: const Icon(
                      Icons.near_me_rounded,
                      color: Colors.white,
                      size: 30,
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: Colors.white.withValues(alpha: 0.12), width: 0.6),
            ),
            child: const Text(
              'AURA BEACON',
              style: TextStyle(
                fontSize: 9,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.5,
                color: Colors.white,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// RADAR PARTICLES & EXPANDING WAVE PAINTER
// ---------------------------------------------------------------------------
class GlassDiscoveryRadarPainter extends CustomPainter {
  final double angle;
  final double pulseFactor;
  final Color accentColor;
  final bool isScanning;

  GlassDiscoveryRadarPainter({
    required this.angle,
    required this.pulseFactor,
    required this.accentColor,
    required this.isScanning,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height * 0.42);
    final maxRadius = math.min(size.width, size.height) * 0.40;

    // Translucent Concentric Rings
    final ringPaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.05)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.7;

    for (int i = 1; i <= 3; i++) {
      canvas.drawCircle(center, maxRadius * (i / 3.0), ringPaint);
    }

    if (isScanning) {
      // Dynamic Glowing Pulse Wave
      final dynamicRadius = maxRadius * (0.35 + 0.60 * pulseFactor);
      final wavePaint = Paint()
        ..color = Colors.white.withValues(alpha: 0.12 * (1.0 - pulseFactor))
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.0;
      canvas.drawCircle(center, dynamicRadius, wavePaint);

      // Rotating Glass Sweep
      final sweepPaint = Paint()
        ..shader = SweepGradient(
          center: Alignment(
            (center.dx / size.width) * 2 - 1,
            (center.dy / size.height) * 2 - 1,
          ),
          startAngle: angle - 0.45,
          endAngle: angle,
          colors: [
            Colors.transparent,
            Colors.white.withValues(alpha: 0.08),
          ],
        ).createShader(Rect.fromCircle(center: center, radius: maxRadius))
        ..style = PaintingStyle.fill;

      canvas.drawCircle(center, maxRadius, sweepPaint);
    }
  }

  @override
  bool shouldRepaint(covariant GlassDiscoveryRadarPainter oldDelegate) {
    return oldDelegate.angle != angle ||
        oldDelegate.pulseFactor != pulseFactor ||
        oldDelegate.isScanning != isScanning;
  }
}

// ---------------------------------------------------------------------------
// PEER AVATAR
// ---------------------------------------------------------------------------
class PeerAvatar extends StatelessWidget {
  final PeerDevice peer;
  final double size;
  final Color accentColor;
  final bool showProgress;
  final double progress;

  const PeerAvatar({
    super.key,
    required this.peer,
    this.size = 64,
    this.accentColor = Colors.white,
    this.showProgress = false,
    this.progress = 0.0,
  });

  @override
  Widget build(BuildContext context) {
    final hasCustomAvatar = peer.avatarPath.isNotEmpty && File(peer.avatarPath).existsSync();

    return Stack(
      alignment: Alignment.center,
      children: [
        if (showProgress)
          SizedBox(
            width: size + 12,
            height: size + 12,
            child: CircularProgressIndicator(
              value: progress.clamp(0.0, 1.0),
              strokeWidth: 2.5,
              strokeCap: StrokeCap.round,
              backgroundColor: Colors.white.withValues(alpha: 0.08),
              valueColor: AlwaysStoppedAnimation<Color>(accentColor),
            ),
          ),
        ClipRRect(
          borderRadius: BorderRadius.circular(size / 2),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
            child: Container(
              width: size,
              height: size,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.white.withValues(alpha: 0.06),
                border: Border.all(
                  color: peer.isTrusted ? Colors.white : Colors.white.withValues(alpha: 0.20),
                  width: peer.isTrusted ? 1.5 : 0.8,
                ),
              ),
              child: hasCustomAvatar
                  ? ClipOval(
                      child: Image.file(
                        File(peer.avatarPath),
                        width: size,
                        height: size,
                        fit: BoxFit.cover,
                      ),
                    )
                  : Center(
                      child: Text(
                        peer.name.isNotEmpty ? peer.name.substring(0, 1).toUpperCase() : '?',
                        style: TextStyle(
                          fontSize: size * 0.40,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                          letterSpacing: -0.5,
                        ),
                      ),
                    ),
            ),
          ),
        ),
        if (peer.isTrusted)
          Positioned(
            right: 0,
            top: 0,
            child: Container(
              padding: const EdgeInsets.all(3),
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.white,
              ),
              child: const Icon(Icons.star, color: Colors.black, size: 9),
            ),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// CHAT BUBBLE
// ---------------------------------------------------------------------------
class ChatBubble extends StatelessWidget {
  final ChatMessage message;
  final bool isMe;
  final Color accentColor;
  final VoidCallback? onFileTap;

  const ChatBubble({
    super.key,
    required this.message,
    required this.isMe,
    required this.accentColor,
    this.onFileTap,
  });

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
  }

  @override
  Widget build(BuildContext context) {
    final isFile = message.messageType == 'file';

    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 16),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        child: ClipRRect(
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(isMe ? 16 : 4),
            bottomRight: Radius.circular(isMe ? 4 : 16),
          ),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
              decoration: BoxDecoration(
                color: isMe
                    ? Colors.white.withValues(alpha: 0.14)
                    : Colors.white.withValues(alpha: 0.05),
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(16),
                  topRight: const Radius.circular(16),
                  bottomLeft: Radius.circular(isMe ? 16 : 4),
                  bottomRight: Radius.circular(isMe ? 4 : 16),
                ),
                border: Border.all(
                  color: isMe
                      ? Colors.white.withValues(alpha: 0.28)
                      : Colors.white.withValues(alpha: 0.10),
                  width: 0.7,
                ),
              ),
              child: Column(
                crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                children: [
                  if (isFile) ...[
                    GestureDetector(
                      onTap: onFileTap,
                      child: Container(
                        padding: const EdgeInsets.all(10),
                        margin: const EdgeInsets.only(bottom: 6),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.07),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: Colors.white.withValues(alpha: 0.15), width: 0.6),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              width: 36,
                              height: 36,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: Colors.white.withValues(alpha: 0.12),
                              ),
                              child: const Icon(Icons.attach_file_rounded, color: Colors.white, size: 18),
                            ),
                            const SizedBox(width: 10),
                            Flexible(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    message.fileName ?? message.text,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w700,
                                      fontSize: 13,
                                      color: Colors.white,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    message.fileSize != null ? _formatBytes(message.fileSize!) : 'P2P File Transfer',
                                    style: const TextStyle(fontSize: 11, color: Color(0xFF8A8A8A)),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ] else ...[
                    Text(
                      message.text,
                      style: const TextStyle(
                        fontSize: 14,
                        color: Colors.white,
                        height: 1.35,
                      ),
                    ),
                  ],
                  const SizedBox(height: 4),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '${message.timestamp.hour.toString().padLeft(2, '0')}:${message.timestamp.minute.toString().padLeft(2, '0')}',
                        style: const TextStyle(fontSize: 10, color: Color(0xFF8A8A8A)),
                      ),
                      if (isMe) ...[
                        const SizedBox(width: 5),
                        Icon(
                          message.status == 'read'
                              ? Icons.done_all
                              : message.status == 'delivered'
                                  ? Icons.done_all
                                  : message.status == 'sent'
                                      ? Icons.done
                                      : Icons.schedule,
                          size: 13,
                          color: message.status == 'read'
                              ? Colors.white
                              : message.status == 'delivered'
                                  ? Colors.white70
                                  : const Color(0xFF8A8A8A),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
