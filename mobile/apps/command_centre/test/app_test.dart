import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:npc_auth/npc_auth.dart';
import 'package:npc_core/npc_core.dart';
import 'package:npc_portal/npc_portal.dart';
import 'package:npc_tenant/npc_tenant.dart';

Widget buildApp() => PortalApp(
  descriptor: NpcPortals.commandCentre,
  flavor: NpcFlavor.development,
  secureStore: InMemorySecureStore(),
  discovery: NpcTenantDiscovery(flavor: NpcFlavor.development),
  home: (_) => const Scaffold(body: Text('signed in')),
);

void main() {
  testWidgets('cold launch asks for a workspace, not a login', (
    WidgetTester tester,
  ) async {
    // The backend is not known until a tenant is resolved (A6), so a login
    // form here would have nowhere to post to.
    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    expect(find.text('Command Centre'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Continue'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Sign in'), findsNothing);
  });

  testWidgets('an invalid workspace name is reported, not swallowed', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'not a slug');
    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    await tester.pumpAndSettle();

    // R-BOTH-1: no pre-auth screen may dead-end.
    expect(find.textContaining('characters it cannot contain'), findsOneWidget);
  });

  testWidgets('the staff app is never shown as unavailable', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(buildApp());
    await tester.pumpAndSettle();
    expect(find.textContaining('not available on mobile'), findsNothing);
  });
}
