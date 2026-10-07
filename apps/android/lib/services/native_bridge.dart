import 'dart:async';
import 'package:flutter/services.dart';
import '../models/models.dart';

class NativeBridgeService {
  static const MethodChannel _channel = MethodChannel('com.auradrop.app/native');
  static const EventChannel _eventChannel = EventChannel('com.auradrop.app/events');

  static Stream<dynamic>? _eventsStream;

  static Stream<dynamic> get events {
    _eventsStream ??= _eventChannel.receiveBroadcastStream();
    return _eventsStream!;
  }

  // Device Info
  static Future<Map<String, dynamic>> getDeviceInfo() async {
    final dynamic res = await _channel.invokeMethod('getDeviceInfo');
    if (res is Map) return Map<String, dynamic>.from(res);
    return {};
  }

  static Future<void> requestPermissions() async {
    await _channel.invokeMethod('requestPermissions');
  }

  static Future<List<PickedFileMeta>> getInitialShareFiles() async {
    final dynamic res = await _channel.invokeMethod('getInitialShareFiles');
    if (res is List) {
      return res.whereType<Map>().map((m) => PickedFileMeta.fromMap(m)).toList();
    }
    return [];
  }

  // Discovery
  static Future<void> startDiscovery() async {
    await _channel.invokeMethod('startDiscovery');
  }

  static Future<void> stopDiscovery() async {
    await _channel.invokeMethod('stopDiscovery');
  }

  static Future<List<Map<String, dynamic>>> getDiscoveredPeers() async {
    final dynamic res = await _channel.invokeMethod('getDiscoveredPeers');
    if (res is List) {
      return res.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
    }
    return [];
  }

  // File Picker
  static Future<List<PickedFileMeta>> pickFiles() async {
    final dynamic res = await _channel.invokeMethod('pickFiles');
    if (res is List) {
      return res.whereType<Map>().map((m) => PickedFileMeta.fromMap(m)).toList();
    }
    return [];
  }

  // Transfer Server & Client
  static Future<void> startTransferServer() async {
    await _channel.invokeMethod('startTransferServer');
  }

  static Future<void> sendFiles({
    required String targetIp,
    required int targetPort,
    required List<PickedFileMeta> files,
  }) async {
    await _channel.invokeMethod('sendFiles', {
      'targetIp': targetIp,
      'targetPort': targetPort,
      'files': files.map((f) => f.toMap()).toList(),
    });
  }

  static Future<void> acceptTransfer(String transferId) async {
    await _channel.invokeMethod('acceptTransfer', {'transferId': transferId});
  }

  static Future<void> declineTransfer(String transferId) async {
    await _channel.invokeMethod('declineTransfer', {'transferId': transferId});
  }

  static Future<void> cancelTransfer(String transferId) async {
    await _channel.invokeMethod('cancelTransfer', {'transferId': transferId});
  }

  static Future<void> showSystemIncomingShareNotification({
    required String transferId,
    required String senderName,
    required String senderDeviceName,
    required int totalFiles,
    required int totalBytes,
    required String fileName,
  }) async {
    await _channel.invokeMethod('showSystemIncomingShareNotification', {
      'transferId': transferId,
      'senderName': senderName,
      'senderDeviceName': senderDeviceName,
      'totalFiles': totalFiles,
      'totalBytes': totalBytes,
      'fileName': fileName,
    });
  }

  static Future<void> showNameDropProximityAlert({
    required String peerId,
    required String peerName,
  }) async {
    await _channel.invokeMethod('showNameDropProximityAlert', {
      'peerId': peerId,
      'peerName': peerName,
    });
  }

  static Future<bool> checkOverlayPermission() async {
    final bool? ok = await _channel.invokeMethod<bool>('checkOverlayPermission');
    return ok ?? false;
  }

  static Future<bool> requestOverlayPermission() async {
    final bool? ok = await _channel.invokeMethod<bool>('requestOverlayPermission');
    return ok ?? false;
  }

  static Future<bool> openFile(String filePath) async {
    final bool? ok = await _channel.invokeMethod<bool>('openFile', {'filePath': filePath});
    return ok ?? false;
  }

  static Future<String?> copyUriToCache(String uri, String name) async {
    final String? path = await _channel.invokeMethod<String>('copyUriToCache', {
      'uri': uri,
      'name': name,
    });
    return path;
  }

