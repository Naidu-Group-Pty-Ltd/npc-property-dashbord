import 'dart:async';

import 'package:flutter/material.dart';
import 'package:npc_auth/npc_auth.dart';
import 'package:npc_brand/npc_brand.dart';
import 'package:npc_core/npc_core.dart';
import 'package:npc_design_system/npc_design_system.dart';
import 'package:npc_tenant/npc_tenant.dart';

import 'features/shell/app_state.dart';
import 'features/shell/router.dart';

/// The Command Centre application.
///
/// Holds the three things every screen needs — the resolved tenant, the
/// session, and the brand — and rebuilds the theme when any of them changes.
class CommandCentreApp extends StatefulWidget {
  const CommandCentreApp({
    required this.flavor,
    required this.secureStore,
    required this.installId,
    required this.sessionStore,
    this.discovery,
    super.key,
  });

  final NpcFlavor flavor;
  final NpcSecureStore secureStore;
  final NpcInstallId installId;
  final NpcSessionStore sessionStore;

  /// Injectable so widget tests can resolve a tenant without a network.
  final NpcTenantDiscovery? discovery;

  @override
  State<CommandCentreApp> createState() => _CommandCentreAppState();
}

class _CommandCentreAppState extends State<CommandCentreApp> {
  late final CommandCentreState _state = CommandCentreState(
    flavor: widget.flavor,
    installId: widget.installId,
    sessionStore: widget.sessionStore,
    discovery: widget.discovery ?? NpcTenantDiscovery(flavor: widget.flavor),
  );

  @override
  void initState() {
    super.initState();
    unawaited(_state.restore());
  }

  @override
  void dispose() {
    _state.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _state,
      builder: (BuildContext context, _) {
        final NpcBrandConfig brand = _state.brand;
        return MaterialApp(
          title: 'NPC Command Centre',
          debugShowCheckedModeBanner: !widget.flavor.isProduction,
          themeMode: brand.darkModeDefault,
          theme: _themeFor(context, NpcTheme.light, brand),
          darkTheme: _themeFor(context, NpcTheme.dark, brand),
          home: CommandCentreRouter(state: _state),
        );
      },
    );
  }

  ThemeData _themeFor(
    BuildContext context,
    String tokenSet,
    NpcBrandConfig brand,
  ) => brand.apply(
    NpcTheme.named(
      tokenSet,
      transparencyEnabled: NpcTheme.transparencyAllowed(context),
    ),
  );
}
