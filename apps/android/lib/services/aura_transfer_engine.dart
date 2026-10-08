import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import '../models/models.dart';
import 'aura_identity_service.dart';
import 'aura_lan_server.dart';

class TransferProgressInfo {
  final String transferId;
  final String fileName;
  final int transferredBytes;
  final int totalBytes;
  final double speedMBps;
  final int etaSeconds;
  final bool isSender;
  final String state;

  TransferProgressInfo({
    required this.transferId,
    required this.fileName,
    required this.transferredBytes,
    required this.totalBytes,
    required this.speedMBps,
    required this.etaSeconds,
    required this.isSender,
    required this.state,
  });

  double get percent => totalBytes > 0 ? (transferredBytes / totalBytes).clamp(0.0, 1.0) : 0.0;
}

class AuraTransferEngine {
  static final AuraTransferEngine _instance = AuraTransferEngine._internal();
  factory AuraTransferEngine() => _instance;
  AuraTransferEngine._internal();

  final _httpClient = HttpClient()
    ..connectionTimeout = const Duration(seconds: 10)
    ..badCertificateCallback = ((cert, host, port) => true);

  HttpClientRequest? _activeSendRequest;
  bool _isCancelled = false;

  final _progressController = StreamController<TransferProgressInfo>.broadcast();
  final _completedController = StreamController<Map<String, dynamic>>.broadcast();
  final _errorController = StreamController<String>.broadcast();

  Stream<TransferProgressInfo> get onProgress => _progressController.stream;
  Stream<Map<String, dynamic>> get onCompleted => _completedController.stream;
  Stream<String> get onError => _errorController.stream;

  void init() {
    // Pipe receiver progress events from AuraLanServer
    AuraLanServer().onTransferProgress.listen((p) {
      _progressController.add(TransferProgressInfo(
        transferId: p.transferId,
        fileName: p.fileName,
        transferredBytes: p.transferredBytes,
        totalBytes: p.totalBytes,
        speedMBps: p.speedMBps,
        etaSeconds: p.etaSeconds,
        isSender: false,
        state: p.state,
      ));
    });

    AuraLanServer().onTransferComplete.listen((c) {
      _completedController.add({
        ...c,
        'isSender': false,
      });
    });
  }

  void cancelActiveTransfer() {
    _isCancelled = true;
    try {
      _activeSendRequest?.abort();
    } catch (_) {}
    _activeSendRequest = null;
  }

