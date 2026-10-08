import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import '../models/models.dart';

class AuraSignalingService {
  static final AuraSignalingService _instance = AuraSignalingService._internal();
  factory AuraSignalingService() => _instance;
  AuraSignalingService._internal();

  // Default production & local Wi-Fi endpoints
  static const String defaultLocalWifiSignalingUrl = 'http://192.168.0.8:5173/api/signaling';
  static const String defaultProductionSignalingUrl = defaultLocalWifiSignalingUrl;

  static String normalizeUrl(String input) {
    var url = input.trim();
    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (!url.contains('/api/signaling') && !url.contains('/ws')) {
        if (url.endsWith('/')) {
          url = '${url}api/signaling';
        } else {
          url = '$url/api/signaling';
        }
      }
    }
    return url;
  }

  WebSocket? _socket;
  Timer? _heartbeatTimer;
  Timer? _reconnectTimer;
  bool _isConnecting = false;
  bool _shouldReconnect = true;
  int _reconnectAttempts = 0;

  String _signalingUrl = defaultProductionSignalingUrl;
  String _deviceId = '';
  String _displayName = '';
  String _deviceName = '';
  String _visibility = 'everyone';
  int _avatarIndex = 0;
  String _localIp = '';
  int _localPort = 0;
  final Set<String> _knownPeerIds = <String>{};

  void updateLanEndpoint({required String localIp, required int localPort}) {
    _localIp = localIp;
    _localPort = localPort;
  }

  // Streams for reactive UI updates
  final _connectionStateController = StreamController<bool>.broadcast();
  final _peerListController = StreamController<List<PeerDevice>>.broadcast();
  final _peerOnlineController = StreamController<PeerDevice>.broadcast();
  final _peerOfflineController = StreamController<String>.broadcast();
  final _transferRequestController = StreamController<Map<String, dynamic>>.broadcast();
  final _transferAcceptController = StreamController<Map<String, dynamic>>.broadcast();
  final _transferDeclineController = StreamController<Map<String, dynamic>>.broadcast();
  final _signalController = StreamController<Map<String, dynamic>>.broadcast();

  Stream<bool> get onConnectionChanged => _connectionStateController.stream;
  Stream<List<PeerDevice>> get onPeerList => _peerListController.stream;
  Stream<PeerDevice> get onPeerOnline => _peerOnlineController.stream;
  Stream<String> get onPeerOffline => _peerOfflineController.stream;
  Stream<Map<String, dynamic>> get onTransferRequest => _transferRequestController.stream;
  Stream<Map<String, dynamic>> get onTransferAccept => _transferAcceptController.stream;
  Stream<Map<String, dynamic>> get onTransferDecline => _transferDeclineController.stream;
  Stream<Map<String, dynamic>> get onSignal => _signalController.stream;

  bool get isConnected => (_socket != null && _socket!.readyState == WebSocket.open) || _isHttpSignaling;
  String get currentUrl => _signalingUrl;

  bool _isHttpSignaling = false;
  Timer? _httpPollTimer;
  final HttpClient _httpClient = HttpClient()
    ..connectionTimeout = const Duration(seconds: 6)
    ..badCertificateCallback = ((X509Certificate cert, String host, int port) => true);

  Future<void> initPersistedUrl() async {
    try {
      final dir = await getApplicationDocumentsDirectory();
      final file = File('${dir.path}/auradrop_signaling_url.txt');
      if (await file.exists()) {
        final saved = (await file.readAsString()).trim();
        if (saved.isNotEmpty) {
          _signalingUrl = normalizeUrl(saved);
          debugPrint('[AuraSignaling] Loaded persisted URL: $_signalingUrl');
        }
      }
    } catch (_) {}
  }

  Future<void> savePersistedUrl(String url) async {
    try {
      final dir = await getApplicationDocumentsDirectory();
      final file = File('${dir.path}/auradrop_signaling_url.txt');
      await file.writeAsString(url.trim());
    } catch (_) {}
  }

  void configureIdentity({
    required String deviceId,
    required String displayName,
    required String deviceName,
    String visibility = 'everyone',
    int avatarIndex = 0,
    String? customSignalingUrl,
  }) {
    _deviceId = deviceId;
    _displayName = displayName;
    _deviceName = deviceName;
    _visibility = visibility;
    _avatarIndex = avatarIndex;
    if (customSignalingUrl != null && customSignalingUrl.isNotEmpty) {
      _signalingUrl = normalizeUrl(customSignalingUrl);
    }
  }

  void setSignalingUrl(String url) {
    if (url.trim().isEmpty) return;
    _signalingUrl = normalizeUrl(url);
    savePersistedUrl(_signalingUrl);
    disconnect();
    _shouldReconnect = true;
    _reconnectAttempts = 0;
    connect();
  }

  Future<void> connect() async {
    if (_isConnecting || isConnected) return;
    _isConnecting = true;

    // Check if HTTP/HTTPS serverless signaling
    if (_signalingUrl.startsWith('http://') || _signalingUrl.startsWith('https://')) {
      _isConnecting = false;
      await _connectHttp();
      return;
    }

    try {
      debugPrint('[AuraSignaling] Connecting to $_signalingUrl as $_deviceId...');
      final uri = Uri.parse(_signalingUrl);
      _socket = await WebSocket.connect(uri.toString()).timeout(const Duration(seconds: 8));

      _isConnecting = false;
      _reconnectAttempts = 0;
      _connectionStateController.add(true);
      debugPrint('[AuraSignaling] Connected to $_signalingUrl');

      // Send DEVICE_REGISTER
      _sendRegister();

      // Start ping heartbeat (7.5s interval per prompt Section 10/14)
      _startHeartbeat();

      _socket!.listen(
        _onMessage,
        onError: (err) {
          debugPrint('[AuraSignaling] Socket error: $err');
          _handleDisconnect();
        },
        onDone: () {
          debugPrint('[AuraSignaling] Socket closed (code: ${_socket?.closeCode})');
          _handleDisconnect();
        },
        cancelOnError: true,
      );
    } catch (e) {
      debugPrint('[AuraSignaling] Failed to connect: $e');
      _isConnecting = false;
      _handleDisconnect();
    }
  }

  Future<void> _connectHttp() async {
    _isHttpSignaling = true;
    _connectionStateController.add(true);
    _reconnectAttempts = 0;
    debugPrint('[AuraSignaling] Starting HTTP Serverless Signaling to $_signalingUrl');

    // 1. Register device
    final regResult = await _httpSend({
      'action': 'register',
      'deviceId': _deviceId,
      'displayName': _displayName,
      'deviceName': _deviceName,
      'platform': 'android',
      'visibility': _visibility,
      'avatarIndex': _avatarIndex,
      'localIp': _localIp,
      'localPort': _localPort,
      'capabilities': ['lan_http_turbo', 'webrtc_direct', 'chunk_stream', 'sha256'],
    });

    if (regResult != null && regResult['peers'] is List) {
      final peersRaw = regResult['peers'] as List;
      final peers = peersRaw
          .whereType<Map>()
          .map((m) => _mapToPeerDevice(Map<String, dynamic>.from(m)))
          .where((p) => p.id != _deviceId)
          .toList();
      if (peers.isNotEmpty) {
        _peerListController.add(peers);
        for (final p in peers) {
          if (!_knownPeerIds.contains(p.id)) {
            _knownPeerIds.add(p.id);
            _peerOnlineController.add(p);
          }
        }
      }
    }

    // 2. Start polling
    _httpPollTimer?.cancel();
    _httpPollTimer = Timer.periodic(const Duration(milliseconds: 1200), (timer) async {
      if (!_shouldReconnect || !_isHttpSignaling) {
        timer.cancel();
        return;
      }
      try {
        final sep = _signalingUrl.contains('?') ? '&' : '?';
        final pollUri = Uri.parse('$_signalingUrl${sep}action=poll&deviceId=${Uri.encodeComponent(_deviceId)}&name=${Uri.encodeComponent(_displayName)}&platform=android&deviceName=${Uri.encodeComponent(_deviceName)}&localIp=${Uri.encodeComponent(_localIp)}&localPort=$_localPort');
        final req = await _httpClient.getUrl(pollUri);
        final resp = await req.close();
        if (resp.statusCode == 200) {
          final body = await resp.transform(utf8.decoder).join();
          final data = jsonDecode(body);
          if (data is Map) {
            final peersRaw = data['peers'];
            if (peersRaw is List) {
              final peers = peersRaw
                  .whereType<Map>()
                  .map((m) => _mapToPeerDevice(Map<String, dynamic>.from(m)))
                  .where((p) => p.id != _deviceId)
                  .toList();
              _peerListController.add(peers);

              for (final p in peers) {
                if (!_knownPeerIds.contains(p.id)) {
                  _knownPeerIds.add(p.id);
                  _peerOnlineController.add(p);
                }
              }
            }
            final msgs = data['messages'];
            if (msgs is List) {
              for (final m in msgs) {
                if (m is Map) {
                  _onMessage(jsonEncode(m));
                }
              }
            }
          }
        }
      } catch (_) {
        // Transient poll network blip
      }
    });
  }

  Future<Map<String, dynamic>?> _httpSend(Map<String, dynamic> data) async {
    try {
      final action = data['action']?.toString() ?? 'send';
      final sep = _signalingUrl.contains('?') ? '&' : '?';
      final uri = Uri.parse('$_signalingUrl${sep}action=$action');
      final req = await _httpClient.postUrl(uri);
      req.headers.contentType = ContentType.json;
      final payload = {
        'action': action,
        ...data,
        'senderId': data['senderId'] ?? _deviceId,
        'deviceId': _deviceId,
      };
      req.add(utf8.encode(jsonEncode(payload)));
      final resp = await req.close();
      if (resp.statusCode == 200) {
        final body = await resp.transform(utf8.decoder).join();
        if (body.trim().isNotEmpty) {
          final decoded = jsonDecode(body);
          if (decoded is Map) {
            return Map<String, dynamic>.from(decoded);
          }
        }
      } else {
        await resp.drain();
      }
    } catch (e) {
      debugPrint('[AuraSignaling] HTTP send notice: $e');
    }
    return null;
  }

  void _sendRegister() {
    _send({
      'type': 'REGISTER',
      'deviceId': _deviceId,
      'displayName': _displayName,
      'deviceName': _deviceName,
      'platform': 'android',
      'visibility': _visibility,
      'avatarIndex': _avatarIndex,
      'localIp': _localIp,
      'localPort': _localPort,
      'protocolVersion': 'P2PFS/1',
      'capabilities': ['lan_http_turbo', 'webrtc_direct', 'chunk_stream', 'sha256'],
    });
  }

  void _startHeartbeat() {
    _stopHeartbeat();
    _heartbeatTimer = Timer.periodic(const Duration(milliseconds: 7500), (_) {
      if (isConnected) {
        _send({
          'type': 'PING',
          'deviceId': _deviceId,
          'timestamp': DateTime.now().millisecondsSinceEpoch,
        });
      }
    });
  }

  void _stopHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
  }

  void _handleDisconnect() {
    _stopHeartbeat();
    _socket = null;
    _connectionStateController.add(false);

    if (_shouldReconnect) {
      _reconnectAttempts++;
      final delaySeconds = (_reconnectAttempts < 5) ? _reconnectAttempts * 2 : 10;
      _reconnectTimer?.cancel();
      _reconnectTimer = Timer(Duration(seconds: delaySeconds), () {
        if (_shouldReconnect && !isConnected) {
          connect();
        }
      });
    }
  }

  void _onMessage(dynamic raw) {
    try {
      final String text = raw is String ? raw : utf8.decode(raw as List<int>);
      final Map<String, dynamic> data = jsonDecode(text);
      final String type = data['type']?.toString() ?? '';

      switch (type) {
        case 'REGISTERED':
          final peersRaw = data['peers'];
          if (peersRaw is List) {
            final peers = peersRaw
                .whereType<Map>()
                .map((m) => _mapToPeerDevice(Map<String, dynamic>.from(m)))
                .where((p) => p.id != _deviceId)
                .toList();
            _peerListController.add(peers);
          }
          break;

        case 'PEER_ONLINE':
          final peerRaw = data['peer'];
          if (peerRaw is Map) {
            final peer = _mapToPeerDevice(Map<String, dynamic>.from(peerRaw));
            if (peer.id != _deviceId) {
              _peerOnlineController.add(peer);
            }
          }
          break;

        case 'PEER_OFFLINE':
          final devId = data['deviceId']?.toString() ?? '';
          if (devId.isNotEmpty) {
            _peerOfflineController.add(devId);
          }
          break;

        case 'SIGNAL':
          final senderId = data['senderId']?.toString() ?? '';
          final signal = data['signal'];
          if (senderId.isNotEmpty && signal is Map) {
            _signalController.add({
              'senderId': senderId,
              'signal': Map<String, dynamic>.from(signal),
            });
          }
          break;

        case 'TRANSFER_REQUEST':
          _transferRequestController.add(data);
          break;

        case 'TRANSFER_ACCEPT':
          _transferAcceptController.add(data);
          break;

        case 'TRANSFER_DECLINE':
          _transferDeclineController.add(data);
          break;

        case 'PONG':
          // Heartbeat acknowledged
          break;
      }
    } catch (e) {
      debugPrint('[AuraSignaling] Error parsing message: $e');
    }
  }

  PeerDevice _mapToPeerDevice(Map<String, dynamic> p) {
    final name = p['displayName']?.toString() ?? p['name']?.toString() ?? 'Device';
    final devName = p['deviceName']?.toString() ?? name;
    final platform = p['platform']?.toString() ?? 'android';
    final id = p['deviceId']?.toString() ?? p['id']?.toString() ?? '';

    return PeerDevice(
      id: id,
      name: name,
      deviceName: devName,
      platform: platform,
      ip: p['ip']?.toString() ?? 'WebRTC P2P',
      port: 0,
      localIp: p['localIp']?.toString() ?? '',
      localPort: (p['localPort'] as num?)?.toInt() ?? 0,
      lastSeen: DateTime.now(),
      avatarIndex: (p['avatarIndex'] as num?)?.toInt() ?? 0,
      transport: 'WebRTC Direct',
      connectionState: 'DISCOVERED',
    );
  }

  void _send(Map<String, dynamic> data) {
    if (!isConnected) return;
    if (_socket != null && _socket!.readyState == WebSocket.open) {
      try {
        _socket!.add(jsonEncode(data));
      } catch (e) {
        debugPrint('[AuraSignaling] WS Send error: $e');
      }
    }
    if (_isHttpSignaling) {
      _httpSend(data);
    }
  }

  // -------------------------------------------------------------
  // Public Signaling Actions
  // -------------------------------------------------------------
  void sendSignal({
    required String targetDeviceId,
    required Map<String, dynamic> signal,
  }) {
    _send({
      'type': 'SIGNAL',
      'senderId': _deviceId,
      'targetDeviceId': targetDeviceId,
      'signal': signal,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });
  }

  void sendTransferRequest({
    required String targetDeviceId,
    required String transferId,
    required String fileName,
    required int totalBytes,
    required int totalFiles,
    required List<Map<String, dynamic>> files,
  }) {
    _send({
      'type': 'TRANSFER_REQUEST',
      'senderId': _deviceId,
      'senderName': _displayName,
      'senderDeviceName': _deviceName,
      'targetDeviceId': targetDeviceId,
      'transferId': transferId,
      'fileName': fileName,
      'totalBytes': totalBytes,
      'totalFiles': totalFiles,
      'files': files,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });
  }

  void sendTransferAccept({
    required String targetDeviceId,
    required String transferId,
  }) {
    _send({
      'type': 'TRANSFER_ACCEPT',
      'senderId': _deviceId,
      'targetDeviceId': targetDeviceId,
      'transferId': transferId,
      'accepted': true,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });
  }

  void sendTransferDecline({
    required String targetDeviceId,
    required String transferId,
    String reason = 'declined_by_user',
  }) {
    _send({
      'type': 'TRANSFER_DECLINE',
      'senderId': _deviceId,
      'targetDeviceId': targetDeviceId,
      'transferId': transferId,
      'accepted': false,
      'reason': reason,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });
  }

  void sendTransferComplete({
    required String targetDeviceId,
    required String transferId,
    required String sha256,
  }) {
    _send({
      'type': 'TRANSFER_COMPLETE',
      'senderId': _deviceId,
      'targetDeviceId': targetDeviceId,
      'transferId': transferId,
      'sha256': sha256,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });
  }

  void updateVisibility(String visibility) {
    _visibility = visibility;
    _send({
      'type': 'VISIBILITY_CHANGE',
      'deviceId': _deviceId,
      'visibility': visibility,
    });
  }

  void disconnect() {
    _shouldReconnect = false;
    _stopHeartbeat();
    _reconnectTimer?.cancel();
    _httpPollTimer?.cancel();
    _isHttpSignaling = false;
    _socket?.close();
    _socket = null;
    _connectionStateController.add(false);
  }
}
