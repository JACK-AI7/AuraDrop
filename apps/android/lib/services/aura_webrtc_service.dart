import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:crypto/crypto.dart';
import 'package:convert/convert.dart';
import 'package:path_provider/path_provider.dart';

import 'aura_protocol.dart';
import 'aura_signaling_service.dart';

class TransferProgressEvent {
  final String transferId;
  final String fileName;
  final int transferredBytes;
  final int totalBytes;
  final double speedMBps;
  final int etaSeconds;
  final bool isSender;

  TransferProgressEvent({
    required this.transferId,
    required this.fileName,
    required this.transferredBytes,
    required this.totalBytes,
    required this.speedMBps,
    required this.etaSeconds,
    required this.isSender,
  });
}

class AuraWebRtcService {
  static final AuraWebRtcService _instance = AuraWebRtcService._internal();
  factory AuraWebRtcService() => _instance;
  AuraWebRtcService._internal();

  final AuraSignalingService _signaling = AuraSignalingService();

  RTCPeerConnection? _peerConnection;
  RTCDataChannel? _dataChannel;
  String? _targetPeerId;
  bool _isInitiator = false;

  final List<RTCIceCandidate> _pendingCandidates = [];
  bool _remoteDescriptionSet = false;

  // Transfer State
  bool _isTransferring = false;
  IOSink? _currentFileSink;
  File? _currentPartFile;
  File? _currentFinalFile;
  AccumulatorSink<Digest>? _receiverDigestSink;
  ByteConversionSink? _receiverChunkSink;
  String _expectedChecksum = '';
  int _receivedBytes = 0;
  int _totalFileBytes = 0;
  String _activeTransferId = '';
  String _activeFileName = '';

  // Telemetry & Metrics
  int _rttMs = 0;
  String _iceState = 'new';
  String _connectionState = 'DISCONNECTED';

  // Streams
  final _connectionStateController = StreamController<String>.broadcast();
  final _progressController = StreamController<TransferProgressEvent>.broadcast();
  final _transferCompleteController = StreamController<Map<String, dynamic>>.broadcast();
  final _transferErrorController = StreamController<String>.broadcast();

  Stream<String> get onConnectionState => _connectionStateController.stream;
  Stream<TransferProgressEvent> get onProgress => _progressController.stream;
  Stream<Map<String, dynamic>> get onTransferComplete => _transferCompleteController.stream;
  Stream<String> get onTransferError => _transferErrorController.stream;

  int get rttMs => _rttMs;
  String get connectionState => _connectionState;
  bool get isTransferring => _isTransferring;

  void init() {
    _signaling.onSignal.listen(_handleRemoteSignal);
  }

  Map<String, dynamic> _getRtcConfiguration() {
    return {
      'iceServers': [
        {'urls': 'stun:stun.l.google.com:19302'},
        {'urls': 'stun:stun1.l.google.com:19302'},
        {'urls': 'stun:stun2.l.google.com:19302'},
        {'urls': 'stun:stun.cloudflare.com:3478'},
        {'urls': 'stun:global.stun.twilio.com:3478'},
      ],
      'sdpSemantics': 'unified-plan',
    };
  }

  // -------------------------------------------------------------
  // Connect to Remote Peer (Initiator - Desktop or Android)
  // -------------------------------------------------------------
  Future<bool> connectToPeer(String targetPeerId) async {
    _targetPeerId = targetPeerId;
    _isInitiator = true;
    _remoteDescriptionSet = false;
    _pendingCandidates.clear();
    _updateState('CONNECTING');

    debugPrint('[AuraWebRTC] Creating RTCPeerConnection to $targetPeerId');
    try {
      _peerConnection = await createPeerConnection(_getRtcConfiguration());
      _setupPeerConnectionEvents();

      // Create RTCDataChannel
      final dcInit = RTCDataChannelInit()
        ..ordered = true
        ..maxRetransmits = -1; // Reliable ordered mode
      _dataChannel = await _peerConnection!.createDataChannel('auradrop-p2pfs', dcInit);
      _setupDataChannel(_dataChannel!);

      _updateState('SIGNALING');
      final offer = await _peerConnection!.createOffer();
      await _peerConnection!.setLocalDescription(offer);

      _signaling.sendSignal(
        targetDeviceId: targetPeerId,
        signal: {
          'type': 'offer',
          'sdp': offer.sdp,
        },
      );
      debugPrint('[AuraWebRTC] Dispatched SDP Offer to $targetPeerId');
      return true;
    } catch (e) {
      debugPrint('[AuraWebRTC] Failed to create offer: $e');
      _updateState('FAILED');
      _transferErrorController.add('WebRTC connection failed: $e');
      return false;
    }
  }

