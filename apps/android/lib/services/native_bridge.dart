import 'dart:async';
import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import '../models/models.dart';
import 'aura_identity_service.dart';
import 'aura_discovery_service.dart';
import 'aura_lan_server.dart';
import 'aura_transfer_engine.dart';

class NativeBridgeService {
  static const MethodChannel _channel = MethodChannel('com.auradrop.app/native');
  static const EventChannel _eventChannel = EventChannel('com.auradrop.app/events');

  static Stream<dynamic>? _eventsStream;
  static final StreamController<dynamic> _desktopEventsController = StreamController<dynamic>.broadcast();

  static Stream<dynamic> get events {
    if (!Platform.isAndroid) {
      return _desktopEventsController.stream;
    }
    try {
      _eventsStream ??= _eventChannel.receiveBroadcastStream();
      return _eventsStream!;
    } catch (_) {
      return _desktopEventsController.stream;
    }
  }

  // Device Info
  static Future<Map<String, dynamic>> getDeviceInfo() async {
    if (!Platform.isAndroid) {
      final identity = AuraIdentityService();
      if (identity.deviceId.isEmpty) {
        await identity.init();
      }
      return {
        'deviceId': identity.deviceId,
        'deviceName': identity.deviceName,
        'ipAddress': AuraLanServer().localIp,
        'platform': Platform.operatingSystem,
        'port': AuraLanServer().port,
      };
    }

    try {
      final dynamic res = await _channel.invokeMethod('getDeviceInfo');
      if (res is Map) return Map<String, dynamic>.from(res);
    } catch (e) {
      debugPrint('[NativeBridge] getDeviceInfo fallback: $e');
      final identity = AuraIdentityService();
      if (identity.deviceId.isEmpty) {
        await identity.init();
      }
      return {
        'deviceId': identity.deviceId,
        'deviceName': identity.deviceName,
        'ipAddress': AuraLanServer().localIp,
        'platform': 'android',
        'port': AuraLanServer().port,
      };
    }
    return {};
  }

