import 'package:npc_core/npc_core.dart';

/// Entry point for the Client portal app.
///
/// **Scaffold.** This target exists so the shared packages are proven against
/// a portal-scoped app as well as the staff one, and so the workspace, lint
/// policy and scope gate all cover it from the start. The screens land in the
/// phase named by `portals/client/plan.md`; the Command Centre ships first.
///
/// Building it out is blocked on the server prerequisites that do not apply to
/// the Command Centre — `S-1`'s bearer mode for the cookie portals, `S-2`'s
/// Turnstile replacement, `S-3`'s account deletion and `S-6`'s review
/// accounts (mobile/plan.md Part 2).
void main() {
  final NpcFlavor flavor = NpcFlavor.fromEnvironment();
  throw UnimplementedError(
    'The Client portal app is scaffolded but not yet built '
    '(flavor: ${flavor.name}). See mobile/portals/client/plan.md.',
  );
}