  // Database / History
  static Future<List<TransferHistoryItem>> getTransferHistory() async {
    final dynamic res = await _channel.invokeMethod('getTransferHistory');
    if (res is List) {
      return res.whereType<Map>().map((m) => TransferHistoryItem.fromMap(m)).toList();
    }
    return [];
  }

  static Future<bool> deleteTransferHistory(String id) async {
    final bool? ok = await _channel.invokeMethod<bool>('deleteTransferHistory', {'id': id});
    return ok ?? false;
  }

  static Future<bool> clearTransferHistory() async {
    final bool? ok = await _channel.invokeMethod<bool>('clearTransferHistory');
    return ok ?? false;
  }

  static Future<List<ReceivedFileItem>> getReceivedFiles() async {
    final dynamic res = await _channel.invokeMethod('getReceivedFiles');
    if (res is List) {
      return res.whereType<Map>().map((m) => ReceivedFileItem.fromMap(m)).toList();
    }
    return [];
  }

  static Future<bool> deleteReceivedFile(String path) async {
    final bool? ok = await _channel.invokeMethod<bool>('deleteReceivedFile', {'path': path});
    return ok ?? false;
  }

  // Chat
  static Future<List<ChatMessage>> getChatMessages(String peerId) async {
    final dynamic res = await _channel.invokeMethod('getChatMessages', {'peerId': peerId});
    if (res is List) {
      return res.whereType<Map>().map((m) => ChatMessage.fromMap(m)).toList();
    }
    return [];
  }

  static Future<void> sendChatMessage({
    required String targetIp,
    required String peerId,
    required String peerName,
    required String text,
  }) async {
    await _channel.invokeMethod('sendChatMessage', {
      'targetIp': targetIp,
      'peerId': peerId,
      'peerName': peerName,
      'text': text,
    });
  }

  static Future<void> sendChatTyping({
    required String targetIp,
    required bool isTyping,
  }) async {
    await _channel.invokeMethod('sendChatTyping', {
      'targetIp': targetIp,
      'isTyping': isTyping,
    });
  }

  // Profile & Trusted
  static Future<UserProfile> getUserProfile() async {
    final dynamic res = await _channel.invokeMethod('getUserProfile');
    if (res is Map) {
      return UserProfile.fromMap(res);
    }
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
    await _channel.invokeMethod('saveUserProfile', {'key': key, 'value': value});
  }

  static Future<List<Map<String, dynamic>>> getTrustedPeers() async {
    final dynamic res = await _channel.invokeMethod('getTrustedPeers');
    if (res is List) {
      return res.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
    }
    return [];
  }

  static Future<void> setPeerTrusted(String peerId, String peerName, bool trusted) async {
    await _channel.invokeMethod('setPeerTrusted', {
      'peerId': peerId,
      'peerName': peerName,
      'trusted': trusted,
    });
  }

  static Future<List<BlockedPeer>> getBlockedPeers() async {
    final dynamic res = await _channel.invokeMethod('getBlockedPeers');
    if (res is List) {
      return res.whereType<Map>().map((m) => BlockedPeer.fromMap(m)).toList();
    }
    return [];
  }

  static Future<bool> setPeerBlocked(String peerId, String peerName, bool blocked) async {
    final bool? ok = await _channel.invokeMethod<bool>('setPeerBlocked', {
      'peerId': peerId,
      'peerName': peerName,
      'blocked': blocked,
    });
    return ok ?? false;
  }

  static Future<bool> updateVisibilityMode(String mode) async {
    final bool? ok = await _channel.invokeMethod<bool>('updateVisibilityMode', {
      'mode': mode,
    });
    return ok ?? false;
  }

  static Future<String?> pickAvatarImage() async {
    return await _channel.invokeMethod<String>('pickAvatarImage');
  }

  static Future<bool> removeAvatarImage() async {
    final bool? ok = await _channel.invokeMethod<bool>('removeAvatarImage');
    return ok ?? false;
  }

  static Future<Map<String, int>> checkStorageSpace() async {
    final dynamic res = await _channel.invokeMethod('checkStorageSpace');
    if (res is Map) {
      return {
        'usable': (res['usable'] as num?)?.toInt() ?? 0,
        'total': (res['total'] as num?)?.toInt() ?? 0,
      };
    }
    return {'usable': 0, 'total': 0};
  }
}
