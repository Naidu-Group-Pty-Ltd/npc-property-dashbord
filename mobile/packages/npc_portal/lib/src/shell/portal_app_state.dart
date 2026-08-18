import 'package:flutter/foundation.dart';
import 'package:npc_api/npc_api.dart';
import 'package:npc_auth/npc_auth.dart';
import 'package:npc_brand/npc_brand.dart';
import 'package:npc_core/npc_core.dart';
import 'package:npc_tenant/npc_tenant.dart';

import '../portal_descriptor.dart';
import '../portal_session.dart';

/// Which screen the shell is showing.
enum PortalStage {
  /// Reading persisted state at launch.
  restoring,

  /// This app cannot reach its backend natively yet, and says why.
  unavailable,

  /// No tenant resolved — ask for a workspace.
  needsTenant,

  /// Tenant known, nobody signed in.
  needsSignIn,

  /// Signed in, but every device seat on the plan is taken.
  seatLimitReached,

  /// Signed in and usable.
  ready,
}

/// The state every NPC app runs on.
///
/// One progression — unavailable? → tenant → sign-in → seat → ready — shared by
/// all five binaries. Two shells would diverge, and the divergence would show up
/// as one portal quietly missing a step the others enforce.
class PortalAppState extends ChangeNotifier {
  PortalAppState({
    required this.descriptor,
    required this.flavor,
    required this.installId,
    required this.sessionStore,
    required this.discovery,
  });

  final NpcPortalDescriptor descriptor;
  final NpcFlavor flavor;
  final NpcInstallId installId;
  final NpcSessionStore sessionStore;
  final NpcTenantDiscovery discovery;

  PortalStage _stage = PortalStage.restoring;
  NpcTenant? _tenant;
  String? _sessionToken;
  NpcBrandConfig _brand = const NpcBrandConfig();
  NpcSeatLimitReached? _seatLimit;

  PortalStage get stage => _stage;
  NpcTenant? get tenant => _tenant;
  String? get sessionToken => _sessionToken;
  NpcBrandConfig get brand => _brand;
  NpcSeatLimitReached? get seatLimit => _seatLimit;

  /// Why this app cannot run natively, or empty when it can.
  List<String> get blockers => descriptor.nativeBlockers;

  /// The API client for the resolved tenant, scoped by the descriptor.
  ///
  /// An app cannot construct a client with another app's authority: the scope
  /// comes from the descriptor, never from the call site.
  NpcApiClient? get api {
    final NpcTenant? t = _tenant;
    if (t == null) return null;
    return NpcApiClient(
      functionsBaseUrl: '${t.supabaseUrl}/functions/v1',
      anonKey: t.anonKey,
      scope: descriptor.scope,
      accessTokenProvider: () async => _sessionToken,
    );
  }

  /// Authenticator for the resolved tenant, or null before one is resolved.
  NpcPortalAuth? get auth {
    final NpcTenant? t = _tenant;
    if (t == null) return null;
    return NpcPortalAuth(
      descriptor: descriptor,
      functionsBaseUrl: '${t.supabaseUrl}/functions/v1',
      anonKey: t.anonKey,
      flavor: flavor,
    );
  }

  /// Restores persisted state at launch.
  Future<void> restore() async {
    if (!descriptor.isNativeReady) {
      _stage = PortalStage.unavailable;
      notifyListeners();
      return;
    }
    final NpcSession? existing = await sessionStore.read();
    _sessionToken = existing?.accessToken;
    _stage = _tenant == null
        ? PortalStage.needsTenant
        : _sessionToken == null
        ? PortalStage.needsSignIn
        : PortalStage.ready;
    notifyListeners();
  }

  Future<NpcResult<NpcTenant>> resolveTenant(String slug) async {
    final NpcResult<NpcTenant> result = await discovery.resolve(slug);
    if (result case NpcSuccess<NpcTenant>(:final NpcTenant value)) {
      _tenant = value;
      _stage = _sessionToken == null
          ? PortalStage.needsSignIn
          : PortalStage.ready;
      notifyListeners();
    }
    return result;
  }

  Future<void> adoptSession(String token) async {
    _sessionToken = token;
    await sessionStore.write(
      NpcSession(
        accessToken: token,
        accessTokenExpiresAt: DateTime.now().toUtc().add(
          descriptor.sessionLifetime,
        ),
        userId: '',
        username: '',
        roles: const <String>[],
      ),
    );
    _stage = PortalStage.ready;
    notifyListeners();
  }

  /// Records that the plan's device cap is full.
  ///
  /// A stage rather than an error: it is routine on a two-seat plan, and the
  /// user is owed the device list rather than a failure toast.
  void adoptSeatLimit(NpcSeatLimitReached limit) {
    _seatLimit = limit;
    _stage = PortalStage.seatLimitReached;
    notifyListeners();
  }

  void adoptBrand(NpcBrandConfig brand) {
    _brand = brand;
    notifyListeners();
  }

  Future<void> signOut() async {
    final String? token = _sessionToken;
    if (token != null) await auth?.signOut(token);
    await sessionStore.clear();
    _sessionToken = null;
    _seatLimit = null;
    _stage = _tenant == null
        ? PortalStage.needsTenant
        : PortalStage.needsSignIn;
    notifyListeners();
  }
}