  Future<bool> sendFile({
    required PeerDevice target,
    required String filePath,
    required String fileName,
    int? fileSize,
  }) async {
    _isCancelled = false;
    if (filePath.isEmpty) {
      _errorController.add('Invalid file path');
      return false;
    }

    final localFile = File(filePath);
    if (!await localFile.exists()) {
      _errorController.add('File does not exist: $fileName');
      return false;
    }

    final resolvedFileSize = fileSize ?? await localFile.length();
    final transferId = 'tr_${DateTime.now().millisecondsSinceEpoch}_${math.Random().nextInt(9999)}';

    debugPrint('[AuraTransfer] Preparing transfer of $fileName ($resolvedFileSize bytes) to ${target.name} (${target.ip}:${target.port})');

    // 1. Calculate SHA-256 incrementally (bounded RAM)
    _progressController.add(TransferProgressInfo(
      transferId: transferId,
      fileName: fileName,
      transferredBytes: 0,
      totalBytes: resolvedFileSize,
      speedMBps: 0.0,
      etaSeconds: 0,
      isSender: true,
      state: 'VERIFYING',
    ));

    String expectedSha = '';
    try {
      final digest = await localFile.openRead().transform(sha256).single;
      expectedSha = digest.toString();
    } catch (e) {
      _errorController.add('Error computing SHA-256: $e');
      return false;
    }

    if (_isCancelled) return false;

    // 2. Handshake / Prepare Upload Request
    _progressController.add(TransferProgressInfo(
      transferId: transferId,
      fileName: fileName,
      transferredBytes: 0,
      totalBytes: resolvedFileSize,
      speedMBps: 0.0,
      etaSeconds: 0,
      isSender: true,
      state: 'WAITING_FOR_ACCEPT',
    ));

    final identity = AuraIdentityService();
    String oneTimeToken = '';

    try {
      final prepareUrl = Uri.parse('http://${target.ip}:${target.port}/api/auradrop/v1/prepare-upload');
      final prepareReq = await _httpClient.postUrl(prepareUrl);
      prepareReq.headers.contentType = ContentType.json;

      final preparePayload = jsonEncode({
        'transferId': transferId,
        'fileName': fileName,
        'fileSize': resolvedFileSize,
        'sha256': expectedSha,
        'senderUserId': identity.deviceId,
        'senderName': identity.deviceName,
        'senderPlatform': identity.platform,
        'receiverUserId': target.id,
      });

      prepareReq.write(preparePayload);
      final prepareResp = await prepareReq.close().timeout(const Duration(seconds: 45));

      if (prepareResp.statusCode != HttpStatus.ok) {
        _errorController.add('Recipient declined or unavailable');
        return false;
      }

      final prepareBody = await prepareResp.transform(utf8.decoder).join();
      final prepareData = jsonDecode(prepareBody);

      if (prepareData['accepted'] != true) {
        _errorController.add('Transfer declined by recipient');
        return false;
      }

      oneTimeToken = prepareData['oneTimeToken']?.toString() ?? '';
    } catch (e) {
      _errorController.add('Failed to establish connection with ${target.name}: $e');
      return false;
    }

    if (_isCancelled) return false;

    // 3. Streaming Binary Upload directly over LAN socket
    _progressController.add(TransferProgressInfo(
      transferId: transferId,
      fileName: fileName,
      transferredBytes: 0,
      totalBytes: resolvedFileSize,
      speedMBps: 0.0,
      etaSeconds: 0,
      isSender: true,
      state: 'TRANSFERRING',
    ));

    try {
      final uploadUrl = Uri.parse('http://${target.ip}:${target.port}/api/auradrop/v1/upload?transferId=$transferId');
      final uploadReq = await _httpClient.postUrl(uploadUrl);
      _activeSendRequest = uploadReq;

      uploadReq.headers.set('x-transfer-id', transferId);
      uploadReq.headers.set('x-one-time-token', oneTimeToken);
      uploadReq.headers.set('x-file-name', Uri.encodeComponent(fileName));
      uploadReq.headers.set('x-file-size', resolvedFileSize.toString());
      uploadReq.headers.set('x-expected-sha256', expectedSha);
      uploadReq.contentLength = resolvedFileSize;

      int bytesSent = 0;
      final stopwatch = Stopwatch()..start();
      int lastEmit = 0;

      // Stream file in 64KB chunks directly into HTTP socket
      final fileStream = localFile.openRead();
      await for (final chunk in fileStream) {
        if (_isCancelled) {
          uploadReq.abort();
          return false;
        }

        uploadReq.add(chunk);
        bytesSent += chunk.length;

        final nowMs = stopwatch.elapsedMilliseconds;
        if (nowMs - lastEmit >= 100 || bytesSent == resolvedFileSize) {
          final elapsedSeconds = math.max(0.001, nowMs / 1000.0);
          final speedMBps = (bytesSent / (1024 * 1024)) / elapsedSeconds;
          final remainingBytes = math.max(0, resolvedFileSize - bytesSent);
          final speedBytes = bytesSent / elapsedSeconds;
          final eta = speedBytes > 0 ? (remainingBytes / speedBytes).ceil() : 0;

          _progressController.add(TransferProgressInfo(
            transferId: transferId,
            fileName: fileName,
            transferredBytes: bytesSent,
            totalBytes: resolvedFileSize,
            speedMBps: speedMBps,
            etaSeconds: eta,
            isSender: true,
            state: 'TRANSFERRING',
          ));
          lastEmit = nowMs;
        }
      }

      final uploadResp = await uploadReq.close();
      _activeSendRequest = null;

      if (uploadResp.statusCode == HttpStatus.ok) {
        final respBody = await uploadResp.transform(utf8.decoder).join();
        final respData = jsonDecode(respBody);

        _completedController.add({
          'transferId': transferId,
          'fileName': fileName,
          'fileSize': resolvedFileSize,
          'sha256': expectedSha,
          'verified': respData['verified'] == true,
          'isSender': true,
        });

        debugPrint('[AuraTransfer] Transfer completed & verified: $fileName');
        return true;
      } else {
        _errorController.add('Receiver rejected transfer completion (HTTP ${uploadResp.statusCode})');
        return false;
      }
    } catch (e) {
      if (_isCancelled) return false;
      _errorController.add('Transfer error: $e');
      return false;
    } finally {
      _activeSendRequest = null;
    }
  }
}
