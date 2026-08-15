import 'package:flutter/material.dart';
import 'package:npc_portal/npc_portal.dart';

/// The Finance Portal's signed-in surface.
///
/// A shell for now: the screen inventory is in
/// `mobile/portals/finance/plan.md`, and the Command Centre ships first.
class FinanceHomeScreen extends StatelessWidget {
  const FinanceHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Finance Portal')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            GlassCard(
              child: Text(
                'Signed in. Screens land here per '
                'mobile/portals/finance/plan.md.',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
