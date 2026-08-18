import 'package:flutter/material.dart';
import 'package:npc_portal/npc_portal.dart';

/// The staff landing screen.
///
/// Intentionally a shell. Which Command Centre surfaces come to mobile is
/// decided by the M1 feature matrix in `apps/command_centre/plan.md` — building
/// screens before that classification exists is how a phone ends up rendering
/// the Template Builder.
class OverviewScreen extends StatelessWidget {
  const OverviewScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Command Centre')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            GlassCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('Signed in', style: text.titleMedium),
                  const SizedBox(height: 8),
                  Text(
                    'Feature surfaces land here per the M1 matrix. Billing, '
                    'token purchase and API usage never do — the app must not '
                    'show a price or a purchase (R-APL-5).',
                    style: text.bodySmall,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
