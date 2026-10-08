import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'package:convert/convert.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

class AuraLanServerProgress {
  final String transferId;
  final String fileName;
  final int transferredBytes;
  final int totalBytes;
  final double speedMBps;
  final int etaSeconds;
  final String state;

  AuraLanServerProgress({
    required this.transferId,
    required this.fileName,
    required this.transferredBytes,
    required this.totalBytes,
    required this.speedMBps,
    required this.etaSeconds,
    required this.state,
  });
}

class AuraLanServer {
  static final AuraLanServer _instance = AuraLanServer._internal();
  factory AuraLanServer() => _instance;
  AuraLanServer._internal();

  HttpServer? _server;
  String _deviceId = '';
  String _deviceName = '';
  String _localIp = '127.0.0.1';
  int _port = 53317;
  bool _isRunning = false;

  final Map<String, Map<String, dynamic>> _preparedSessions = {};
  IOSink? _activeUploadSink;
  File? _activePartFile;
  String? _activeTransferId;

  // V26 Local-First Bootstrap & WebSockets
  String _activeBootstrapToken = '';
  int _bootstrapTokenExpiresAt = 0;
  final Map<String, String> _activeSessionTokens = {};
  final Set<String> _trustedDevices = {};
  final Map<String, WebSocket> _connectedLocalWebSockets = {};

  // Streams
  final _progressController = StreamController<AuraLanServerProgress>.broadcast();
  final _completeController = StreamController<Map<String, dynamic>>.broadcast();
  final _requestController = StreamController<Map<String, dynamic>>.broadcast();
  final _localSignalController = StreamController<Map<String, dynamic>>.broadcast();
  final _localPeerConnectedController = StreamController<Map<String, dynamic>>.broadcast();
  final _localPeerDisconnectedController = StreamController<String>.broadcast();

  Stream<AuraLanServerProgress> get onTransferProgress => _progressController.stream;
  Stream<Map<String, dynamic>> get onTransferComplete => _completeController.stream;
  Stream<Map<String, dynamic>> get onTransferRequest => _requestController.stream;
  Stream<Map<String, dynamic>> get onLocalSignal => _localSignalController.stream;
  Stream<Map<String, dynamic>> get onLocalPeerConnected => _localPeerConnectedController.stream;
  Stream<String> get onLocalPeerDisconnected => _localPeerDisconnectedController.stream;

  bool get isRunning => _isRunning;
  String get localIp => _localIp;
  int get port => _port;
  String get endpointUrl => 'http://$_localIp:$_port';

  bool hasLocalClient(String deviceId) =>
      _connectedLocalWebSockets.containsKey(deviceId) &&
      _connectedLocalWebSockets[deviceId]?.readyState == WebSocket.open;

  void trustDevice(String deviceId) => _trustedDevices.add(deviceId);
  bool isDeviceTrusted(String deviceId) => _trustedDevices.contains(deviceId);

  String generateBootstrapToken() {
    _activeBootstrapToken = _generateSecureToken();
    _bootstrapTokenExpiresAt = DateTime.now().millisecondsSinceEpoch + 120000; // 2 minutes TTL
    return _activeBootstrapToken;
  }

  Map<String, dynamic> getQrPayload() {
    final now = DateTime.now().millisecondsSinceEpoch;
    if (_activeBootstrapToken.isEmpty || now >= _bootstrapTokenExpiresAt) {
      generateBootstrapToken();
    }
    return {
      'protocol': 'AURADROP_LOCAL_V1',
      'deviceId': _deviceId,
      'deviceName': _deviceName,
      'hostname': 'auradrop-${_deviceId.substring(0, math.min(6, _deviceId.length))}.local',
      'ip': _localIp,
      'port': _port,
      'bootstrapToken': _activeBootstrapToken,
      'expiresAt': _bootstrapTokenExpiresAt,
    };
  }

