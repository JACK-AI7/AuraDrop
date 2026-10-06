import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/aura_theme.dart';
import '../models/models.dart';

// ---------------------------------------------------------------------------
// MINIMAL CARD (Flat, Quiet, Zero Glassmorphism)
// ---------------------------------------------------------------------------
class MinimalCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry? margin;
  final double borderRadius;
  final VoidCallback? onTap;
  final Color? borderColor;
  final Color? backgroundColor;

  const MinimalCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.margin,
    this.borderRadius = 16,
    this.onTap,
    this.borderColor,
    this.backgroundColor,
  });

  @override
  Widget build(BuildContext context) {
    final theme = AuraTheme.of(context);

    Widget content = Container(
      margin: margin,
      padding: padding,
      decoration: BoxDecoration(
        color: backgroundColor ?? theme.cardBackground,
        borderRadius: BorderRadius.circular(borderRadius),
        border: Border.all(
          color: borderColor ?? theme.border,
          width: 1.0,
        ),
      ),
      child: child,
    );

    if (onTap != null) {
      return GestureDetector(
        onTap: () {
          HapticFeedback.lightImpact();
          onTap!();
        },
        behavior: HitTestBehavior.opaque,
        child: content,
      );
    }
    return content;
  }
}

// ---------------------------------------------------------------------------
// MINIMAL BUTTON (Primary Inverted Action / Secondary Outlined)
// ---------------------------------------------------------------------------
class MinimalButton extends StatelessWidget {
  final String text;
  final IconData? icon;
  final VoidCallback onPressed;
  final bool isPrimary;
  final EdgeInsetsGeometry padding;
  final double borderRadius;

  const MinimalButton({
    super.key,
    required this.text,
    required this.onPressed,
    this.icon,
    this.isPrimary = true,
    this.padding = const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
    this.borderRadius = 12,
  });

  @override
  Widget build(BuildContext context) {
    final theme = AuraTheme.of(context);

    return GestureDetector(
      onTap: () {
        HapticFeedback.mediumImpact();
        onPressed();
      },
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: padding,
        decoration: BoxDecoration(
          color: isPrimary ? theme.actionBackground : Colors.transparent,
          borderRadius: BorderRadius.circular(borderRadius),
          border: Border.all(
            color: isPrimary ? theme.actionBackground : theme.border,
            width: 1.0,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (icon != null) ...[
              Icon(
                icon,
                size: 16,
                color: isPrimary ? theme.actionText : theme.textPrimary,
              ),
              const SizedBox(width: 8),
            ],
            Text(
              text,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: isPrimary ? theme.actionText : theme.textPrimary,
                letterSpacing: 0.2,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// MINIMAL ICON BUTTON
// ---------------------------------------------------------------------------
class MinimalIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onPressed;
  final double size;
  final Color? color;

  const MinimalIconButton({
    super.key,
    required this.icon,
    required this.onPressed,
    this.size = 38,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final theme = AuraTheme.of(context);

    return GestureDetector(
      onTap: () {
        HapticFeedback.lightImpact();
        onPressed();
      },
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: theme.subtleHighlight,
          border: Border.all(color: theme.border, width: 1.0),
        ),
        child: Center(
          child: Icon(
            icon,
            size: size * 0.46,
            color: color ?? theme.textPrimary,
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// MINIMAL PEER AVATAR
// ---------------------------------------------------------------------------
class MinimalPeerAvatar extends StatelessWidget {
  final PeerDevice peer;
  final double size;
  final bool isSelected;

  const MinimalPeerAvatar({
    super.key,
    required this.peer,
    this.size = 44,
    this.isSelected = false,
  });

  @override
  Widget build(BuildContext context) {
    final theme = AuraTheme.of(context);
    final hasCustomAvatar = peer.avatarPath.isNotEmpty && File(peer.avatarPath).existsSync();

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: isSelected ? theme.actionBackground : theme.cardBackground,
        border: Border.all(
          color: isSelected ? theme.actionBackground : theme.border,
          width: isSelected ? 2.0 : 1.0,
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
                  fontWeight: FontWeight.w800,
                  color: isSelected ? theme.actionText : theme.textPrimary,
                ),
              ),
            ),
    );
  }
}