  // -------------------------------------------------------------
  // Remote Signal Handling (Offer, Answer, ICE Candidate)
  // -------------------------------------------------------------
  Future<void> _handleRemoteSignal(Map<String, dynamic> data) async {
    final senderId = data['senderId']?.toString() ?? '';
    final signal = data['signal'];
    if (signal is! Map) return;

    final type = signal['type']?.toString();

    if (type == 'offer') {
      debugPrint('[AuraWebRTC] Received SDP Offer from $senderId');
      _targetPeerId = senderId;
      _isInitiator = false;
      _remoteDescriptionSet = false;
      _pendingCandidates.clear();
      _updateState('CONNECTING');

      _peerConnection = await createPeerConnection(_getRtcConfiguration());
      _setupPeerConnectionEvents();

      _peerConnection!.onDataChannel = (RTCDataChannel channel) {
        debugPrint('[AuraWebRTC] RTCDataChannel received from remote peer');
        _dataChannel = channel;
        _setupDataChannel(_dataChannel!);
      };

      final sdp = signal['sdp']?.toString() ?? '';
      await _peerConnection!.setRemoteDescription(RTCSessionDescription(sdp, 'offer'));
      _remoteDescriptionSet = true;
      await _drainPendingCandidates();

      final answer = await _peerConnection!.createAnswer();
      await _peerConnection!.setLocalDescription(answer);

      _signaling.sendSignal(
        targetDeviceId: senderId,
        signal: {
          'type': 'answer',
          'sdp': answer.sdp,
        },
      );
      debugPrint('[AuraWebRTC] Dispatched SDP Answer to $senderId');
    } else if (type == 'answer' && _peerConnection != null) {
      debugPrint('[AuraWebRTC] Received SDP Answer from $senderId');
      final sdp = signal['sdp']?.toString() ?? '';
      await _peerConnection!.setRemoteDescription(RTCSessionDescription(sdp, 'answer'));
      _remoteDescriptionSet = true;
      await _drainPendingCandidates();
    } else if (signal['candidate'] != null) {
      final candMap = signal['candidate'];
      if (candMap is Map) {
        final cand = RTCIceCandidate(
          candMap['candidate']?.toString(),
          candMap['sdpMid']?.toString(),
          candMap['sdpMLineIndex'] as int?,
        );
        if (_remoteDescriptionSet && _peerConnection != null) {
          try {
            await _peerConnection!.addCandidate(cand);
          } catch (e) {
            debugPrint('[AuraWebRTC] Error adding ICE candidate: $e');
          }
        } else {
          _pendingCandidates.add(cand);
        }
      }
    }
  }

  Future<void> _drainPendingCandidates() async {
    if (_peerConnection == null || !_remoteDescriptionSet) return;
    while (_pendingCandidates.isNotEmpty) {
      final c = _pendingCandidates.removeAt(0);
      try {
        await _peerConnection!.addCandidate(c);
      } catch (e) {
        debugPrint('[AuraWebRTC] Error adding queued ICE candidate: $e');
      }
    }
  }

  void _setupPeerConnectionEvents() {
    if (_peerConnection == null) return;

    _peerConnection!.onIceCandidate = (RTCIceCandidate candidate) {
      if (candidate.candidate != null && _targetPeerId != null) {
        _signaling.sendSignal(
          targetDeviceId: _targetPeerId!,
          signal: {
            'candidate': {
              'candidate': candidate.candidate,
              'sdpMid': candidate.sdpMid,
              'sdpMLineIndex': candidate.sdpMLineIndex,
            }
          },
        );
      }
    };

    _peerConnection!.onIceConnectionState = (RTCIceConnectionState state) {
      _iceState = state.name;
      debugPrint('[AuraWebRTC] ICE Connection State: $_iceState');
      if (state == RTCIceConnectionState.RTCIceConnectionStateFailed) {
        _updateState('FAILED');
      } else if (state == RTCIceConnectionState.RTCIceConnectionStateDisconnected) {
        _updateState('INTERRUPTED');
      }
    };

    _peerConnection!.onConnectionState = (RTCPeerConnectionState state) {
      debugPrint('[AuraWebRTC] PeerConnection State: ${state.name}');
      if (state == RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
        _updateState('PEER_CONNECTED');
      } else if (state == RTCPeerConnectionState.RTCPeerConnectionStateFailed) {
        _updateState('FAILED');
      }
    };
  }

