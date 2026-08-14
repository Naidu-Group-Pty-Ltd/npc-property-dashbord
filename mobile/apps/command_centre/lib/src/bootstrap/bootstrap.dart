import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:npc_auth/npc_auth.dart';
import 'package:npc_core/npc_core.dart';

import '../app.dart';
import 'secure_store.dart';

/// Boots the Command Centre for [flavor].
///
/// Nothing here reaches the network. The backend is not known yet — it is
/// resolved from the tenant the user names (plan.md R-ARCH-6), so the launch
/// path only has to establish local state.
Future<void> bootstrap(NpcFlavor flavor) async {
  WidgetsFlutterBinding.ensureInitialized();

  const FlutterSecureStorage storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );
  final NpcSecureStore store = FlutterSecureStoreAdapter(storage);

  runApp(
    CommandCentreApp(
      flavor: flavor,
      secureStore: store,
      installId: NpcInstallId(store),
      sessionStore: NpcSessionStore(store),
    ),
  );
}
