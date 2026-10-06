import 'package:flutter_test/flutter_test.dart';
import 'package:auradrop/main.dart';

void main() {
  testWidgets('AuraDrop App smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const AuraDropApp());
    expect(find.text('AuraDrop'), findsOneWidget);
  });
}