  bool sendLocalMessage(String targetDeviceId, Map<String, dynamic> message) {
    final ws = _connectedLocalWebSockets[targetDeviceId];
    if (ws != null && ws.readyState == WebSocket.open) {
      try {
        ws.add(jsonEncode(message));
        return true;
      } catch (e) {
        debugPrint('[AuraLanServer] Failed to send local message: $e');
      }
    }
    return false;
  }

  bool sendLocalSignal(String targetDeviceId, Map<String, dynamic> signal) {
    return sendLocalMessage(targetDeviceId, {
      'type': 'SIGNAL',
      'senderId': _deviceId,
      'targetDeviceId': targetDeviceId,
      'signal': signal,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });
  }

  String _generateSecureToken() {
    final random = math.Random.secure();
    final values = List<int>.generate(16, (i) => random.nextInt(256));
    return hex.encode(values);
  }

  Future<void> start({
    required String deviceId,
    required String deviceName,
    int preferredPort = 53317,
  }) async {
    if (_isRunning) return;
    _deviceId = deviceId;
    _deviceName = deviceName;

    await _resolveLocalIp();

    try {
      try {
        _server = await HttpServer.bind(InternetAddress.anyIPv4, preferredPort);
        _port = preferredPort;
      } catch (_) {
        // Fallback to automatic OS-assigned available port
        _server = await HttpServer.bind(InternetAddress.anyIPv4, 0);
        _port = _server!.port;
      }

      _isRunning = true;
      debugPrint('[AuraLanServer] Listening on http://$_localIp:$_port');
      _listenRequests();
    } catch (e) {
      debugPrint('[AuraLanServer] Failed to bind HTTP server: $e');
      _isRunning = false;
    }
  }

  Future<void> stop() async {
    _isRunning = false;
    for (final ws in _connectedLocalWebSockets.values) {
      try {
        ws.close(WebSocketStatus.goingAway, 'Server stopping');
      } catch (_) {}
    }
    _connectedLocalWebSockets.clear();
    await _activeUploadSink?.close();
    _activeUploadSink = null;
    await _server?.close(force: true);
    _server = null;
    _preparedSessions.clear();
  }

