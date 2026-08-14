import 'package:flutter/material.dart';

import '../auth/sign_in_screen.dart';
import '../tenant/workspace_screen.dart';
import 'app_state.dart';
import 'seat_limit_screen.dart';
import 'overview_screen.dart';

/// Chooses the screen for the current [CommandCentreState.stage].
///
/// The progression is linear and each stage has a real screen — none of them
/// dead-ends, which is the pre-auth completeness rule store review actually
/// checks (plan.md R-BOTH-1).
class CommandCentreRouter extends StatelessWidget {
  const CommandCentreRouter({required this.state, super.key});

  final CommandCentreState state;

  @override
  Widget build(BuildContext context) {
    return switch (state.stage) {
      CommandCentreStage.restoring => const _Restoring(),
      CommandCentreStage.needsTenant => WorkspaceScreen(state: state),
      CommandCentreStage.needsSignIn => SignInScreen(state: state),
      CommandCentreStage.seatLimitReached => SeatLimitScreen(state: state),
      CommandCentreStage.ready => OverviewScreen(state: state),
    };
  }
}

class _Restoring extends StatelessWidget {
  const _Restoring();

  @override
  Widget build(BuildContext context) =>
      const Scaffold(body: Center(child: CircularProgressIndicator.adaptive()));
}
