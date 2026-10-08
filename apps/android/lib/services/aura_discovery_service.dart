import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import '../models/models.dart';
import 'aura_identity_service.dart';
import 'aura_lan_server.dart';

class AuraDiscoveryService {
  static final AuraDiscoveryService _instance = AuraDiscoveryService._internal();
  factory AuraDiscoveryService() => _instance;
  AuraDiscoveryService._internal();

  static const String protocolVersion = 'AURADROP/1';
  static const int discoveryPort = 53317;
  static const String multicastAddress = '224.0.0.167';
  static const String legacyMulticastAddress = '239.255.48.29';

  RawDatagramSocket? _socket;
  Timer? _broadcastTimer;
  Timer? _pruneTimer;
  bool _isRunning = false;
  int _lastBroadcastTimeMs = 0;
  String _activeInterfaceName = 'Detecting...';
  String _activePhysicalIp = '127.0.0.1';

  final Map<String, PeerDevice> _discoveredPeers = {};
  final _peersController = StreamController<List<PeerDevice>>.broadcast();

  Stream<List<PeerDevice>> get onPeersChanged => _peersController.stream;
  List<PeerDevice> get currentPeers => _discoveredPeers.values.toList();
  bool get isRunning => _isRunning;
  String get activePhysicalIp => _activePhysicalIp;
  String get activeInterfaceName => _activeInterfaceName;
  int get lastBroadcastTimeMs => _lastBroadcastTimeMs;

  Future<void> start() async {
    if (_isRunning) return;

    final identity = AuraIdentityService();
    if (identity.deviceId.isEmpty) {
      await identity.init();
    }

    try {
      // NOTE: Windows does NOT support reusePort, only reuseAddress
      _socket = await RawDatagramSocket.bind(
        InternetAddress.anyIPv4,
        discoveryPort,
        reuseAddress: true,
        reusePort: !Platform.isWindows,
      );
      _socket!.broadcastEnabled = true;

      try {
        _socket!.joinMulticast(InternetAddress(multicastAddress));
      } catch (e) {
        debugPrint('[AuraDiscovery] Multicast join note: $e');
      }

      try {
        _socket!.joinMulticast(InternetAddress(legacyMulticastAddress));
      } catch (_) {}

      _isRunning = true;
      _socket!.listen(_handleDatagram, onError: (e) {
        debugPrint('[AuraDiscovery] Socket error: $e');
      });

      // Broadcast immediately and every 2.0 seconds
      _broadcastAnnounce();
      _broadcastTimer = Timer.periodic(const Duration(milliseconds: 2000), (_) {
        _broadcastAnnounce();
      });

      // Peer expiration check every 2 seconds (prune if stale > 8s)
      _pruneTimer = Timer.periodic(const Duration(seconds: 2), (_) {
        _pruneStalePeers();
      });

      debugPrint('[AuraDiscovery] Active on port $discoveryPort as ${identity.deviceName} (${identity.deviceId})');
    } catch (e) {
      debugPrint('[AuraDiscovery] Primary bind error: $e. Falling back to dynamic port.');
      try {
        _socket = await RawDatagramSocket.bind(
          InternetAddress.anyIPv4,
          0,
          reuseAddress: true,
          reusePort: !Platform.isWindows,
        );
        _socket!.broadcastEnabled = true;
        _isRunning = true;
        _socket!.listen(_handleDatagram);

        _broadcastAnnounce();
        _broadcastTimer = Timer.periodic(const Duration(milliseconds: 2000), (_) {
          _broadcastAnnounce();
        });
        _pruneTimer = Timer.periodic(const Duration(seconds: 2), (_) {
          _pruneStalePeers();
        });
      } catch (err) {
        debugPrint('[AuraDiscovery] Dynamic port bind failed: $err');
      }
    }
  }

  void forceAnnounce() {
    _broadcastAnnounce();
  }

  Future<List<Map<String, String>>> _getPhysicalBroadcastTargets() async {
    final targets = <Map<String, String>>[];
    final virtualKeywords = [
      'vethernet',
      'wsl',
      'hyper-v',
      'virtualbox',
      'vmware',
      'docker',
      'tap',
      'tun',
      'tailscale',
      'zerotier',
      'loopback'
    ];

    try {
      final interfaces = await NetworkInterface.list(
        includeLoopback: false,
        type: InternetAddressType.IPv4,
      );

      for (final iface in interfaces) {
        final lower = iface.name.toLowerCase();
        final isVirtual = virtualKeywords.any((kw) => lower.contains(kw));
        if (isVirtual) continue;

        for (final addr in iface.addresses) {
          final ip = addr.address;
          if (ip == '127.0.0.1' || ip.startsWith('169.254.')) continue;

          // Compute directed subnet broadcast (standard /24: a.b.c.255)
          final parts = ip.split('.');
          if (parts.length == 4) {
            final directedBroadcast = '${parts[0]}.${parts[1]}.${parts[2]}.255';
            targets.add({
              'iface': iface.name,
              'ip': ip,
              'broadcast': directedBroadcast,
            });
            if (_activePhysicalIp == '127.0.0.1') {
              _activePhysicalIp = ip;
              _activeInterfaceName = iface.name;
            }
          }
        }
      }
    } catch (e) {
      debugPrint('[AuraDiscovery] Interface query error: $e');
    }

    return targets;
  }

