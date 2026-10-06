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
  static const obsidianMinimal = GlassThemeData(
    id: 'obsidian_minimal',
    name: 'Obsidian Minimal',
    background: Color(0xFF050505),
    surfaceGlass: Color(0x0FFFFFFF),
    surfaceGlassHigher: Color(0x1AFFFFFF),
    borderGlass: Color(0x14FFFFFF),
    borderGlassGlow: Color(0x26FFFFFF),
    textPrimary: Colors.white,
    textSecondary: Color(0xFF8A8A8A),
    blurSigma: 20.0,
  );

  static const pureBlack = GlassThemeData(
    id: 'pure_black',
    name: 'Pure Black',
    background: Color(0xFF000000),
    surfaceGlass: Color(0x0DFFFFFF),
    surfaceGlassHigher: Color(0x17FFFFFF),
    borderGlass: Color(0x12FFFFFF),
    borderGlassGlow: Color(0x20FFFFFF),
    textPrimary: Colors.white,
    textSecondary: Color(0xFF7E7E7E),
    blurSigma: 16.0,
  );

  static const glassDark = GlassThemeData(
    id: 'glass_dark',
    name: 'Obsidian Minimal',
    background: Color(0xFF050505),
    surfaceGlass: Color(0x0FFFFFFF),
    surfaceGlassHigher: Color(0x1AFFFFFF),
    borderGlass: Color(0x14FFFFFF),
    borderGlassGlow: Color(0x26FFFFFF),
    textPrimary: Colors.white,
    textSecondary: Color(0xFF8A8A8A),
    blurSigma: 20.0,
  );

  static const obsidianGlass = GlassThemeData(
    id: 'obsidian_glass',
    name: 'Obsidian Glass',
    background: Color(0xFF08080A),
    surfaceGlass: Color(0x12FFFFFF),
    surfaceGlassHigher: Color(0x20FFFFFF),
    borderGlass: Color(0x1AFFFFFF),
    borderGlassGlow: Color(0x28FFFFFF),
    textPrimary: Colors.white,
    textSecondary: Color(0xFF94A3B8),
    blurSigma: 20.0,
  );

  static const auroraGlass = GlassThemeData(
    id: 'aurora_glass',
    name: 'Nordic Slate',
    background: Color(0xFF080D1A),
    surfaceGlass: Color(0x1438BDF8),
    surfaceGlassHigher: Color(0x2638BDF8),
    borderGlass: Color(0x2038BDF8),
    borderGlassGlow: Color(0x3310B981),
    textPrimary: Colors.white,
    textSecondary: Color(0xB3E0F2FE),
    blurSigma: 18.0,
  );

  static const crystalGlass = GlassThemeData(
    id: 'crystal_glass',
    name: 'Monochrome Frost',
    background: Color(0xFF0A0A0E),
    surfaceGlass: Color(0x17FFFFFF),
    surfaceGlassHigher: Color(0x26FFFFFF),
    borderGlass: Color(0x22FFFFFF),
    borderGlassGlow: Color(0x33FFFFFF),
    textPrimary: Colors.white,
    textSecondary: Color(0xFF9E9E9E),
    blurSigma: 18.0,
  );

  static const glassLight = GlassThemeData(
    id: 'glass_light',
    name: 'Minimal Light',
    background: Color(0xFFF1F5F9),
    surfaceGlass: Color(0x8AFFFFFF),
    surfaceGlassHigher: Color(0xC2FFFFFF),
    borderGlass: Color(0x40000000),
    borderGlassGlow: Color(0x20000000),
    textPrimary: Color(0xFF0F172A),
    textSecondary: Color(0xFF64748B),
    blurSigma: 20.0,
  );

  static GlassThemeData getTheme(String id) {
    switch (id) {
      case 'pure_black':
        return pureBlack;
      case 'obsidian_minimal':
        return obsidianMinimal;
      case 'obsidian_glass':
        return obsidianGlass;
      case 'aurora_glass':
        return auroraGlass;
      case 'crystal_glass':
        return crystalGlass;
      case 'glass_light':
        return glassLight;
      default:
        return obsidianMinimal;
    }
  }

  // Accent Colors
  static Color getAccent(String key) {
    switch (key) {
      case 'white':
      case 'monochrome':
        return const Color(0xFFFFFFFF);
      case 'slate':
        return const Color(0xFF94A3B8);
      case 'emerald':
        return const Color(0xFF10B981);
      case 'indigo':
        return const Color(0xFF818CF8);
      case 'rose':
        return const Color(0xFFF43F5E);
      case 'amber':
        return const Color(0xFFF59E0B);
      case 'cyan':
        return const Color(0xFF38BDF8);
      default:
        return const Color(0xFFFFFFFF);
    }
  }
}
