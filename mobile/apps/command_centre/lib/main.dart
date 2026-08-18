import 'package:npc_portal/npc_portal.dart';

import 'src/features/overview/overview_screen.dart';

/// NPC Command Centre — the staff app.
///
/// One entry point for every flavor: the flavor is a `--dart-define`, so it
/// cannot drift out of step with the Gradle/Xcode flavor of the same name.
///
/// Everything before the signed-in surface — workspace discovery, sign-in,
/// device seats, theming — comes from `npc_portal` and is identical in all five
/// apps. What is app-specific starts at [OverviewScreen].
void main() => bootstrapPortal(
  descriptor: NpcPortals.commandCentre,
  home: (_) => const OverviewScreen(),
);
