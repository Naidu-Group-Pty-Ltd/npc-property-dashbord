import 'package:flutter/material.dart';
import 'package:npc_core/npc_core.dart';

import '../portal_descriptor.dart';
import 'portal_app.dart';
import 'secure_store.dart';

/// Boots any of the five NPC apps.
///
/// Nothing here reaches the network: the backend is not known until a tenant is
/// resolved (`plan.md` R-ARCH-6), so the launch path only establishes local
/// state.
void bootstrapPortal({
  required NpcPortalDescriptor descriptor,
  required WidgetBuilder home,
  NpcFlavor? flavor,
}) {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    PortalApp(
      descriptor: descriptor,
      flavor: flavor ?? NpcFlavor.fromEnvironment(),
      secureStore: FlutterSecureStoreAdapter.standard(),
      home: home,
    ),
  );
}