  Future<void> _resolveLocalIp() async {
    try {
      final interfaces = await NetworkInterface.list(
        includeLoopback: false,
        type: InternetAddressType.IPv4,
      );
      for (final iface in interfaces) {
        for (final addr in iface.addresses) {
          final ip = addr.address;
          if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
            _localIp = ip;
            return;
          }
        }
      }
      if (interfaces.isNotEmpty && interfaces.first.addresses.isNotEmpty) {
        _localIp = interfaces.first.addresses.first.address;
      }
    } catch (e) {
      debugPrint('[AuraLanServer] Error resolving local IP: $e');
    }
  }

  void _listenRequests() {
    _server?.listen((HttpRequest request) async {
      // Chrome Private Network Access & CORS Headers
      final origin = request.headers.value('origin') ?? '*';
      request.response.headers.set('Access-Control-Allow-Origin', origin);
      request.response.headers.set(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, OPTIONS, HEAD',
      );
      request.response.headers.set(
        'Access-Control-Allow-Headers',
        '*',
      );
      request.response.headers.set('Access-Control-Allow-Private-Network', 'true');
      request.response.headers.set('Access-Control-Allow-Credentials', 'true');

      if (request.method == 'OPTIONS') {
        request.response.statusCode = HttpStatus.noContent;
        await request.response.close();
        return;
      }

      // Check for WebSocket upgrade request (e.g. /ws or any path from Chrome)
      if (WebSocketTransformer.isUpgradeRequest(request)) {
        try {
          final socket = await WebSocketTransformer.upgrade(request);
          _handleWebSocketConnection(socket, request);
          return;
        } catch (e) {
          debugPrint('[AuraLanServer] WebSocket upgrade failed: $e');
          return;
        }
      }

      final path = request.uri.path;

      try {
        if ((path == '/api/auradrop/v1/info' || path == '/api/probe') && request.method == 'GET') {
          await _handleInfo(request);
        } else if (path == '/api/auradrop/v1/health' && request.method == 'GET') {
          await _handleHealth(request);
        } else if (path == '/api/auradrop/v1/bootstrap' && request.method == 'GET') {
          await _handleBootstrap(request);
        } else if (path == '/api/auradrop/v1/pair' && request.method == 'POST') {
          await _handlePair(request);
        } else if ((path == '/api/auradrop/v1/prepare-upload' || path == '/api/transfer/prepare') && request.method == 'POST') {
          await _handlePrepareUpload(request);
        } else if ((path == '/api/auradrop/v1/upload' || path == '/api/transfer/upload') && request.method == 'POST') {
          await _handleUpload(request);
        } else if ((path == '/api/auradrop/v1/cancel' || path == '/api/transfer/cancel') && request.method == 'POST') {
          await _handleCancel(request);
        } else {
          request.response.statusCode = HttpStatus.notFound;
          request.response.headers.contentType = ContentType.json;
          request.response.write(jsonEncode({'error': 'Not found', 'path': path}));
          await request.response.close();
        }
      } catch (err) {
        debugPrint('[AuraLanServer] Error handling $path: $err');
        try {
          request.response.statusCode = HttpStatus.internalServerError;
          request.response.headers.contentType = ContentType.json;
          request.response.write(jsonEncode({'error': err.toString()}));
          await request.response.close();
        } catch (_) {}
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 1. INFO / PROBE (Section 7: GET /api/auradrop/v1/info)
  // ---------------------------------------------------------------------------
  Future<void> _handleInfo(HttpRequest request) async {
    request.response.statusCode = HttpStatus.ok;
    request.response.headers.contentType = ContentType.json;
    request.response.write(jsonEncode({
      'deviceId': _deviceId,
      'deviceName': _deviceName,
      'platform': 'android',
      'protocol': 'auradrop/1',
      'port': _port,
      'upload': true,
      'version': '1.0',
      'status': 'ok',
      'capabilities': ['lan_http_turbo', 'streaming_io', 'sha256', 'one_time_token', 'local_ws_signaling'],
    }));
    await request.response.close();
  }

  // ---------------------------------------------------------------------------
  // 2. HEALTH (GET /api/auradrop/v1/health)
  // ---------------------------------------------------------------------------
  Future<void> _handleHealth(HttpRequest request) async {
    request.response.statusCode = HttpStatus.ok;
    request.response.headers.contentType = ContentType.json;
    request.response.write(jsonEncode({
      'status': 'ok',
      'version': '1.0',
      'protocol': 'AURADROP_LOCAL_V1',
      'deviceId': _deviceId,
      'deviceName': _deviceName,
      'ip': _localIp,
      'port': _port,
    }));
    await request.response.close();
  }

  // ---------------------------------------------------------------------------
  // 2b. BOOTSTRAP (GET /api/auradrop/v1/bootstrap)
  // ---------------------------------------------------------------------------
  Future<void> _handleBootstrap(HttpRequest request) async {
    request.response.statusCode = HttpStatus.ok;
    request.response.headers.contentType = ContentType.json;
    request.response.write(jsonEncode(getQrPayload()));
    await request.response.close();
  }

  // ---------------------------------------------------------------------------
  // 2c. PAIR (POST /api/auradrop/v1/pair)
  // ---------------------------------------------------------------------------
  Future<void> _handlePair(HttpRequest request) async {
    final bodyStr = await utf8.decoder.bind(request).join();
    final data = jsonDecode(bodyStr) as Map<String, dynamic>;
    final clientDeviceId = data['deviceId']?.toString() ?? '';
    final clientDeviceName = data['deviceName']?.toString() ?? 'Desktop Browser';
    final providedToken = data['bootstrapToken']?.toString() ?? data['token']?.toString() ?? '';

    final now = DateTime.now().millisecondsSinceEpoch;
    final isValidToken = providedToken.isNotEmpty &&
        (providedToken == _activeBootstrapToken && now <= _bootstrapTokenExpiresAt);

    if (!isValidToken && !_trustedDevices.contains(clientDeviceId)) {
      request.response.statusCode = HttpStatus.unauthorized;
      request.response.headers.contentType = ContentType.json;
      request.response.write(jsonEncode({
        'error': 'Invalid or expired bootstrap token',
        'protocol': 'AURADROP_LOCAL_V1',
      }));
      await request.response.close();
      return;
    }

    final sessionToken = _generateSecureToken();
    _activeSessionTokens[clientDeviceId] = sessionToken;
    _trustedDevices.add(clientDeviceId);

    request.response.statusCode = HttpStatus.ok;
    request.response.headers.contentType = ContentType.json;
    request.response.write(jsonEncode({
      'success': true,
      'deviceId': _deviceId,
      'deviceName': _deviceName,
      'sessionToken': sessionToken,
      'protocol': 'AURADROP_LOCAL_V1',
      'port': _port,
    }));
    await request.response.close();

    _localPeerConnectedController.add({
      'deviceId': clientDeviceId,
      'deviceName': clientDeviceName,
      'platform': 'web',
      'ip': request.connectionInfo?.remoteAddress.address ?? 'LAN',
      'port': 0,
      'isLocal': true,
    });
  }

  // ---------------------------------------------------------------------------
  // 2d. LOCAL WEBSOCKET CONNECTION HANDLER
  // ---------------------------------------------------------------------------
  void _handleWebSocketConnection(WebSocket socket, HttpRequest request) {
    String? authenticatedDeviceId;

    socket.listen(
      (raw) {
        try {
          final message = jsonDecode(raw.toString()) as Map<String, dynamic>;
          final type = message['type']?.toString();

          if (type == 'AUTH') {
            final clientDeviceId = message['deviceId']?.toString() ?? '';
            final clientDeviceName = message['deviceName']?.toString() ?? 'Desktop Browser';
            final token = message['token']?.toString() ?? message['bootstrapToken']?.toString() ?? '';

            final now = DateTime.now().millisecondsSinceEpoch;
            final isBootstrapValid =
                token.isNotEmpty && token == _activeBootstrapToken && now <= _bootstrapTokenExpiresAt;
            final isSessionValid = token.isNotEmpty && _activeSessionTokens[clientDeviceId] == token;
            final isTrusted = _trustedDevices.contains(clientDeviceId);

            if (isBootstrapValid || isSessionValid || isTrusted) {
              authenticatedDeviceId = clientDeviceId;
              _trustedDevices.add(clientDeviceId);
              _connectedLocalWebSockets[clientDeviceId] = socket;

              final sessionToken = isSessionValid ? token : _generateSecureToken();
              _activeSessionTokens[clientDeviceId] = sessionToken;

              socket.add(jsonEncode({
                'type': 'AUTH_OK',
                'deviceId': _deviceId,
                'deviceName': _deviceName,
                'sessionToken': sessionToken,
                'protocol': 'AURADROP_LOCAL_V1',
              }));

              _localPeerConnectedController.add({
                'deviceId': clientDeviceId,
                'deviceName': clientDeviceName,
                'platform': 'web',
                'ip': request.connectionInfo?.remoteAddress.address ?? 'LAN',
                'port': 0,
                'isLocal': true,
              });
              debugPrint('[AuraLanServer] Local WebSocket client authenticated: $clientDeviceId ($clientDeviceName)');
            } else {
              socket.add(jsonEncode({
                'type': 'AUTH_FAIL',
                'error': 'Invalid token or untrusted device',
              }));
              socket.close(WebSocketStatus.policyViolation, 'Authentication failed');
            }
          } else if (type == 'SIGNAL') {
            final targetDeviceId = message['targetDeviceId']?.toString() ?? '';
            final signal = message['signal'];
            final senderId = authenticatedDeviceId ?? message['senderId']?.toString() ?? '';

            if (signal is Map<String, dynamic> && senderId.isNotEmpty) {
              _localSignalController.add({
                'senderId': senderId,
                'targetDeviceId': targetDeviceId,
                'signal': signal,
              });
            }
          } else if (type == 'PING') {
            socket.add(jsonEncode({
              'type': 'PONG',
              'timestamp': DateTime.now().millisecondsSinceEpoch,
            }));
          }
        } catch (e) {
          debugPrint('[AuraLanServer] Error handling WS message: $e');
        }
      },
      onDone: () {
        if (authenticatedDeviceId != null) {
          _connectedLocalWebSockets.remove(authenticatedDeviceId);
          _localPeerDisconnectedController.add(authenticatedDeviceId!);
          debugPrint('[AuraLanServer] Local WebSocket client disconnected: $authenticatedDeviceId');
        }
      },
      onError: (e) {
        if (authenticatedDeviceId != null) {
          _connectedLocalWebSockets.remove(authenticatedDeviceId);
          _localPeerDisconnectedController.add(authenticatedDeviceId!);
        }
      },
    );
  }

  // ---------------------------------------------------------------------------
  // 3. PREPARE UPLOAD (Section 7 & 8: POST /api/auradrop/v1/prepare-upload)
  // Generates single-use expiring oneTimeToken (60s TTL)
  // ---------------------------------------------------------------------------
  Future<void> _handlePrepareUpload(HttpRequest request) async {
    final bodyStr = await utf8.decoder.bind(request).join();
    final data = jsonDecode(bodyStr) as Map<String, dynamic>;

    final transferId = data['transferId']?.toString() ??
        'xfer_${DateTime.now().millisecondsSinceEpoch}';
    final fileId = data['fileId']?.toString() ?? transferId;
    final fileName = data['fileName']?.toString() ?? 'download_file';
    final fileSize = (data['fileSize'] as num?)?.toInt() ?? 0;
    final sha256Expected = data['sha256']?.toString() ?? '';
    final senderUserId = data['senderUserId']?.toString() ?? data['senderName']?.toString() ?? 'Sender';
    final receiverUserId = data['receiverUserId']?.toString() ?? _deviceId;

    final token = _generateSecureToken();
    final expiresAt = DateTime.now().millisecondsSinceEpoch + 60000; // 60 seconds TTL

    _preparedSessions[transferId] = {
      'transferId': transferId,
      'fileId': fileId,
      'fileName': fileName,
      'fileSize': fileSize,
      'sha256': sha256Expected,
      'senderUserId': senderUserId,
      'receiverUserId': receiverUserId,
      'senderName': senderUserId,
      'oneTimeToken': token,
      'expiresAt': expiresAt,
      'used': false,
      'preparedAt': DateTime.now().millisecondsSinceEpoch,
    };

    // Emit event for Android native heads-up notification / UI
    _requestController.add(_preparedSessions[transferId]!);

    request.response.statusCode = HttpStatus.ok;
    request.response.headers.contentType = ContentType.json;
    request.response.write(jsonEncode({
      'accepted': true,
      'transferId': transferId,
      'fileId': fileId,
      'oneTimeToken': token,
      'expiresAt': expiresAt,
      'protocol': 'auradrop/1',
    }));
    await request.response.close();
  }

  // ---------------------------------------------------------------------------
  // 4. UPLOAD (Section 7 & 8: POST /api/auradrop/v1/upload)
  // Validates oneTimeToken, single-use, streaming to .part with SHA-256
  // ---------------------------------------------------------------------------
  Future<void> _handleUpload(HttpRequest request) async {
    final transferId = request.headers.value('x-transfer-id') ??
        request.uri.queryParameters['transferId'] ??
        _activeTransferId ??
        '';

    final providedToken = request.headers.value('x-one-time-token') ??
        request.uri.queryParameters['token'] ??
        request.headers.value('x-session-token') ??
        '';

    final session = _preparedSessions[transferId];
    if (session == null) {
      request.response.statusCode = HttpStatus.forbidden;
      request.response.headers.contentType = ContentType.json;
      request.response.write(jsonEncode({'error': 'Transfer session not found or unauthorized'}));
      await request.response.close();
      return;
    }

    final now = DateTime.now().millisecondsSinceEpoch;
    final expiresAt = (session['expiresAt'] as num?)?.toInt() ?? 0;
    if (now > expiresAt) {
      request.response.statusCode = HttpStatus.unauthorized;
      request.response.headers.contentType = ContentType.json;
      request.response.write(jsonEncode({'error': 'One-time token expired'}));
      await request.response.close();
      return;
    }

    final expectedToken = session['oneTimeToken']?.toString() ?? '';
    if (providedToken.isNotEmpty && expectedToken.isNotEmpty && providedToken != expectedToken) {
      request.response.statusCode = HttpStatus.forbidden;
      request.response.headers.contentType = ContentType.json;
      request.response.write(jsonEncode({'error': 'Invalid one-time token'}));
      await request.response.close();
      return;
    }

    if (session['used'] == true) {
      request.response.statusCode = HttpStatus.forbidden;
      request.response.headers.contentType = ContentType.json;
      request.response.write(jsonEncode({'error': 'Token already used (single-use enforced)'}));
      await request.response.close();
      return;
    }

    // Invalidate token immediately to enforce single-use
    session['used'] = true;

    final fileName = session['fileName']?.toString() ??
        request.headers.value('x-file-name') ??
        'received_file_${DateTime.now().millisecondsSinceEpoch}';
    final fileSize = (session['fileSize'] as num?)?.toInt() ??
        int.tryParse(request.headers.value('x-file-size') ?? '0') ??
        0;
    final expectedSha = session['sha256']?.toString() ??
        request.headers.value('x-expected-sha256') ??
        '';

    // Prepare destination file paths
    final directory = await _getDownloadDirectory();
    final safeName = _sanitizeFileName(fileName);
    final partFile = File('${directory.path}/$safeName.part');
    final finalFile = File('${directory.path}/$safeName');

    if (await partFile.exists()) {
      await partFile.delete();
    }

    _activePartFile = partFile;
    _activeTransferId = transferId;
    final sink = partFile.openWrite(mode: FileMode.writeOnly);
    _activeUploadSink = sink;

    final outputDigest = AccumulatorSink<Digest>();
    final hashSink = sha256.startChunkedConversion(outputDigest);

    int transferredBytes = 0;
    final stopwatch = Stopwatch()..start();
    int lastEmitTime = 0;

    try {
      await for (final chunk in request) {
        sink.add(chunk);
        hashSink.add(chunk);
        transferredBytes += chunk.length;

        final nowMs = stopwatch.elapsedMilliseconds;
        if (nowMs - lastEmitTime >= 100 || transferredBytes == fileSize) {
          final elapsedSeconds = math.max(0.001, nowMs / 1000.0);
          final speedMBps = (transferredBytes / (1024 * 1024)) / elapsedSeconds;
          final remainingBytes = math.max(0, fileSize - transferredBytes);
          final speedBytes = transferredBytes / elapsedSeconds;
          final eta = speedBytes > 0 ? (remainingBytes / speedBytes).ceil() : 0;

          _progressController.add(AuraLanServerProgress(
            transferId: transferId,
            fileName: safeName,
            transferredBytes: transferredBytes,
            totalBytes: fileSize,
            speedMBps: speedMBps,
            etaSeconds: eta,
            state: 'TRANSFERRING',
          ));
          lastEmitTime = nowMs;
        }
      }

      await sink.flush();
      await sink.close();
      hashSink.close();
      _activeUploadSink = null;

      final calculatedSha = outputDigest.events.single.toString();

      // Verify SHA-256 checksum
      if (expectedSha.isNotEmpty && calculatedSha.toLowerCase() != expectedSha.toLowerCase()) {
        if (await partFile.exists()) await partFile.delete();
        request.response.statusCode = HttpStatus.badRequest;
        request.response.headers.contentType = ContentType.json;
        request.response.write(jsonEncode({
          'error': 'SHA-256 integrity mismatch',
          'expected': expectedSha,
          'calculated': calculatedSha,
        }));
        await request.response.close();
        return;
      }

      // Atomic rename: .part -> final file
      if (await finalFile.exists()) {
        await finalFile.delete();
      }
      await partFile.rename(finalFile.path);

      _completeController.add({
        'transferId': transferId,
        'fileName': safeName,
        'filePath': finalFile.path,
        'fileSize': transferredBytes,
        'sha256': calculatedSha,
        'verified': true,
      });

      _preparedSessions.remove(transferId);
      _activePartFile = null;
      _activeTransferId = null;

      request.response.statusCode = HttpStatus.ok;
      request.response.headers.contentType = ContentType.json;
      request.response.write(jsonEncode({
        'status': 'ok',
        'transferId': transferId,
        'sha256': calculatedSha,
        'bytesWritten': transferredBytes,
        'verified': true,
      }));
      await request.response.close();
    } catch (e) {
      await sink.close();
      _activeUploadSink = null;
      if (await partFile.exists()) {
        await partFile.delete();
      }
      rethrow;
    }
  }

  // ---------------------------------------------------------------------------
  // 5. CANCEL (Section 7: POST /api/auradrop/v1/cancel)
  // ---------------------------------------------------------------------------
  Future<void> _handleCancel(HttpRequest request) async {
    final bodyStr = await utf8.decoder.bind(request).join();
    String transferId = '';
    try {
      final data = jsonDecode(bodyStr) as Map<String, dynamic>;
      transferId = data['transferId']?.toString() ?? '';
    } catch (_) {}

    if (transferId.isEmpty) {
      transferId = request.headers.value('x-transfer-id') ?? _activeTransferId ?? '';
    }

    await _activeUploadSink?.close();
    _activeUploadSink = null;

    if (_activePartFile != null && await _activePartFile!.exists()) {
      await _activePartFile!.delete();
    }
    _activePartFile = null;
    _preparedSessions.remove(transferId);
    _activeTransferId = null;

    request.response.statusCode = HttpStatus.ok;
    request.response.headers.contentType = ContentType.json;
    request.response.write(jsonEncode({'status': 'cancelled', 'transferId': transferId}));
    await request.response.close();
  }

  Future<Directory> _getDownloadDirectory() async {
    try {
      if (Platform.isAndroid) {
        final dir = Directory('/storage/emulated/0/Download/AuraDrop');
        if (!await dir.exists()) {
          await dir.create(recursive: true);
        }
        return dir;
      }
      if (Platform.isWindows) {
        final userProfile = Platform.environment['USERPROFILE'] ?? '';
        final downloads = userProfile.isNotEmpty ? '$userProfile\\Downloads\\AuraDrop' : '';
        if (downloads.isNotEmpty) {
          final dir = Directory(downloads);
          if (!await dir.exists()) await dir.create(recursive: true);
          return dir;
        }
      }
      final appDir = await getApplicationDocumentsDirectory();
      final dropDir = Directory('${appDir.path}/AuraDrop');
      if (!await dropDir.exists()) {
        await dropDir.create(recursive: true);
      }
      return dropDir;
    } catch (_) {
      return getTemporaryDirectory();
    }
  }

  String _sanitizeFileName(String name) {
    return name.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_');
  }
}
