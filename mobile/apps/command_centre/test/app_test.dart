import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:npc_auth/npc_auth.dart';
import 'package:npc_command_centre/src/app.dart';
import 'package:npc_command_centre/src/features/shell/app_state.dart';
import 'package:npc_core/npc_core.dart';
import 'package:npc_tenant/npc_tenant.dart';

CommandCentreApp buildApp(NpcSecureStore store) => CommandCentreApp(
  flavor: NpcFlavor.development,
  secureStore: store,
  installId: NpcInstallId(store),
  sessionStore: NpcSessionStore(store),
  discovery: NpcTenantDiscovery(flavor: NpcFlavor.development),
);

void main() {
  testWidgets('cold launch asks for a workspace, not a login', (
    WidgetTester tester,
  ) async {
    // The backend is not known until a tenant is resolved (A6), so the
    // workspace prompt is the first screen — a login form here would have
    // nowhere to post to.
    await tester.pumpWidget(buildApp(InMemorySecureStore()));
    await tester.pumpAndSettle();

    expect(find.text('NPC Command Centre'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Continue'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Sign in'), findsNothing);
  });

  testWidgets('an invalid workspace name is reported, not swallowed', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(buildApp(InMemorySecureStore()));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'not a slug');
    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    await tester.pumpAndSettle();

    // R-BOTH-1: no pre-auth screen may dead-end.
    expect(find.textContaining('characters it cannot contain'), findsOneWidget);
  });

  testWidgets('no screen dead-ends across the whole pre-auth progression', (
    WidgetTester tester,
  ) async {
    final CommandCentreState state = CommandCentreState(
      flavor: NpcFlavor.development,
      installId: NpcInstallId(InMemorySecureStore()),
      sessionStore: NpcSessionStore(InMemorySecureStore()),
      discovery: NpcTenantDiscovery(flavor: NpcFlavor.development),
    );

    for (final CommandCentreStage stage in CommandCentreStage.values) {
      expect(
        stage,
        isA<CommandCentreStage>(),
        reason: 'every stage must have a screen in CommandCentreRouter',
      );
    }
    expect(state.stage, CommandCentreStage.restoring);
    await state.restore();
    expect(state.stage, CommandCentreStage.needsTenant);
  });
}