  static Future<void> requestPermissions() async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod('requestPermissions');
    } catch (_) {}
  }

  static Future<List<PickedFileMeta>> getInitialShareFiles() async {
    if (!Platform.isAndroid) return [];
    try {
      final dynamic res = await _channel.invokeMethod('getInitialShareFiles');
      if (res is List) {
        return res.whereType<Map>().map((m) => PickedFileMeta.fromMap(m)).toList();
      }
    } catch (_) {}
    return [];
  }

  // Discovery
  static Future<void> startDiscovery() async {
    if (!Platform.isAndroid) {
      await AuraDiscoveryService().start();
      return;
    }
    try {
      await _channel.invokeMethod('startDiscovery');
    } catch (_) {}
  }

  static Future<void> stopDiscovery() async {
    if (!Platform.isAndroid) {
      AuraDiscoveryService().stop();
      return;
    }
    try {
      await _channel.invokeMethod('stopDiscovery');
    } catch (_) {}
  }

  static Future<List<Map<String, dynamic>>> getDiscoveredPeers() async {
    if (!Platform.isAndroid) {
      return AuraDiscoveryService().currentPeers.map((p) => p.toMap()).toList();
    }
    try {
      final dynamic res = await _channel.invokeMethod('getDiscoveredPeers');
      if (res is List) {
        return res.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
      }
    } catch (_) {}
    return [];
  }

  // File Picker
  static Future<List<PickedFileMeta>> pickFiles() async {
    try {
      final result = await FilePicker.pickFiles();
      if (result.isNotEmpty) {
        return result.where((f) => f.path != null).map((f) {
          final file = File(f.path!);
          return PickedFileMeta(
            id: 'file_${DateTime.now().millisecondsSinceEpoch}_${f.name.hashCode}',
            name: f.name,
            size: (file.existsSync() ? file.lengthSync() : 0),
            customPath: f.path!,
            mimeType: 'application/octet-stream',
            uri: f.path!,
          );
        }).toList();
      }
    } catch (e) {
      debugPrint('[NativeBridge] FilePicker error: $e');
      if (Platform.isAndroid) {
        try {
          final dynamic res = await _channel.invokeMethod('pickFiles');
          if (res is List) {
            return res.whereType<Map>().map((m) => PickedFileMeta.fromMap(m)).toList();
          }
        } catch (_) {}
      }
    }
    return [];
  }

  // Transfer Server & Client
  static Future<void> startTransferServer() async {
    if (!Platform.isAndroid) {
      final identity = AuraIdentityService();
      if (identity.deviceId.isEmpty) {
        await identity.init();
      }
      await AuraLanServer().start(
        deviceId: identity.deviceId,
        deviceName: identity.deviceName,
      );
      return;
    }
    try {
      await _channel.invokeMethod('startTransferServer');
    } catch (_) {}
  }

  static Future<void> sendFiles({
    required String targetIp,
    required int targetPort,
    required List<PickedFileMeta> files,
  }) async {
    if (!Platform.isAndroid) {
      final peer = PeerDevice(
        id: targetIp,
        name: 'Nearby Device',
        deviceName: 'Nearby Device',
        platform: 'device',
        ip: targetIp,
        port: targetPort,
        lastSeen: DateTime.now(),
      );
      for (final f in files) {
        await AuraTransferEngine().sendFile(
          target: peer,
          filePath: f.path,
          fileName: f.name,
          fileSize: f.size,
        );
      }
      return;
    }
    try {
      await _channel.invokeMethod('sendFiles', {
        'targetIp': targetIp,
        'targetPort': targetPort,
        'files': files.map((f) => f.toMap()).toList(),
      });
    } catch (_) {}
  }

  static Future<void> acceptTransfer(String transferId) async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod('acceptTransfer', {'transferId': transferId});
    } catch (_) {}
  }

  static Future<void> declineTransfer(String transferId) async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod('declineTransfer', {'transferId': transferId});
    } catch (_) {}
  }

  static Future<void> cancelTransfer(String transferId) async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod('cancelTransfer', {'transferId': transferId});
    } catch (_) {}
  }

  static Future<void> showSystemIncomingShareNotification({
    required String transferId,
    required String senderName,
    required String senderDeviceName,
    required int totalFiles,
    required int totalBytes,
    required String fileName,
  }) async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod('showSystemIncomingShareNotification', {
        'transferId': transferId,
        'senderName': senderName,
        'senderDeviceName': senderDeviceName,
        'totalFiles': totalFiles,
        'totalBytes': totalBytes,
        'fileName': fileName,
      });
    } catch (_) {}
  }

  static Future<void> showNameDropProximityAlert({
    required String peerId,
    required String peerName,
    String? deviceName,
    String? platform,
    String? ip,
  }) async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod('showNameDropProximityAlert', {
        'peerId': peerId,
        'peerName': peerName,
        'deviceName': deviceName ?? peerName,
        'platform': platform ?? 'device',
        'ip': ip ?? '',
      });
    } catch (_) {}
  }

  static Future<bool> checkOverlayPermission() async {
    if (!Platform.isAndroid) return false;
    try {
      final bool? ok = await _channel.invokeMethod<bool>('checkOverlayPermission');
      return ok ?? false;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> requestOverlayPermission() async {
    if (!Platform.isAndroid) return false;
    try {
      final bool? ok = await _channel.invokeMethod<bool>('requestOverlayPermission');
      return ok ?? false;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> openFile(String filePath) async {
    if (Platform.isWindows) {
      try {
        await Process.run('explorer.exe', ['/select,', filePath]);
        return true;
      } catch (_) {
        try {
          await Process.run('cmd.exe', ['/c', 'start', '', filePath]);
          return true;
        } catch (_) {
          return false;
        }
      }
    } else if (Platform.isMacOS) {
      try {
        await Process.run('open', [filePath]);
        return true;
      } catch (_) {
        return false;
      }
    } else if (Platform.isLinux) {
      try {
        await Process.run('xdg-open', [filePath]);
        return true;
      } catch (_) {
        return false;
      }
    }

    try {
      final bool? ok = await _channel.invokeMethod<bool>('openFile', {'filePath': filePath});
      return ok ?? false;
    } catch (_) {
      return false;
    }
  }

  static Future<String?> copyUriToCache(String uri, String name) async {
    if (!Platform.isAndroid) return uri;
    try {
      final String? path = await _channel.invokeMethod<String>('copyUriToCache', {
        'uri': uri,
        'name': name,
      });
      return path;
    } catch (_) {
      return uri;
    }
  }

  // Database / History
  static Future<List<TransferHistoryItem>> getTransferHistory() async {
    if (!Platform.isAndroid) return [];
    try {
      final dynamic res = await _channel.invokeMethod('getTransferHistory');
      if (res is List) {
        return res.whereType<Map>().map((m) => TransferHistoryItem.fromMap(m)).toList();
      }
    } catch (_) {}
    return [];
  }

  static Future<bool> deleteTransferHistory(String id) async {
    if (!Platform.isAndroid) return true;
    try {
      final bool? ok = await _channel.invokeMethod<bool>('deleteTransferHistory', {'id': id});
      return ok ?? false;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> clearTransferHistory() async {
    if (!Platform.isAndroid) return true;
    try {
      final bool? ok = await _channel.invokeMethod<bool>('clearTransferHistory');
      return ok ?? false;
    } catch (_) {
      return false;
    }
  }

  static Future<List<ReceivedFileItem>> getReceivedFiles() async {
    if (!Platform.isAndroid) return [];
    try {
      final dynamic res = await _channel.invokeMethod('getReceivedFiles');
      if (res is List) {
        return res.whereType<Map>().map((m) => ReceivedFileItem.fromMap(m)).toList();
      }
    } catch (_) {}
    return [];
  }

  static Future<bool> deleteReceivedFile(String path) async {
    if (!Platform.isAndroid) {
      try {
        final f = File(path);
        if (f.existsSync()) f.deleteSync();
        return true;
      } catch (_) {
        return false;
      }
    }
    try {
      final bool? ok = await _channel.invokeMethod<bool>('deleteReceivedFile', {'path': path});
      return ok ?? false;
    } catch (_) {
      return false;
    }
  }

  static Future<void> recordTransferHistory({
    required String id,
    required String senderName,
    required String receiverName,
    required String fileName,
    required int fileSize,
    required String direction,
    required String status,
    required String sha256,
    required String localPath,
    required String transportType,
    required int avgSpeed,
  }) async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod('recordTransferHistory', {
        'id': id,
        'senderName': senderName,
        'receiverName': receiverName,
        'fileName': fileName,
        'fileSize': fileSize,
        'direction': direction,
        'status': status,
        'sha256': sha256,
        'localPath': localPath,
        'transportType': transportType,
        'avgSpeed': avgSpeed,
      });
    } catch (e) {
      debugPrint('[NativeBridge] recordTransferHistory error: $e');
    }
  }

  static Future<void> recordChatMessage({
    required String id,
    required String peerId,
    required String peerName,
    required String text,
    required bool isOutgoing,
    int? timestamp,
  }) async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod('recordChatMessage', {
        'id': id,
        'peerId': peerId,
        'peerName': peerName,
        'senderId': isOutgoing ? '' : peerId,
        'text': text,
        'timestamp': timestamp ?? DateTime.now().millisecondsSinceEpoch,
        'status': isOutgoing ? 'sent' : 'received',
      });
    } catch (e) {
      debugPrint('[NativeBridge] recordChatMessage error: $e');
    }
  }

  // Chat
  static Future<List<ChatMessage>> getChatMessages(String peerId) async {
    if (!Platform.isAndroid) return [];
    try {
      final dynamic res = await _channel.invokeMethod('getChatMessages', {'peerId': peerId});
      if (res is List) {
        return res.whereType<Map>().map((m) => ChatMessage.fromMap(m)).toList();
      }
    } catch (_) {}
    return [];
  }

  static Future<void> sendChatMessage({
    required String targetIp,
    int? targetPort,
    required String peerId,
    required String peerName,
    required String text,
  }) async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod('sendChatMessage', {
        'targetIp': targetIp,
        'targetPort': targetPort ?? 53317,
        'peerId': peerId,
        'peerName': peerName,
        'text': text,
      });
    } catch (_) {}
  }

  static Future<void> sendChatTyping({
    required String targetIp,
    required bool isTyping,
  }) async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod('sendChatTyping', {
        'targetIp': targetIp,
        'isTyping': isTyping,
      });
    } catch (_) {}
  }

  // Profile & Trusted
  static Future<UserProfile> getUserProfile() async {
    if (!Platform.isAndroid) {
      final id = AuraIdentityService();
      if (id.deviceId.isEmpty) {
        await id.init();
      }
      return UserProfile(
        displayName: id.deviceName.isNotEmpty ? id.deviceName : 'Desktop User',
        avatarIndex: 0,
        bio: 'Nearby sharing made effortless',
        theme: 'dark',
        accent: 'white',
        visibility: 'everyone',
      );
    }
    try {
      final dynamic res = await _channel.invokeMethod('getUserProfile');
      if (res is Map) {
        return UserProfile.fromMap(res);
      }
    } catch (_) {}
    return UserProfile(
      displayName: 'Unknown Device',
      avatarIndex: 0,
      bio: 'Nearby sharing made effortless',
      theme: 'dark',
      accent: 'white',
      visibility: 'everyone',
    );
  }

  static Future<void> saveUserProfile(String key, String value) async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod('saveUserProfile', {'key': key, 'value': value});
    } catch (_) {}
  }

  static Future<List<Map<String, dynamic>>> getTrustedPeers() async {
    if (!Platform.isAndroid) {
      return AuraIdentityService().trustedDeviceIds.map((tid) => {'peerId': tid, 'peerName': tid}).toList();
    }
    try {
      final dynamic res = await _channel.invokeMethod('getTrustedPeers');
      if (res is List) {
        return res.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
      }
    } catch (_) {}
    return [];
  }

  static Future<void> setPeerTrusted(String peerId, String peerName, bool trusted) async {
    AuraIdentityService().setDeviceTrusted(peerId, trusted);
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod('setPeerTrusted', {
        'peerId': peerId,
        'peerName': peerName,
        'trusted': trusted,
      });
    } catch (_) {}
  }

  static Future<List<BlockedPeer>> getBlockedPeers() async {
    if (!Platform.isAndroid) return [];
    try {
      final dynamic res = await _channel.invokeMethod('getBlockedPeers');
      if (res is List) {
        return res.whereType<Map>().map((m) => BlockedPeer.fromMap(m)).toList();
      }
    } catch (_) {}
    return [];
  }

  static Future<bool> setPeerBlocked(String peerId, String peerName, bool blocked) async {
    if (!Platform.isAndroid) return true;
    try {
      final bool? ok = await _channel.invokeMethod<bool>('setPeerBlocked', {
        'peerId': peerId,
        'peerName': peerName,
        'blocked': blocked,
      });
      return ok ?? false;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> updateVisibilityMode(String mode) async {
    if (!Platform.isAndroid) return true;
    try {
      final bool? ok = await _channel.invokeMethod<bool>('updateVisibilityMode', {
        'mode': mode,
      });
      return ok ?? false;
    } catch (_) {
      return false;
    }
  }

  static Future<String?> pickAvatarImage() async {
    if (!Platform.isAndroid) {
      try {
        final result = await FilePicker.pickFiles(
          type: FileType.image,
        );
        if (result.isNotEmpty) {
          return result.first.path;
        }
      } catch (_) {}
      return null;
    }
    try {
      return await _channel.invokeMethod<String>('pickAvatarImage');
    } catch (_) {
      return null;
    }
  }

  static Future<bool> removeAvatarImage() async {
    if (!Platform.isAndroid) return true;
    try {
      final bool? ok = await _channel.invokeMethod<bool>('removeAvatarImage');
      return ok ?? false;
    } catch (_) {
      return false;
    }
  }

  static Future<Map<String, int>> checkStorageSpace() async {
    if (!Platform.isAndroid) {
      return {
        'usable': 100 * 1024 * 1024 * 1024,
        'total': 500 * 1024 * 1024 * 1024,
      };
    }
    try {
      final dynamic res = await _channel.invokeMethod('checkStorageSpace');
      if (res is Map) {
        return {
          'usable': (res['usable'] as num?)?.toInt() ?? 0,
          'total': (res['total'] as num?)?.toInt() ?? 0,
        };
      }
    } catch (_) {}
    return {'usable': 0, 'total': 0};
  }
}
