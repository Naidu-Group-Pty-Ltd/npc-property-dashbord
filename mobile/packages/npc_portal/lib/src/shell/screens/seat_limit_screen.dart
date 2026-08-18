import 'package:flutter/material.dart';
import 'package:npc_auth/npc_auth.dart';

import '../portal_app_state.dart';
import 'glass_card.dart';

/// Shown when every device seat on the tenant's plan is taken.
///
/// A screen rather than an error: `device_limit_per_seat` is 2 on the Starter
/// plan, so one browser plus this app is the cap (`ARCHITECTURE.md` A5). The
/// user is shown what holds the seats and offered a way out — the affordance
/// `ManageDevicesDialog` gives on the web.
class SeatLimitScreen extends StatelessWidget {
  const SeatLimitScreen({required this.state, super.key});

  final PortalAppState state;

  @override
  Widget build(BuildContext context) {
    final NpcSeatLimitReached? limit = state.seatLimit;
    final TextTheme text = Theme.of(context).textTheme;

    return GlassPage(
      children: <Widget>[
        Text('All devices in use', style: text.headlineSmall),
        const SizedBox(height: 8),
        Text(
          limit == null
              ? 'Your plan has no free device slots.'
              : 'Your plan allows ${limit.limit} '
                    '${limit.limit == 1 ? "device" : "devices"} and '
                    '${limit.active} are in use. Sign one out to continue here.',
          style: text.bodyMedium,
        ),
        const SizedBox(height: 16),
        if (limit != null)
          ...limit.devices.map(
            (NpcDevice device) => ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(device.label),
              subtitle: Text(device.platform ?? 'Unknown platform'),
            ),
          ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: state.signOut,
          child: const Text('Back to sign in'),
        ),
      ],
    );
  }
}
