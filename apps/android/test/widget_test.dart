import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:auradrop/main.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('com.auradrop.app/native'),
      (MethodCall methodCall) async {
        switch (methodCall.method) {
          case 'getUserProfile':
            return {
              'deviceId': 'test-device-id',
              'displayName': 'Test Device',
              'theme': 'glassDark',
              'accentColor': 0xFF6366F1,
              'visibilityMode': 'everyoneNearby',
            };
          case 'initDiscovery':
            return true;
          case 'loadTransferHistory':
            return <Map<String, dynamic>>[];
          case 'loadReceivedFiles':
            return <Map<String, dynamic>>[];
          case 'loadTrustedPeers':
            return <Map<String, dynamic>>[];
          default:
            return true;
        }
      },
    );
  });

  testWidgets('AuraDrop App smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const AuraDropApp());
    await tester.pump();
    expect(find.text('AuraDrop V3'), findsOneWidget);
  });
}
