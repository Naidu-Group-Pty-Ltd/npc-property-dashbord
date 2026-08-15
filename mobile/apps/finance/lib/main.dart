import 'package:npc_portal/npc_portal.dart';

import 'src/home_screen.dart';

/// NPC Finance Portal — its own app (`mobile/plan.md` R-ARCH-1).
///
/// The shell, tenant discovery, sign-in, theming and device seats all come from
/// `npc_portal` and are identical across the five apps; this binary differs by
/// its descriptor and its screens.
///
/// If `NpcPortals.finance` reports blockers, the shell shows them rather than
/// pretending to work — see `PortalUnavailableScreen`.
void main() => bootstrapPortal(
  descriptor: NpcPortals.finance,
  home: (_) => const FinanceHomeScreen(),
);
