import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';

class AuraUpdateInfo {
  final bool hasUpdate;
  final String currentVersion;
  final String latestVersion;
  final String releaseNotes;
  final String downloadUrl;

  const AuraUpdateInfo({
    required this.hasUpdate,
    required this.currentVersion,
    required this.latestVersion,
    required this.releaseNotes,
    required this.downloadUrl,
  });
}

class AuraUpdateService {
  static final AuraUpdateService _instance = AuraUpdateService._internal();
  factory AuraUpdateService() => _instance;
  AuraUpdateService._internal();

  static const String currentVersion = '2.0.1';
  static const int currentVersionCode = 4;

  static const String githubApiUrl = 'https://api.github.com/repos/JACK-AI7/AuraDrop/releases/latest';
  static const String fallbackVersionJsonUrl = 'https://raw.githubusercontent.com/JACK-AI7/AuraDrop/main/version.json';

  Future<AuraUpdateInfo> checkForUpdate() async {
    // 1. Try GitHub Releases API
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
      final request = await client.getUrl(Uri.parse(githubApiUrl));
      request.headers.set('User-Agent', 'AuraDrop-Client/$currentVersion');
      final response = await request.close().timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        final body = await response.transform(utf8.decoder).join();
        final data = jsonDecode(body) as Map<String, dynamic>;
        final tag = (data['tag_name'] ?? '').toString().replaceAll('v', '').trim();
        final notes = data['body']?.toString() ?? 'Performance updates and bug fixes.';
        String apkUrl = '';
        final assets = data['assets'];
        if (assets is List) {
          for (final a in assets) {
            final name = (a['name'] ?? '').toString();
            if (name.endsWith('.apk')) {
              apkUrl = a['browser_download_url']?.toString() ?? '';
              break;
            }
          }
        }
        if (apkUrl.isEmpty) {
          apkUrl = 'https://github.com/JACK-AI7/AuraDrop/releases/latest';
        }

        final hasUpdate = _isNewer(tag, currentVersion);
        return AuraUpdateInfo(
          hasUpdate: hasUpdate,
          currentVersion: currentVersion,
          latestVersion: tag.isNotEmpty ? tag : currentVersion,
          releaseNotes: notes,
          downloadUrl: apkUrl,
        );
      }
    } catch (e) {
      debugPrint('[AuraUpdateService] GitHub releases check failed: $e');
    }

    // 2. Fallback to raw version.json
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 4);
      final request = await client.getUrl(Uri.parse(fallbackVersionJsonUrl));
      request.headers.set('Cache-Control', 'no-cache');
      final response = await request.close().timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        final body = await response.transform(utf8.decoder).join();
        final data = jsonDecode(body) as Map<String, dynamic>;
        final latest = (data['version'] ?? '').toString().replaceAll('v', '').trim();
        final notes = data['release_notes']?.toString() ?? 'Latest production updates.';
        final androidObj = data['android'] as Map<String, dynamic>?;
        final apkUrl = androidObj?['download_url']?.toString() ?? 'https://github.com/JACK-AI7/AuraDrop/releases';

        final hasUpdate = _isNewer(latest, currentVersion);
        return AuraUpdateInfo(
          hasUpdate: hasUpdate,
          currentVersion: currentVersion,
          latestVersion: latest.isNotEmpty ? latest : currentVersion,
          releaseNotes: notes,
          downloadUrl: apkUrl,
        );
      }
    } catch (e) {
      debugPrint('[AuraUpdateService] Fallback version check failed: $e');
    }

    return AuraUpdateInfo(
      hasUpdate: false,
      currentVersion: currentVersion,
      latestVersion: currentVersion,
      releaseNotes: 'You are running the latest version of AuraDrop ($currentVersion).',
      downloadUrl: '',
    );
  }

  bool _isNewer(String latest, String current) {
    if (latest.isEmpty || latest == current) return false;
    final latestParts = latest.split('.').map((p) => int.tryParse(p) ?? 0).toList();
    final currentParts = current.split('.').map((p) => int.tryParse(p) ?? 0).toList();
    while (latestParts.length < 3) {
      latestParts.add(0);
    }
    while (currentParts.length < 3) {
      currentParts.add(0);
    }

    for (int i = 0; i < 3; i++) {
      if (latestParts[i] > currentParts[i]) return true;
      if (latestParts[i] < currentParts[i]) return false;
    }
    return false;
  }
}
