import 'package:flutter/material.dart';

class AuraTheme {
  final bool isDark;
  final Color background;
  final Color cardBackground;
  final Color border;
  final Color textPrimary;
  final Color textSecondary;
  final Color actionBackground;
  final Color actionText;
  final Color subtleHighlight;
  final Color success;
  final Color error;

  const AuraTheme({
    required this.isDark,
    required this.background,
    required this.cardBackground,
    required this.border,
    required this.textPrimary,
    required this.textSecondary,
    required this.actionBackground,
    required this.actionText,
    required this.subtleHighlight,
    required this.success,
    required this.error,
  });

  static const dark = AuraTheme(
    isDark: true,
    background: Color(0xFF000000),
    cardBackground: Color(0xFF0D0D0D),
    border: Color(0xFF202020),
    textPrimary: Color(0xFFFFFFFF),
    textSecondary: Color(0xFFA0A0A0),
    actionBackground: Color(0xFFFFFFFF),
    actionText: Color(0xFF000000),
    subtleHighlight: Color(0x1AFFFFFF),
    success: Color(0xFFFFFFFF),
    error: Color(0xFFEF4444),
  );

  static const light = AuraTheme(
    isDark: false,
    background: Color(0xFFFFFFFF),
    cardBackground: Color(0xFFF7F7F7),
    border: Color(0xFFE8E8E8),
    textPrimary: Color(0xFF000000),
    textSecondary: Color(0xFF6B6B6B),
    actionBackground: Color(0xFF000000),
    actionText: Color(0xFFFFFFFF),
    subtleHighlight: Color(0x0F000000),
    success: Color(0xFF000000),
    error: Color(0xFFDC2626),
  );

  static AuraTheme of(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return isDark ? dark : light;
  }
}
