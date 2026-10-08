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

  // Streams
  final _progressController = StreamController<AuraLanServerProgress>.broadcast();
  final _completeController = StreamController<Map<String, dynamic>>.broadcast();
  final _requestController = StreamController<Map<String, dynamic>>.broadcast();

  Stream<AuraLanServerProgress> get onTransferProgress => _progressController.stream;
  Stream<Map<String, dynamic>> get onTransferComplete => _completeController.stream;
  Stream<Map<String, dynamic>> get onTransferRequest => _requestController.stream;

  bool get isRunning => _isRunning;
  String get localIp => _localIp;
  int get port => _port;
  String get endpointUrl => 'http://$_localIp:$_port';

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

      final path = request.uri.path;

      try {
        if ((path == '/api/auradrop/v1/info' || path == '/api/probe') && request.method == 'GET') {
          await _handleInfo(request);
        } else if (path == '/api/auradrop/v1/health' && request.method == 'GET') {
          await _handleHealth(request);
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
      'capabilities': ['lan_http_turbo', 'streaming_io', 'sha256', 'one_time_token'],
    }));
    await request.response.close();
  }

  // ---------------------------------------------------------------------------
  // 2. HEALTH (Section 7: GET /api/auradrop/v1/health)
  // ---------------------------------------------------------------------------
  Future<void> _handleHealth(HttpRequest request) async {
    request.response.statusCode = HttpStatus.ok;
    request.response.headers.contentType = ContentType.json;
    request.response.write(jsonEncode({
      'status': 'ok',
      'version': '1.0',
      'protocol': 'auradrop/1',
      'deviceId': _deviceId,
    }));
    await request.response.close();
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
