import 'package:flutter/foundation.dart';
import 'package:npc_api/npc_api.dart';
import 'package:npc_auth/npc_auth.dart';
import 'package:npc_brand/npc_brand.dart';
import 'package:npc_core/npc_core.dart';
import 'package:npc_tenant/npc_tenant.dart';

/// Which screen the shell should be showing.
enum CommandCentreStage {
  /// Reading persisted state at launch.
  restoring,

  /// No tenant resolved — ask for a workspace.
  needsTenant,

  /// Tenant known, nobody signed in.
  needsSignIn,

  /// Signed in, but every device seat on the plan is taken.
  seatLimitReached,

  /// Signed in and usable.
  ready,
}

/// The Command Centre's application state.
///
/// Deliberately a [ChangeNotifier] rather than a heavier state solution: the
/// shell has one linear progression (tenant → session → seat → ready), and the
/// feature screens own their own data.
class CommandCentreState extends ChangeNotifier {
  CommandCentreState({
    required this.flavor,
    required this.installId,
    required this.sessionStore,
    required this.discovery,
  });

  final NpcFlavor flavor;
  final NpcInstallId installId;
  final NpcSessionStore sessionStore;
  final NpcTenantDiscovery discovery;

  CommandCentreStage _stage = CommandCentreStage.restoring;
  NpcTenant? _tenant;
  NpcSession? _session;
  NpcBrandConfig _brand = const NpcBrandConfig();
  NpcSeatLimitReached? _seatLimit;

  CommandCentreStage get stage => _stage;
  NpcTenant? get tenant => _tenant;
  NpcSession? get session => _session;
  NpcBrandConfig get brand => _brand;
  NpcSeatLimitReached? get seatLimit => _seatLimit;

  /// The API client for the resolved tenant, or null before one is resolved.
  ///
  /// Always `staff` scope: a Command Centre build that names a portal function
  /// fails `check-api-scope.mjs` at build time, and this is the runtime half of
  /// the same rule (plan.md R-ARCH-4).
  NpcApiClient? get api {
    final NpcTenant? t = _tenant;
    if (t == null) return null;
    return NpcApiClient(
      functionsBaseUrl: '${t.supabaseUrl}/functions/v1',
      anonKey: t.anonKey,
      scope: NpcFunctionScope.staff,
      accessTokenProvider: () async => _session?.accessToken,
    );
  }

  /// Restores persisted tenant and session at launch.
  Future<void> restore() async {
    final NpcSession? existing = await sessionStore.read();
    _session = existing;
    _stage = _tenant == null
        ? CommandCentreStage.needsTenant
        : existing == null
        ? CommandCentreStage.needsSignIn
        : CommandCentreStage.ready;
    notifyListeners();
  }

  /// Resolves a workspace slug to its backend.
  Future<NpcResult<NpcTenant>> resolveTenant(String slug) async {
    final NpcResult<NpcTenant> result = await discovery.resolve(slug);
    if (result case NpcSuccess<NpcTenant>(:final NpcTenant value)) {
      _tenant = value;
      _stage = _session == null
          ? CommandCentreStage.needsSignIn
          : CommandCentreStage.ready;
      notifyListeners();
    }
    return result;
  }

  /// Records a signed-in session.
  void adoptSession(NpcSession session) {
    _session = session;
    _stage = CommandCentreStage.ready;
    notifyListeners();
  }

  /// Records that the plan's device cap is full.
  ///
  /// This is a stage, not an error, because it is a routine outcome on a
  /// two-seat plan and the user must be offered the device list
  /// (ARCHITECTURE.md A5).
  void adoptSeatLimit(NpcSeatLimitReached limit) {
    _seatLimit = limit;
    _stage = CommandCentreStage.seatLimitReached;
    notifyListeners();
  }

  /// Applies the tenant's brand once it has been fetched.
  void adoptBrand(NpcBrandConfig brand) {
    _brand = brand;
    notifyListeners();
  }

  Future<void> signOut() async {
    await sessionStore.clear();
    _session = null;
    _seatLimit = null;
    _stage = _tenant == null
        ? CommandCentreStage.needsTenant
        : CommandCentreStage.needsSignIn;
    notifyListeners();
  }
}