  void _setupDataChannel(RTCDataChannel dc) {
    dc.onDataChannelState = (RTCDataChannelState state) async {
      debugPrint('[AuraWebRTC] RTCDataChannel state: ${state.name}');
      if (state == RTCDataChannelState.RTCDataChannelOpen) {
        _updateState('DATA_CHANNEL_OPEN');
        if (_isInitiator) {
          // Perform Handshake & Health Check Ping
          await _executeHandshakeAndPing();
        }
      } else if (state == RTCDataChannelState.RTCDataChannelClosed) {
        _updateState('CLOSED');
      }
    };

    dc.onMessage = (RTCDataChannelMessage msg) {
      if (msg.isBinary) {
        _handleBinaryFrame(msg.binary);
      } else {
        _handleTextMessage(msg.text);
      }
    };
  }

  Future<void> _executeHandshakeAndPing() async {
    if (_dataChannel == null) return;
    _updateState('HANDSHAKING');

    // Send Handshake Init
    final hsFrame = AuraProtocol.buildJsonFrame(
      AuraProtocol.frameHandshakeInit,
      {
        'protocolVersion': 'P2PFS/1',
        'nonce': DateTime.now().millisecondsSinceEpoch.toString(),
      },
    );
    _dataChannel!.send(RTCDataChannelMessage.fromBinary(hsFrame));

    // Send Health Ping
    final pingFrame = AuraProtocol.buildJsonFrame(
      AuraProtocol.frameHealthPing,
      {'timestamp': DateTime.now().millisecondsSinceEpoch},
    );
    _dataChannel!.send(RTCDataChannelMessage.fromBinary(pingFrame));
  }

  void _handleTextMessage(String text) {
    try {
      final map = jsonDecode(text);
      if (map is Map) {
        debugPrint('[AuraWebRTC] Received text message: $text');
      }
    } catch (_) {}
  }

  void _handleBinaryFrame(Uint8List frameBytes) {
    final frame = AuraProtocol.decodeFrame(frameBytes);
    if (frame == null) return;

    switch (frame.frameType) {
      case AuraProtocol.frameHandshakeInit:
        // Respond with Handshake Response
        final resp = AuraProtocol.buildJsonFrame(
          AuraProtocol.frameHandshakeResp,
          {
            'protocolVersion': 'P2PFS/1',
            'status': 'OK',
            'timestamp': DateTime.now().millisecondsSinceEpoch,
          },
        );
        _dataChannel?.send(RTCDataChannelMessage.fromBinary(resp));
        break;

      case AuraProtocol.frameHandshakeResp:
        debugPrint('[AuraWebRTC] Handshake acknowledged');
        break;

      case AuraProtocol.frameHealthPing:
        // Echo pong
        final pong = AuraProtocol.buildFrame(
          AuraProtocol.frameHealthPong,
          frame.payload,
        );
        _dataChannel?.send(RTCDataChannelMessage.fromBinary(pong));
        break;

      case AuraProtocol.frameHealthPong:
        final json = frame.asJson();
        final ts = json?['timestamp'] as num?;
        if (ts != null) {
          _rttMs = DateTime.now().millisecondsSinceEpoch - ts.toInt();
          debugPrint('[AuraWebRTC] Health Check PONG received, RTT: $_rttMs ms');
        }
        _updateState('READY_TO_TRANSFER');
        break;

      case AuraProtocol.frameNegotiationReq:
        final reqJson = frame.asJson();
        if (reqJson != null) {
          debugPrint('[AuraWebRTC] Received in-channel transfer negotiation');
        }
        break;

      case AuraProtocol.frameFileStart:
        _handleFileStart(frame);
        break;

      case AuraProtocol.frameChunkData:
        _handleChunkData(frame.payload);
        break;

      case AuraProtocol.frameFileFin:
        _handleFileFin(frame);
        break;

      case AuraProtocol.frameAckComplete:
        _handleAckComplete(frame);
        break;
    }
  }

