import 'dart:async';
import 'dart:io';
import '../models/models.dart';

enum ConnectionRouteType {
  lanDirect,
  directInternetP2p,
  secureRelayFallback,
}

class RouteResolutionResult {
  final ConnectionRouteType routeType;
  final String targetAddress;
  final int targetPort;
  final int estimatedLatencyMs;
  final bool isDirect;

  RouteResolutionResult({
    required this.routeType,
    required this.targetAddress,
    required this.targetPort,
    required this.estimatedLatencyMs,
    required this.isDirect,
  });

  String get routeName {
    switch (routeType) {
      case ConnectionRouteType.lanDirect:
        return 'LAN Direct (High Speed)';
      case ConnectionRouteType.directInternetP2p:
        return 'Internet Direct P2P';
      case ConnectionRouteType.secureRelayFallback:
        return 'Secure Encrypted Relay';
    }
  }
}

class ConnectionManager {
  static final ConnectionManager _instance = ConnectionManager._internal();
  factory ConnectionManager() => _instance;
  ConnectionManager._internal();

  /// Evaluates and selects the highest throughput, lowest latency connection route
  /// for [peer]:
  /// 1. Tests LAN Direct (TCP socket probe to peer.ip:peer.port)
  /// 2. If unreachable, evaluates Direct Internet P2P
  /// 3. If unreachable or symmetric NAT, falls back to Secure Relay
  Future<RouteResolutionResult> resolveBestRoute(PeerDevice peer) async {
    final stopwatch = Stopwatch()..start();

    // 1. Try LAN Direct
    try {
      final socket = await Socket.connect(
        peer.ip,
        peer.port,
        timeout: const Duration(milliseconds: 600),
      );
      stopwatch.stop();
      await socket.close();

      return RouteResolutionResult(
        routeType: ConnectionRouteType.lanDirect,
        targetAddress: peer.ip,
        targetPort: peer.port,
        estimatedLatencyMs: stopwatch.elapsedMilliseconds,
        isDirect: true,
      );
    } catch (_) {
      // LAN Direct failed or timed out
    }

    // 2. Check if peer has a reachable public address or direct internet route
    if (peer.ip.isNotEmpty && !peer.ip.startsWith('127.') && !peer.ip.startsWith('10.') && !peer.ip.startsWith('192.168.')) {
      try {
        stopwatch.reset();
        stopwatch.start();
        final socket = await Socket.connect(
          peer.ip,
          peer.port,
          timeout: const Duration(milliseconds: 1200),
        );
        stopwatch.stop();
        await socket.close();

        return RouteResolutionResult(
          routeType: ConnectionRouteType.directInternetP2p,
          targetAddress: peer.ip,
          targetPort: peer.port,
          estimatedLatencyMs: stopwatch.elapsedMilliseconds,
          isDirect: true,
        );
      } catch (_) {
        // Direct Internet probe failed
      }
    }

    // 3. Fallback to Secure Relay
    return RouteResolutionResult(
      routeType: ConnectionRouteType.secureRelayFallback,
      targetAddress: 'relay.auradrop.network',
      targetPort: 443,
      estimatedLatencyMs: 85,
      isDirect: false,
    );
  }
}
