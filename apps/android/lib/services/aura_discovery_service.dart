import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import '../models/models.dart';
import 'aura_identity_service.dart';

class AuraDiscoveryService {
  static final AuraDiscoveryService _instance = AuraDiscoveryService._internal();
  factory AuraDiscoveryService() => _instance;
  AuraDiscoveryService._internal();

  static const String protocolVersion = 'AURADROP/1';
  static const int discoveryPort = 53317;
  static const String multicastAddress = '224.0.0.167';

  RawDatagramSocket? _socket;
  Timer? _broadcastTimer;
  Timer? _pruneTimer;
  bool _isRunning = false;

  final Map<String, PeerDevice> _discoveredPeers = {};
  final _peersController = StreamController<List<PeerDevice>>.broadcast();

  Stream<List<PeerDevice>> get onPeersChanged => _peersController.stream;
  List<PeerDevice> get currentPeers => _discoveredPeers.values.toList();
  bool get isRunning => _isRunning;

  Future<void> start() async {
    if (_isRunning) return;

    final identity = AuraIdentityService();
    if (identity.deviceId.isEmpty) {
      await identity.init();
    }

    try {
      _socket = await RawDatagramSocket.bind(
        InternetAddress.anyIPv4,
        discoveryPort,
        reuseAddress: true,
        reusePort: true,
      );
      _socket!.broadcastEnabled = true;

      try {
        _socket!.joinMulticast(InternetAddress(multicastAddress));
      } catch (e) {
        debugPrint('[AuraDiscovery] Multicast join note: $e');
      }

      _isRunning = true;
      _socket!.listen(_handleDatagram, onError: (e) {
        debugPrint('[AuraDiscovery] Socket error: $e');
      });

      // Broadcast immediately and every 2.5 seconds
      _broadcastAnnounce();
      _broadcastTimer = Timer.periodic(const Duration(milliseconds: 2500), (_) {
        _broadcastAnnounce();
      });

      // Peer expiration check every 2 seconds
      _pruneTimer = Timer.periodic(const Duration(seconds: 2), (_) {
        _pruneStalePeers();
      });

      debugPrint('[AuraDiscovery] Active on port $discoveryPort as ${identity.deviceName} (${identity.deviceId})');
    } catch (e) {
      debugPrint('[AuraDiscovery] Bind error: $e');
      // If port 53317 is busy, try random ephemeral port for listening/broadcasting
      try {
        _socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
        _socket!.broadcastEnabled = true;
        _isRunning = true;
        _socket!.listen(_handleDatagram);

        _broadcastAnnounce();
        _broadcastTimer = Timer.periodic(const Duration(milliseconds: 2500), (_) {
          _broadcastAnnounce();
        });
        _pruneTimer = Timer.periodic(const Duration(seconds: 2), (_) {
          _pruneStalePeers();
        });
      } catch (err) {
        debugPrint('[AuraDiscovery] Ephemeral bind error: $err');
      }
    }
  }

  void _broadcastAnnounce() {
    if (_socket == null || !_isRunning) return;

    final identity = AuraIdentityService();
    final packet = jsonEncode({
      'protocol': protocolVersion,
      'type': 'ANNOUNCE',
      'deviceId': identity.deviceId,
      'deviceName': identity.deviceName,
      'platform': identity.platform,
      'port': discoveryPort,
      'version': '1.0.0',
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });

    final bytes = utf8.encode(packet);

    // 1. Broadcast to local subnet
    try {
      _socket!.send(bytes, InternetAddress('255.255.255.255'), discoveryPort);
    } catch (_) {}

    // 2. Multicast to standard group
    try {
      _socket!.send(bytes, InternetAddress(multicastAddress), discoveryPort);
    } catch (_) {}
  }

  void _sendUnicastAck(InternetAddress targetAddress, int targetPort) {
    if (_socket == null || !_isRunning) return;

    final identity = AuraIdentityService();
    final packet = jsonEncode({
      'protocol': protocolVersion,
      'type': 'ANNOUNCE_ACK',
      'deviceId': identity.deviceId,
      'deviceName': identity.deviceName,
      'platform': identity.platform,
      'port': discoveryPort,
      'version': '1.0.0',
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });

    try {
      _socket!.send(utf8.encode(packet), targetAddress, targetPort);
    } catch (e) {
      debugPrint('[AuraDiscovery] Failed to send ACK: $e');
    }
  }

  void _handleDatagram(RawSocketEvent event) {
    if (event != RawSocketEvent.read || _socket == null) return;

    final datagram = _socket!.receive();
    if (datagram == null) return;

    try {
      final text = utf8.decode(datagram.data);
      final data = jsonDecode(text);

      if (data is! Map<String, dynamic>) return;
      if (data['protocol'] != protocolVersion) return;

      final selfId = AuraIdentityService().deviceId;
      final peerId = data['deviceId']?.toString() ?? '';
      if (peerId.isEmpty || peerId == selfId) return;

      final peerName = data['deviceName']?.toString() ?? 'Nearby Device';
      final peerPlatform = data['platform']?.toString() ?? 'device';
      final peerPort = (data['port'] as num?)?.toInt() ?? discoveryPort;
      final peerIp = datagram.address.address;
      final type = data['type']?.toString() ?? 'ANNOUNCE';

      final isTrusted = AuraIdentityService().isDeviceTrusted(peerId);

      final peer = PeerDevice(
        id: peerId,
        name: peerName,
        deviceName: peerName,
        platform: peerPlatform,
        ip: peerIp,
        port: peerPort,
        lastSeen: DateTime.now(),
        isTrusted: isTrusted,
        connectionState: 'AVAILABLE',
        transport: 'Direct Wi-Fi',
      );

      _discoveredPeers[peerId] = peer;
      _emitPeers();

      // Reply with ACK if it was an ANNOUNCE
      if (type == 'ANNOUNCE') {
        _sendUnicastAck(datagram.address, datagram.port);
      }
    } catch (e) {
      // Ignore malformed packets silently
    }
  }

  void _pruneStalePeers() {
    final now = DateTime.now();
    bool changed = false;

    _discoveredPeers.removeWhere((id, peer) {
      final isStale = now.difference(peer.lastSeen).inSeconds > 8;
      if (isStale) changed = true;
      return isStale;
    });

    if (changed) {
      _emitPeers();
    }
  }

  void _emitPeers() {
    _peersController.add(_discoveredPeers.values.toList());
  }

  void stop() {
    _isRunning = false;
    _broadcastTimer?.cancel();
    _broadcastTimer = null;
    _pruneTimer?.cancel();
    _pruneTimer = null;
    _socket?.close();
    _socket = null;
    _discoveredPeers.clear();
    _emitPeers();
  }
}