  void _broadcastAnnounce() async {
    if (_socket == null || !_isRunning) return;

    final identity = AuraIdentityService();
    final effectivePort = AuraLanServer().port > 0 ? AuraLanServer().port : discoveryPort;

    final packet = jsonEncode({
      'protocol': protocolVersion,
      'type': 'ANNOUNCE',
      'deviceId': identity.deviceId,
      'name': identity.deviceName,
      'deviceName': identity.deviceName,
      'platform': identity.platform,
      'port': effectivePort,
      'transferPort': effectivePort,
      'version': '1.0.0',
      'status': 'Nearby sharing made effortless',
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });

    final bytes = utf8.encode(packet);
    _lastBroadcastTimeMs = DateTime.now().millisecondsSinceEpoch;

    // 1. Send to directed subnet broadcasts for each physical adapter
    final physicalTargets = await _getPhysicalBroadcastTargets();
    for (final target in physicalTargets) {
      final bcast = target['broadcast'];
      if (bcast != null && bcast.isNotEmpty) {
        try {
          _socket!.send(bytes, InternetAddress(bcast), discoveryPort);
        } catch (_) {}
      }
    }

    // 2. Global Broadcast (255.255.255.255)
    try {
      _socket!.send(bytes, InternetAddress('255.255.255.255'), discoveryPort);
    } catch (_) {}

    // 3. Multicast Group (224.0.0.167)
    try {
      _socket!.send(bytes, InternetAddress(multicastAddress), discoveryPort);
    } catch (_) {}

    // 4. Legacy multicast & port for older or kotlin instances
    try {
      _socket!.send(bytes, InternetAddress(legacyMulticastAddress), discoveryPort);
      _socket!.send(bytes, InternetAddress(legacyMulticastAddress), 48290);
      _socket!.send(bytes, InternetAddress('255.255.255.255'), 48290);
    } catch (_) {}
  }

  void _sendUnicastAck(InternetAddress targetAddress, int targetPort) {
    if (_socket == null || !_isRunning) return;

    final identity = AuraIdentityService();
    final effectivePort = AuraLanServer().port > 0 ? AuraLanServer().port : discoveryPort;

    final packet = jsonEncode({
      'protocol': protocolVersion,
      'type': 'ANNOUNCE_ACK',
      'deviceId': identity.deviceId,
      'name': identity.deviceName,
      'deviceName': identity.deviceName,
      'platform': identity.platform,
      'port': effectivePort,
      'transferPort': effectivePort,
      'version': '1.0.0',
      'status': 'Nearby sharing made effortless',
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });

    try {
      _socket!.send(utf8.encode(packet), targetAddress, targetPort);
    } catch (e) {
      debugPrint('[AuraDiscovery] Failed to send unicast ACK: $e');
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

      // Accept both modern AURADROP/1 and legacy P2PFS/1
      final proto = data['protocol']?.toString() ?? '';
      if (proto != protocolVersion && proto != 'P2PFS/1' && proto != 'AURADROP_LOCAL_V1') {
        return;
      }

      final selfId = AuraIdentityService().deviceId;
      final peerId = data['deviceId']?.toString() ?? '';
      if (peerId.isEmpty || peerId == selfId) return;

      final peerName = data['name']?.toString() ?? data['deviceName']?.toString() ?? 'Nearby Device';
      final peerPlatform = data['platform']?.toString() ?? 'device';
      final peerPort = (data['transferPort'] as num?)?.toInt() ??
          (data['port'] as num?)?.toInt() ??
          discoveryPort;
      final peerIp = datagram.address.address;
      final type = data['type']?.toString() ?? 'ANNOUNCE';

      // Avoid self loopback
      if (peerIp == _activePhysicalIp && peerId == selfId) return;

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

      // Reply with ACK if this was an ANNOUNCE or BEACON
      if (type == 'ANNOUNCE' || type == 'AURADROP_BEACON') {
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

  Future<Map<String, dynamic>> getDiagnostics() async {
    final targets = await _getPhysicalBroadcastTargets();
    return {
      'isRunning': _isRunning,
      'listeningPort': discoveryPort,
      'activeInterface': _activeInterfaceName,
      'physicalIp': _activePhysicalIp,
      'lastBroadcastTimeMs': _lastBroadcastTimeMs,
      'discoveredPeersCount': _discoveredPeers.length,
      'physicalAdapters': targets,
    };
  }
}