  // -------------------------------------------------------------
  // Inbound Receiver Pipeline (Prompt Section 14)
  // WebRTC DataChannel -> binary frame -> chunk -> SHA-256 -> disk
  // -------------------------------------------------------------
  Future<void> _handleFileStart(DecodedAuraFrame frame) async {
    final info = frame.asJson();
    if (info == null) return;

    _activeFileName = info['filename']?.toString() ?? 'received_file';
    _totalFileBytes = (info['size'] as num?)?.toInt() ?? 0;
    _expectedChecksum = info['checksum']?.toString() ?? '';
    _activeTransferId = info['transferId']?.toString() ?? DateTime.now().millisecondsSinceEpoch.toString();
    _receivedBytes = 0;
    _isTransferring = true;
    _updateState('TRANSFERRING');

    debugPrint('[AuraWebRTC] Inbound FILE_START: $_activeFileName ($_totalFileBytes bytes)');

    final targetDir = await _getStorageDirectory();
    _currentFinalFile = File('${targetDir.path}/$_activeFileName');
    _currentPartFile = File('${targetDir.path}/$_activeFileName.part');

    if (await _currentPartFile!.exists()) {
      await _currentPartFile!.delete();
    }

    _currentFileSink = _currentPartFile!.openWrite();

    // Incremental SHA-256 pipeline
    _receiverDigestSink = AccumulatorSink<Digest>();
    _receiverChunkSink = sha256.startChunkedConversion(_receiverDigestSink!);
  }

  void _handleChunkData(Uint8List chunk) {
    if (!_isTransferring || _currentFileSink == null || _receiverChunkSink == null) return;

    _currentFileSink!.add(chunk);
    _receiverChunkSink!.add(chunk);
    _receivedBytes += chunk.length;

    _progressController.add(TransferProgressEvent(
      transferId: _activeTransferId,
      fileName: _activeFileName,
      transferredBytes: _receivedBytes,
      totalBytes: _totalFileBytes,
      speedMBps: 0.0,
      etaSeconds: 0,
      isSender: false,
    ));
  }

  Future<void> _handleFileFin(DecodedAuraFrame frame) async {
    if (!_isTransferring || _currentFileSink == null || _receiverChunkSink == null) return;
    _updateState('VERIFYING');

    await _currentFileSink!.flush();
    await _currentFileSink!.close();
    _receiverChunkSink!.close();

    final computedHash = _receiverDigestSink!.events.single.toString();
    debugPrint('[AuraWebRTC] Received FILE_FIN. Expected: $_expectedChecksum, Computed: $computedHash');

    if (_expectedChecksum.isNotEmpty && _expectedChecksum.toLowerCase() != computedHash.toLowerCase()) {
      _isTransferring = false;
      _updateState('FAILED');
      _transferErrorController.add('Integrity verification failed (SHA-256 mismatch)');
      return;
    }

    // Hash verified! Commit file from .part to final
    if (await _currentPartFile!.exists()) {
      if (await _currentFinalFile!.exists()) {
        await _currentFinalFile!.delete();
      }
      await _currentPartFile!.rename(_currentFinalFile!.path);
    }

    _isTransferring = false;
    _updateState('COMPLETED');

    // Send ACK_COMPLETE to sender
    final ack = AuraProtocol.buildJsonFrame(
      AuraProtocol.frameAckComplete,
      {
        'transferId': _activeTransferId,
        'status': 'VERIFIED',
        'sha256': computedHash,
        'path': _currentFinalFile?.path,
      },
    );
    _dataChannel?.send(RTCDataChannelMessage.fromBinary(ack));

    _transferCompleteController.add({
      'transferId': _activeTransferId,
      'fileName': _activeFileName,
      'fileSize': _totalFileBytes,
      'filePath': _currentFinalFile?.path,
      'sha256': computedHash,
      'isSender': false,
    });
  }

  void _handleAckComplete(DecodedAuraFrame frame) {
    _isTransferring = false;
    _updateState('COMPLETED');
    _transferCompleteController.add({
      'transferId': _activeTransferId,
      'fileName': _activeFileName,
      'fileSize': _totalFileBytes,
      'isSender': true,
    });
    debugPrint('[AuraWebRTC] Sender received ACK_COMPLETE from peer. Transfer 100% finished.');
  }

