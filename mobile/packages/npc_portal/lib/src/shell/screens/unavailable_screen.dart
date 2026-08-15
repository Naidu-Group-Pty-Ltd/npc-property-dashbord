import 'package:flutter/material.dart';

import '../portal_app_state.dart';
import 'glass_card.dart';

/// Shown when this app has no native path to its backend yet.
///
/// Solicitor and builder are here today: solicitor because every request needs
/// an allow-listed `Origin` a native client does not have, builder because that
/// plus its session is issued only as an HttpOnly cookie.
///
/// Saying so is the point. The alternative — the previous scaffolds — was
/// `throw UnimplementedError` at `main()`, which tells a tester nothing and
/// looks identical to a crash. An app that cannot work should explain itself
/// and stay on screen.
class PortalUnavailableScreen extends StatelessWidget {
  const PortalUnavailableScreen({required this.state, super.key});

  final PortalAppState state;

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    return GlassPage(
      children: <Widget>[
        Text(state.descriptor.displayName, style: text.headlineSmall),
        const SizedBox(height: 8),
        Text(
          'This app is not available on mobile yet. The backend refuses a '
          'native client for the following reason'
          '${state.blockers.length == 1 ? '' : 's'}:',
          style: text.bodyMedium,
        ),
        const SizedBox(height: 16),
        ...state.blockers.map(
          (String blocker) => Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Text('•  '),
                Expanded(child: Text(blocker, style: text.bodySmall)),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'Please continue using the web portal. This screen will be replaced '
          'once the server admits an attested native client.',
          style: text.bodySmall,
        ),
      ],
    );
  }
}
