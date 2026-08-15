import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:npc_auth/npc_auth.dart';
import 'package:npc_core/npc_core.dart';
import 'package:npc_portal/npc_portal.dart';
import 'package:npc_tenant/npc_tenant.dart';

Widget appFor(NpcPortalDescriptor descriptor) => PortalApp(
  descriptor: descriptor,
  flavor: NpcFlavor.development,
  secureStore: InMemorySecureStore(),
  discovery: NpcTenantDiscovery(flavor: NpcFlavor.development),
  home: (_) => const Scaffold(body: Text('signed in')),
);

void main() {
  testWidgets('a blocked portal explains itself instead of crashing', (
    WidgetTester tester,
  ) async {
    // The previous scaffold was `throw UnimplementedError` at main(), which is
    // indistinguishable from a crash to anyone testing the build.
    await tester.pumpWidget(appFor(NpcPortals.builder));
    await tester.pumpAndSettle();

    expect(find.textContaining('not available on mobile yet'), findsOneWidget);
    expect(find.textContaining('HttpOnly cookie'), findsOneWidget);
    expect(find.textContaining('Origin'), findsOneWidget);
    // It must not offer a workspace field it cannot use.
    expect(find.byType(TextField), findsNothing);
  });

  testWidgets('solicitor names its single blocker', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(appFor(NpcPortals.solicitor));
    await tester.pumpAndSettle();

    expect(
      find.textContaining('reason:'),
      findsOneWidget,
      reason: 'singular — solicitor has exactly one blocker',
    );
    expect(find.textContaining('Origin'), findsOneWidget);
  });

  testWidgets('a native-ready portal reaches the workspace prompt', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(appFor(NpcPortals.finance));
    await tester.pumpAndSettle();

    expect(find.textContaining('not available on mobile'), findsNothing);
    expect(find.widgetWithText(FilledButton, 'Continue'), findsOneWidget);
  });
}
