import 'dart:async';

import 'package:flutter/material.dart';
import 'package:npc_auth/npc_auth.dart';
import 'package:npc_brand/npc_brand.dart';
import 'package:npc_core/npc_core.dart';
import 'package:npc_design_system/npc_design_system.dart';
import 'package:npc_tenant/npc_tenant.dart';

import '../portal_descriptor.dart';
import 'portal_app_state.dart';
import 'screens/seat_limit_screen.dart';
import 'screens/sign_in_screen.dart';
import 'screens/unavailable_screen.dart';
import 'screens/workspace_screen.dart';

/// The application shell every NPC app runs inside.
///
/// Five separate binaries, one shell. What differs per app is the
/// [NpcPortalDescriptor] and the [home] its own team builds — nothing about
/// tenancy, sign-in, theming, seats or the pre-auth progression is written
/// twice.
class PortalApp extends StatefulWidget {
  const PortalApp({
    required this.descriptor,
    required this.flavor,
    required this.secureStore,
    required this.home,
    this.discovery,
    super.key,
  });

  final NpcPortalDescriptor descriptor;
  final NpcFlavor flavor;
  final NpcSecureStore secureStore;

  /// The app's own signed-in surface.
  final WidgetBuilder home;

  /// Injectable so widget tests resolve a tenant without a network.
  final NpcTenantDiscovery? discovery;

  @override
  State<PortalApp> createState() => _PortalAppState();
}

class _PortalAppState extends State<PortalApp> {
  late final PortalAppState _state = PortalAppState(
    descriptor: widget.descriptor,
    flavor: widget.flavor,
    installId: NpcInstallId(widget.secureStore),
    sessionStore: NpcSessionStore(widget.secureStore),
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
          title: widget.descriptor.displayName,
          debugShowCheckedModeBanner: !widget.flavor.isProduction,
          themeMode: brand.darkModeDefault,
          theme: _themeFor(context, NpcTheme.light, brand),
          darkTheme: _themeFor(context, NpcTheme.dark, brand),
          home: PortalRouter(state: _state, home: widget.home),
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

/// Chooses the screen for the current [PortalAppState.stage].
///
/// Every stage has a real screen, including [PortalStage.unavailable] — no
/// stage dead-ends, which is the pre-auth completeness rule store review
/// actually checks (`plan.md` R-BOTH-1).
class PortalRouter extends StatelessWidget {
  const PortalRouter({required this.state, required this.home, super.key});

  final PortalAppState state;
  final WidgetBuilder home;

  @override
  Widget build(BuildContext context) {
    return switch (state.stage) {
      PortalStage.restoring => const Scaffold(
        body: Center(child: CircularProgressIndicator.adaptive()),
      ),
      PortalStage.unavailable => PortalUnavailableScreen(state: state),
      PortalStage.needsTenant => WorkspaceScreen(state: state),
      PortalStage.needsSignIn => SignInScreen(state: state),
      PortalStage.seatLimitReached => SeatLimitScreen(state: state),
      PortalStage.ready => home(context),
    };
  }
}
