import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:auradrop/services/aura_identity_service.dart';
import 'package:auradrop/services/aura_lan_server.dart';
import 'package:auradrop/services/aura_discovery_service.dart';

void main() {
  test('AuraDrop V28 Physical LAN Network Engine Verification', () async {
    // 1. Initialize identity
    final id = AuraIdentityService();
    await id.init();
    expect(id.deviceId.isNotEmpty, isTrue);
    print('[1] Cryptographic Identity: ${id.deviceId} (${id.deviceName})');

    // 2. Start LAN Server
    await AuraLanServer().start(
      deviceId: id.deviceId,
      deviceName: id.deviceName,
      preferredPort: 53317,
    );
    print('[2] AuraLanServer started:');
    print('    Local IP: ${AuraLanServer().localIp}');
    print('    Port: ${AuraLanServer().port}');
    print('    Endpoint: ${AuraLanServer().endpointUrl}');

    expect(AuraLanServer().localIp.startsWith('172.21.'), isFalse,
        reason: 'Must NOT bind to virtual WSL Hyper-V adapter!');
    print('✓ PASS: Correctly rejected WSL/virtual adapters and selected physical adapter: ${AuraLanServer().localIp}');

    // 3. Start Discovery Service
    await AuraDiscoveryService().start();
    final diag = await AuraDiscoveryService().getDiagnostics();
    print('\n[3] AuraDiscoveryService Diagnostics:');
    print('    Active Interface: ${diag['activeInterface']}');
    print('    Physical IP: ${diag['physicalIp']}');
    print('    Listening Port: ${diag['listeningPort']}');
    print('    Physical Adapters: ${diag['physicalAdapters']}');

    // 4. Test HTTP Pre-flight Ping
    print('\n[4] Testing HTTP Pre-flight Ping:');
    final client = HttpClient();
    final pingUrl = Uri.parse('${AuraLanServer().endpointUrl}/api/auradrop/v1/ping');
    final req = await client.getUrl(pingUrl).timeout(const Duration(seconds: 3));
    final resp = await req.close().timeout(const Duration(seconds: 3));
    expect(resp.statusCode, equals(HttpStatus.ok));

    final respBody = await resp.transform(utf8.decoder).join();
    final pingJson = jsonDecode(respBody);
    expect(pingJson['pong'], isTrue);
    print('✓ PASS: Ping response: $pingJson');
    client.close();

    // 5. Clean up
    AuraDiscoveryService().stop();
    await AuraLanServer().stop();
  });
}