  // -------------------------------------------------------------
  // Outbound Sender Pipeline (Prompt Section 18)
  // File -> slice/read chunk -> SHA-256 update -> binary frame -> WebRTC
  // -------------------------------------------------------------
  Future<void> sendFile({
    required File file,
    required String transferId,
  }) async {
    if (_dataChannel == null || _dataChannel!.state != RTCDataChannelState.RTCDataChannelOpen) {
      _transferErrorController.add('WebRTC DataChannel not open');
      return;
    }

    _activeTransferId = transferId;
    _activeFileName = file.uri.pathSegments.last;
    _totalFileBytes = await file.length();
    _isTransferring = true;
    _updateState('TRANSFERRING');

    // 1. Calculate file checksum
    final fileBytes = await file.readAsBytes();
    final digest = sha256.convert(fileBytes).toString();

    // 2. Dispatch FILE_START frame
    final startFrame = AuraProtocol.buildJsonFrame(
      AuraProtocol.frameFileStart,
      {
        'transferId': transferId,
        'filename': _activeFileName,
        'size': _totalFileBytes,
        'checksum': digest,
        'totalTransferBytes': _totalFileBytes,
      },
    );
    _dataChannel!.send(RTCDataChannelMessage.fromBinary(startFrame));

    // 3. Stream chunks with backpressure (chunk size 64 KB per Section 18)
    const chunkSize = 64 * 1024;
    int sentBytes = 0;
    final startTime = DateTime.now().millisecondsSinceEpoch;

    for (int offset = 0; offset < fileBytes.length; offset += chunkSize) {
      if (!_isTransferring) break;

      final end = math.min(offset + chunkSize, fileBytes.length);
      final chunk = fileBytes.sublist(offset, end);

      final chunkFrame = AuraProtocol.buildFrame(
        AuraProtocol.frameChunkData,
        chunk,
      );
      _dataChannel!.send(RTCDataChannelMessage.fromBinary(chunkFrame));
      sentBytes += chunk.length;

      // Backpressure throttle
      if (_dataChannel!.bufferedAmount != null && _dataChannel!.bufferedAmount! > 256 * 1024) {
        await Future.delayed(const Duration(milliseconds: 15));
      }

      final elapsedSec = math.max(0.1, (DateTime.now().millisecondsSinceEpoch - startTime) / 1000.0);
      final speedMBps = (sentBytes / (1024 * 1024)) / elapsedSec;
      final remainingBytes = _totalFileBytes - sentBytes;
      final etaSec = speedMBps > 0 ? (remainingBytes / (speedMBps * 1024 * 1024)).ceil() : 0;

      _progressController.add(TransferProgressEvent(
        transferId: transferId,
        fileName: _activeFileName,
        transferredBytes: sentBytes,
        totalBytes: _totalFileBytes,
        speedMBps: speedMBps,
        etaSeconds: etaSec,
        isSender: true,
      ));
    }

    // 4. Dispatch FILE_FIN frame
    final finFrame = AuraProtocol.buildJsonFrame(
      AuraProtocol.frameFileFin,
      {
        'transferId': transferId,
        'checksum': digest,
      },
    );
    _dataChannel!.send(RTCDataChannelMessage.fromBinary(finFrame));
    debugPrint('[AuraWebRTC] Dispatched FILE_FIN for $_activeFileName');
  }

  Future<Directory> _getStorageDirectory() async {
    Directory? dir;
    if (Platform.isAndroid) {
      dir = Directory('/storage/emulated/0/Download/AuraDrop');
      if (!await dir.exists()) {
        try {
          await dir.create(recursive: true);
        } catch (_) {
          dir = await getDownloadsDirectory() ?? await getApplicationDocumentsDirectory();
        }
      }
    } else {
      dir = await getDownloadsDirectory() ?? await getApplicationDocumentsDirectory();
    }
    return dir;
  }

  void _updateState(String state) {
    _connectionState = state;
    _connectionStateController.add(state);
  }

  void cancelTransfer() {
    _isTransferring = false;
    _currentFileSink?.close();
    _currentFileSink = null;
    _updateState('CANCELLED');
  }

  void disconnect() {
    cancelTransfer();
    _dataChannel?.close();
    _dataChannel = null;
    _peerConnection?.close();
    _peerConnection = null;
    _updateState('DISCONNECTED');
  }
}
