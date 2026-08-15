import 'package:meta/meta.dart';
import 'package:npc_api/npc_api.dart';

import 'credential_transport.dart';

/// Where a portal's login puts the session token.
enum NpcTokenDelivery {
  /// `session_token` in the JSON body. Client, finance and the Command Centre.
  responseBody,

  /// Only in `Set-Cookie`. Solicitor (`session_token: null` by choice) and
  /// builder (*"No raw session token is returned in JSON"*). A native client
  /// can still read the header off the response, so this is not fatal on its
  /// own — it is fatal combined with a cookie-only transport.
  setCookieHeader,
}

/// One portal's wire contract, as audited from the edge functions.
///
/// This type exists so five apps can share one auth implementation. Everything
/// that differs between the portals is a field here; nothing that differs is a
/// code path. `portal_descriptor_test.dart` pins every value against the audit,
/// so an optimistic edit cannot quietly claim a portal is reachable when the
/// server still refuses it.
@immutable
class NpcPortalDescriptor {
  const NpcPortalDescriptor({
    required this.id,
    required this.displayName,
    required this.functionPrefix,
    required this.transport,
    required this.tokenDelivery,
    required this.scope,
    required this.sessionLifetime,
    this.tokenBodyField = 'session_token',
    this.revocableSessions = true,
    this.portalDiscriminator,
    this.idleTimeout,
    this.requiresAllowListedOrigin = false,
    this.requiresTurnstile = false,
    this.selectsOrganisation = false,
  });

  /// `client` | `finance` | `solicitor` | `builder` | `command_centre`.
  final String id;
  final String displayName;

  /// Edge-function prefix — `finance-portal` gives `finance-portal-login`.
  final String functionPrefix;

  final NpcCredentialTransport transport;
  final NpcTokenDelivery tokenDelivery;
  final NpcFunctionScope scope;

  /// The JSON field login puts the token in. The Command Centre says
  /// `access_token`; every portal says `session_token`.
  final String tokenBodyField;

  /// Whether revoking the session server-side actually invalidates the
  /// credential this app holds.
  ///
  /// False for the Command Centre: its 24-hour `access_token` is not bound to
  /// the `user_sessions` row, so signing out elsewhere does not kill it
  /// (`ARCHITECTURE.md` A2). An unrevocable credential on a lost phone is not
  /// an acceptable posture, so [NpcPortalAuth] refuses to use one in a
  /// production build.
  final bool revocableSessions;

  /// Value for the `x-portal-request` header, where the portal demands one.
  final String? portalDiscriminator;

  /// Absolute session lifetime, from the login function.
  final Duration sessionLifetime;

  /// Sliding idle timeout, where the portal has one. Solicitor and builder
  /// re-slide it on every successful resolve, so a polling client keeps its
  /// own session alive.
  final Duration? idleTimeout;

  /// Whether every request must carry an allow-listed `Origin`.
  ///
  /// `validateSolicitorPortalHeaders` / `validateBuilderPortalHeaders` reject a
  /// missing Origin outright. A native app has no Origin — it is a browser CORS
  /// concept — so this is a hard blocker until the server admits an attested
  /// native caller instead.
  final bool requiresAllowListedOrigin;

  /// Whether login requires a Cloudflare Turnstile token in `turnstile_token`.
  final bool requiresTurnstile;

  /// Builder only: a multi-organisation account must choose a scope after
  /// sign-in, and the choice is held on the session row server-side.
  final bool selectsOrganisation;

  String get loginFunction => '$functionPrefix-login';
  String get verifyFunction => '$functionPrefix-verify';
  String get logoutFunction => '$functionPrefix-logout';

  /// Why this portal cannot yet be reached natively. Empty means it can.
  ///
  /// Derived rather than declared, so a descriptor cannot claim readiness its
  /// own fields contradict.
  List<String> get nativeBlockers => <String>[
    if (!transport.isNative)
      'the session is issued only as an HttpOnly cookie, and the server '
          'reads no header or body carrier',
    if (requiresAllowListedOrigin)
      'every request must carry an allow-listed Origin, which a native '
          'client does not have',
  ];

  /// Whether a native client can complete sign-in and call data functions.
  bool get isNativeReady => nativeBlockers.isEmpty;

  /// Headers every request to this portal carries, before the credential.
  Map<String, String> get baseHeaders => <String, String>{
    'x-portal-request': ?portalDiscriminator,
  };
}
