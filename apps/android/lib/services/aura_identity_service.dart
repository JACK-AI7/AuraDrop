import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

class AuraIdentityService {
  static final AuraIdentityService _instance = AuraIdentityService._internal();
  factory AuraIdentityService() => _instance;
  AuraIdentityService._internal();

  String _deviceId = '';
  String _deviceName = '';
  String _platform = '';
  final Set<String> _trustedDeviceIds = {};

  String get deviceId => _deviceId;
  String get deviceName => _deviceName;
  String get platform => _platform;
  Set<String> get trustedDeviceIds => Set.unmodifiable(_trustedDeviceIds);

  Future<void> init() async {
    _platform = Platform.isWindows
        ? 'windows'
        : Platform.isAndroid
            ? 'android'
            : Platform.isMacOS
                ? 'macos'
                : Platform.isLinux
                    ? 'linux'
                    : 'device';

    try {
      final dir = await getApplicationDocumentsDirectory();
      final file = File('${dir.path}/auradrop_device_identity.json');
      if (await file.exists()) {
        final content = await file.readAsString();
        final data = jsonDecode(content);
        if (data is Map) {
          _deviceId = data['deviceId']?.toString() ?? '';
          _deviceName = data['deviceName']?.toString() ?? '';
        }
      }
    } catch (e) {
      debugPrint('[AuraIdentity] Error loading identity: $e');
    }

    if (_deviceId.isEmpty) {
      final rand = math.Random.secure();
      final randBytes = List<int>.generate(8, (_) => rand.nextInt(256));
      final hex = randBytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
      _deviceId = 'auradrop_${_platform.substring(0, 3)}_$hex';
    }

    if (_deviceName.isEmpty) {
      String host = Platform.localHostname;
      if (host.isEmpty || host == 'localhost') {
        host = Platform.isWindows
            ? 'Windows PC'
            : Platform.isAndroid
                ? 'Android Phone'
                : Platform.isMacOS
                    ? 'Mac'
                    : 'AuraDrop Device';
      }
      _deviceName = host;
      await _saveIdentity();
    }

    await _loadTrustedDevices();
  }

  Future<void> updateDeviceName(String newName) async {
    if (newName.trim().isEmpty) return;
    _deviceName = newName.trim();
    await _saveIdentity();
  }

  Future<void> _saveIdentity() async {
    try {
      final dir = await getApplicationDocumentsDirectory();
      final file = File('${dir.path}/auradrop_device_identity.json');
      await file.writeAsString(jsonEncode({
        'deviceId': _deviceId,
        'deviceName': _deviceName,
        'platform': _platform,
        'updatedAt': DateTime.now().toIso8601String(),
      }));
    } catch (e) {
      debugPrint('[AuraIdentity] Error saving identity: $e');
    }
  }

  Future<void> _loadTrustedDevices() async {
    try {
      final dir = await getApplicationDocumentsDirectory();
      final file = File('${dir.path}/auradrop_trusted_devices.json');
      if (await file.exists()) {
        final content = await file.readAsString();
        final data = jsonDecode(content);
        if (data is List) {
          _trustedDeviceIds.clear();
          for (final item in data) {
            if (item is String && item.isNotEmpty) {
              _trustedDeviceIds.add(item);
            }
          }
        }
      }
    } catch (e) {
      debugPrint('[AuraIdentity] Error loading trusted devices: $e');
    }
  }

  Future<void> trustDevice(String targetDeviceId) async {
    if (targetDeviceId.isEmpty) return;
    _trustedDeviceIds.add(targetDeviceId);
    try {
      final dir = await getApplicationDocumentsDirectory();
      final file = File('${dir.path}/auradrop_trusted_devices.json');
      await file.writeAsString(jsonEncode(_trustedDeviceIds.toList()));
    } catch (e) {
      debugPrint('[AuraIdentity] Error saving trusted device: $e');
    }
  }

  Future<void> untrustDevice(String targetDeviceId) async {
    _trustedDeviceIds.remove(targetDeviceId);
    try {
      final dir = await getApplicationDocumentsDirectory();
      final file = File('${dir.path}/auradrop_trusted_devices.json');
      await file.writeAsString(jsonEncode(_trustedDeviceIds.toList()));
    } catch (e) {
      debugPrint('[AuraIdentity] Error saving trusted devices: $e');
    }
  }

  Future<void> setDeviceTrusted(String targetDeviceId, bool trusted) async {
    if (trusted) {
      await trustDevice(targetDeviceId);
    } else {
      await untrustDevice(targetDeviceId);
    }
  }

  bool isDeviceTrusted(String targetDeviceId) {
    return _trustedDeviceIds.contains(targetDeviceId);
  }
}
