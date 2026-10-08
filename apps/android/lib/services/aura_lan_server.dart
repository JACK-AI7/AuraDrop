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
      // 1. Universal CORS & Chrome Private Network Access Headers
      request.response.headers.set('Access-Control-Allow-Origin', '*');
      request.response.headers.set(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, OPTIONS, HEAD',
      );
      request.response.headers.set(
        'Access-Control-Allow-Headers',
        'Content-Type, Content-Length, X-Transfer-Id, X-Session-Token, X-File-Id, X-File-Name, X-File-Size, X-Start-Offset, X-Expected-Sha256, Authorization',
      );
      request.response.headers.set('Access-Control-Allow-Private-Network', 'true');

      if (request.method == 'OPTIONS') {
        request.response.statusCode = HttpStatus.noContent;
        await request.response.close();
        return;
      }

      final path = request.uri.path;

      try {
        if (path == '/api/probe' && request.method == 'GET') {
          await _handleProbe(request);
        } else if (path == '/api/transfer/prepare' && request.method == 'POST') {
          await _handlePrepare(request);
        } else if (path == '/api/transfer/upload' && request.method == 'POST') {
          await _handleUpload(request);
        } else if (path == '/api/transfer/cancel' && request.method == 'POST') {
          await _handleCancel(request);
        } else {
          request.response.statusCode = HttpStatus.notFound;
          request.response.write(jsonEncode({'error': 'Not found'}));
          await request.response.close();
        }
      } catch (err) {
        debugPrint('[AuraLanServer] Error handling $path: $err');
        try {
          request.response.statusCode = HttpStatus.internalServerError;
          request.response.write(jsonEncode({'error': err.toString()}));
          await request.response.close();
        } catch (_) {}
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 1. PROBE (Fast reachability verification by Browser)
  // ---------------------------------------------------------------------------
  Future<void> _handleProbe(HttpRequest request) async {
    request.response.statusCode = HttpStatus.ok;
    request.response.headers.contentType = ContentType.json;
    request.response.write(jsonEncode({
      'status': 'ok',
      'protocol': 'AURADROP_LAN_TURBO/1',
      'deviceId': _deviceId,
      'deviceName': _deviceName,
      'platform': 'android',
      'port': _port,
      'capabilities': ['lan_http_turbo', 'streaming_io', 'sha256'],
    }));
    await request.response.close();
  }

  // ---------------------------------------------------------------------------
  // 2. PREPARE (Negotiate transfer session, token, and trigger system prompt)
  // ---------------------------------------------------------------------------
  Future<void> _handlePrepare(HttpRequest request) async {
    final bodyStr = await utf8.decoder.bind(request).join();
    final data = jsonDecode(bodyStr) as Map<String, dynamic>;

    final transferId = data['transferId']?.toString() ??
        'xfer_${DateTime.now().millisecondsSinceEpoch}';
    final fileName = data['fileName']?.toString() ?? 'download_file';
    final fileSize = (data['fileSize'] as num?)?.toInt() ?? 0;
    final sha256Expected = data['sha256']?.toString() ?? '';
    final senderName = data['senderName']?.toString() ?? 'Sender';

    _preparedSessions[transferId] = {
      'transferId': transferId,
      'fileName': fileName,
      'fileSize': fileSize,
      'sha256': sha256Expected,
      'senderName': senderName,
      'preparedAt': DateTime.now().millisecondsSinceEpoch,
    };

    // Emit notification request event for Android native notification / UI
    _requestController.add(_preparedSessions[transferId]!);

    request.response.statusCode = HttpStatus.ok;
    request.response.headers.contentType = ContentType.json;
    request.response.write(jsonEncode({
      'accepted': true,
      'transferId': transferId,
      'verifiedOffset': 0,
    }));
    await request.response.close();
  }

  // ---------------------------------------------------------------------------
  // 3. UPLOAD (Zero-copy native streaming directly to disk with SHA-256)
  // ---------------------------------------------------------------------------
  Future<void> _handleUpload(HttpRequest request) async {
    final transferId = request.headers.value('x-transfer-id') ??
        request.uri.queryParameters['transferId'] ??
        _activeTransferId ??
        'xfer_stream';

    final session = _preparedSessions[transferId] ?? {};
    final fileName = session['fileName']?.toString() ??
        request.headers.value('x-file-name') ??
        'received_file_${DateTime.now().millisecondsSinceEpoch}';
    final fileSize = (session['fileSize'] as num?)?.toInt() ??
        int.tryParse(request.headers.value('x-file-size') ?? '0') ??
        0;
    final expectedSha = session['sha256']?.toString() ??
        request.headers.value('x-expected-sha256') ??
        '';

    final baseDir = await _getSafeSaveDirectory();
    final sanitizedName = fileName.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_');
    final partFile = File('${baseDir.path}/$sanitizedName.part');
    final finalFile = File('${baseDir.path}/$sanitizedName');

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
        if (nowMs - lastEmitTime > 250) {
          lastEmitTime = nowMs;
          final elapsedSeconds = math.max(0.1, nowMs / 1000.0);
          final speedMBps = (transferredBytes / (1024 * 1024)) / elapsedSeconds;
          final remainingBytes = math.max(0, fileSize - transferredBytes);
          final speedBytes = transferredBytes / elapsedSeconds;
          final etaSeconds = speedBytes > 0 ? (remainingBytes / speedBytes).round() : 0;

          _progressController.add(AuraLanServerProgress(
            transferId: transferId,
            fileName: fileName,
            transferredBytes: transferredBytes,
            totalBytes: fileSize > 0 ? fileSize : transferredBytes,
            speedMBps: speedMBps,
            etaSeconds: etaSeconds,
            state: 'TRANSFERRING',
          ));
        }
      }

      await sink.flush();
      await sink.close();
      _activeUploadSink = null;
      hashSink.close();

      final computedHash = outputDigest.events.isNotEmpty
          ? outputDigest.events.first.toString()
          : '';

      // Verify SHA-256 integrity
      if (expectedSha.isNotEmpty && computedHash.isNotEmpty && computedHash != expectedSha) {
        if (await partFile.exists()) await partFile.delete();
        request.response.statusCode = HttpStatus.badRequest;
        request.response.headers.contentType = ContentType.json;
        request.response.write(jsonEncode({
          'success': false,
          'error': 'SHA-256 hash mismatch! Expected: $expectedSha, Computed: $computedHash',
        }));
        await request.response.close();
        return;
      }

      // Rename .part file to final filename on successful integrity verification
      if (await finalFile.exists()) {
        await finalFile.delete();
      }
      await partFile.rename(finalFile.path);

      _completeController.add({
        'transferId': transferId,
        'fileName': fileName,
        'filePath': finalFile.path,
        'fileSize': transferredBytes,
        'sha256': computedHash,
        'transport': 'Direct LAN',
      });

      _progressController.add(AuraLanServerProgress(
        transferId: transferId,
        fileName: fileName,
        transferredBytes: transferredBytes,
        totalBytes: transferredBytes,
        speedMBps: 0,
        etaSeconds: 0,
        state: 'COMPLETED',
      ));

      request.response.statusCode = HttpStatus.ok;
      request.response.headers.contentType = ContentType.json;
      request.response.write(jsonEncode({
        'success': true,
        'transferId': transferId,
        'filePath': finalFile.path,
        'sha256': computedHash,
        'verified': true,
      }));
      await request.response.close();
    } catch (err) {
      await sink.close();
      _activeUploadSink = null;
      if (await partFile.exists()) await partFile.delete();
      rethrow;
    } finally {
      _preparedSessions.remove(transferId);
      _activeTransferId = null;
    }
  }

  // ---------------------------------------------------------------------------
  // 4. CANCEL
  // ---------------------------------------------------------------------------
  Future<void> _handleCancel(HttpRequest request) async {
    final transferId = request.headers.value('x-transfer-id') ?? _activeTransferId ?? '';
    await _activeUploadSink?.close();
    _activeUploadSink = null;

    if (_activePartFile != null && await _activePartFile!.exists()) {
      await _activePartFile!.delete();
    }
    _activePartFile = null;
    _preparedSessions.remove(transferId);

    request.response.statusCode = HttpStatus.ok;
    request.response.headers.contentType = ContentType.json;
    request.response.write(jsonEncode({'success': true, 'cancelled': transferId}));
    await request.response.close();
  }

  Future<Directory> _getSafeSaveDirectory() async {
    try {
      final ext = await getExternalStorageDirectory();
      if (ext != null) {
        final downloadDir = Directory('${ext.path}/Download');
        if (!await downloadDir.exists()) await downloadDir.create(recursive: true);
        return downloadDir;
      }
    } catch (_) {}
    return await getApplicationDocumentsDirectory();
  }
}
