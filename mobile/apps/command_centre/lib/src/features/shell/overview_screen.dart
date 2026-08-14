import 'package:flutter/material.dart';

import 'app_state.dart';
import 'glass_card.dart';

/// The signed-in landing screen.
///
/// Intentionally a shell: the feature surfaces it will carry are decided by the
/// M1 feature matrix in `apps/command_centre/plan.md`, and building screens
/// before that classification exists is how a phone ends up rendering the
/// Template Builder.
class OverviewScreen extends StatelessWidget {
  const OverviewScreen({required this.state, super.key});

  final CommandCentreState state;

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    final String who = state.session?.username ?? '';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Command Centre'),
        actions: <Widget>[
          IconButton(
            onPressed: state.signOut,
            icon: const Icon(Icons.logout),
            tooltip: 'Sign out',
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            GlassCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('Signed in as $who', style: text.titleMedium),
                  const SizedBox(height: 8),
                  Text(
                    'Workspace: ${state.tenant?.slug ?? "unknown"}',
                    style: text.bodySmall,
                  ),
                  if (state.session?.isRevocable == false) ...<Widget>[
                    const SizedBox(height: 12),
                    Text(
                      'This session cannot be revoked remotely. Development '
                      'builds only.',
                      style: text.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
