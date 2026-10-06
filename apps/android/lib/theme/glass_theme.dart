import 'package:flutter/material.dart';

class GlassThemeData {
  final String id;
  final String name;
  final Color background;
  final Color surfaceGlass;
  final Color surfaceGlassHigher;
  final Color borderGlass;
  final Color borderGlassGlow;
  final Color textPrimary;
  final Color textSecondary;
  final double blurSigma;

  const GlassThemeData({
    required this.id,
    required this.name,
    required this.background,
    required this.surfaceGlass,
    required this.surfaceGlassHigher,
    required this.borderGlass,
    required this.borderGlassGlow,
    required this.textPrimary,
    required this.textSecondary,
    required this.blurSigma,
  });
}

class GlassTheme {
  // Theme definitions
  static const glassDark = GlassThemeData(
    id: 'glass_dark',
    name: 'Glass Dark',
    background: Color(0xFF0C0E14),
    surfaceGlass: Color(0x1AFFFFFF),
    surfaceGlassHigher: Color(0x2EFFFFFF),
    borderGlass: Color(0x26FFFFFF),
    borderGlassGlow: Color(0x4038BDF8),
    textPrimary: Colors.white,
    textSecondary: Color(0xB3FFFFFF),
    blurSigma: 16.0,
  );

  static const obsidianGlass = GlassThemeData(
    id: 'obsidian_glass',
    name: 'Obsidian Glass',
    background: Color(0xFF060709),
    surfaceGlass: Color(0x14FFFFFF),
    surfaceGlassHigher: Color(0x24FFFFFF),
    borderGlass: Color(0x1FFFFFFF),
    borderGlassGlow: Color(0x33818CF8),
    textPrimary: Colors.white,
    textSecondary: Color(0x99FFFFFF),
    blurSigma: 20.0,
  );

  static const auroraGlass = GlassThemeData(
    id: 'aurora_glass',
    name: 'Aurora Glass',
    background: Color(0xFF080D1A),
    surfaceGlass: Color(0x1F38BDF8),
    surfaceGlassHigher: Color(0x3338BDF8),
    borderGlass: Color(0x3338BDF8),
    borderGlassGlow: Color(0x6610B981),
    textPrimary: Colors.white,
    textSecondary: Color(0xB3E0F2FE),
    blurSigma: 18.0,
  );

  static const crystalGlass = GlassThemeData(
    id: 'crystal_glass',
    name: 'Crystal Glass',
    background: Color(0xFF0A101D),
    surfaceGlass: Color(0x2660A5FA),
    surfaceGlassHigher: Color(0x3D60A5FA),
    borderGlass: Color(0x3D93C5FD),
    borderGlassGlow: Color(0x6638BDF8),
    textPrimary: Colors.white,
    textSecondary: Color(0xCCBAE6FD),
    blurSigma: 16.0,
  );

  static const glassLight = GlassThemeData(
    id: 'glass_light',
    name: 'Glass Light',
    background: Color(0xFFE2E8F0),
    surfaceGlass: Color(0x7AFFFFFF),
    surfaceGlassHigher: Color(0xB8FFFFFF),
    borderGlass: Color(0x66FFFFFF),
    borderGlassGlow: Color(0x400284C7),
    textPrimary: Color(0xFF0F172A),
    textSecondary: Color(0xFF475569),
    blurSigma: 20.0,
  );

  static GlassThemeData getTheme(String id) {
    switch (id) {
      case 'obsidian_glass':
        return obsidianGlass;
      case 'aurora_glass':
        return auroraGlass;
      case 'crystal_glass':
        return crystalGlass;
      case 'glass_light':
        return glassLight;
      default:
        return glassDark;
    }
  }

  // Accent Colors
  static Color getAccent(String key) {
    switch (key) {
      case 'indigo':
        return const Color(0xFF818CF8);
      case 'emerald':
        return const Color(0xFF10B981);
      case 'rose':
        return const Color(0xFFF43F5E);
      case 'amber':
        return const Color(0xFFF59E0B);
      case 'cyan':
      default:
        return const Color(0xFF38BDF8);
    }
  }
}
