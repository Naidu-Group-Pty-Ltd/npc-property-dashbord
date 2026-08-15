import 'package:npc_api/npc_api.dart';

import 'credential_transport.dart';
import 'portal_descriptor.dart';

/// The five apps' wire contracts, as read from the edge functions.
///
/// Every value here was taken from source, not from documentation — the
/// planning that preceded this claimed finance, solicitor and builder were all
/// cookie-only, and three of those four claims were wrong. `portals_test.dart`
/// pins each field so the same mistake cannot be made by assumption again.
class NpcPortals {
  const NpcPortals._();

  /// Command Centre. `custom-auth-login-v2` returns a 24-hour HS256
  /// `access_token`; `verifyAuth` accepts it as a `custom_users` identity.
  static const NpcPortalDescriptor commandCentre = NpcPortalDescriptor(
    id: 'command_centre',
    displayName: 'Command Centre',
    functionPrefix: 'custom-auth',
    transport: NpcBearerTransport(),
    tokenDelivery: NpcTokenDelivery.responseBody,
    scope: NpcFunctionScope.staff,
    sessionLifetime: Duration(hours: 24),
    tokenBodyField: 'access_token',
    // A2: the token is not bound to the session row, so nothing can revoke it.
    revocableSessions: false,
  );

  /// Client portal. `client-portal-login` returns `session_token` in the body
  /// and every data function reads `x-portal-session-token`.
  static const NpcPortalDescriptor client = NpcPortalDescriptor(
    id: 'client',
    displayName: 'Client Portal',
    functionPrefix: 'client-portal',
    transport: NpcHeaderTransport(
      header: 'x-portal-session-token',
      bodyField: 'portal_session_token',
    ),
    tokenDelivery: NpcTokenDelivery.responseBody,
    scope: NpcFunctionScope.portal,
    sessionLifetime: Duration(hours: 24),
    requiresTurnstile: true,
  );

  /// Finance portal. `financeSessionToken.ts` tries the header **first**, and
  /// its own comment notes that applying the CSRF guard to header auth "would
  /// only break non-browser callers for no gain".
  ///
  /// One thing to know: `finance-portal-verify` does **not** re-issue the
  /// token, so a native client must keep what login gave it.
  static const NpcPortalDescriptor finance = NpcPortalDescriptor(
    id: 'finance',
    displayName: 'Finance Portal',
    functionPrefix: 'finance-portal',
    transport: NpcHeaderTransport(
      header: 'x-finance-session-token',
      bodyField: 'finance_session_token',
    ),
    tokenDelivery: NpcTokenDelivery.responseBody,
    scope: NpcFunctionScope.portal,
    sessionLifetime: Duration(hours: 12),
    requiresTurnstile: true,
  );

  /// Solicitor portal. The header carrier works — `resolveSolicitorSession`
  /// hashes and looks up the current session table whatever the source — but
  /// login answers `session_token: null`, so the token has to come off
  /// `Set-Cookie`, and every request is Origin-gated.
  static const NpcPortalDescriptor solicitor = NpcPortalDescriptor(
    id: 'solicitor',
    displayName: 'Solicitor Portal',
    functionPrefix: 'solicitor-portal',
    transport: NpcHeaderTransport(
      header: 'x-solicitor-session-token',
      bodyField: 'solicitor_session_token',
      legacyBodyField: null,
    ),
    tokenDelivery: NpcTokenDelivery.setCookieHeader,
    scope: NpcFunctionScope.portal,
    portalDiscriminator: 'solicitor-portal',
    sessionLifetime: Duration(hours: 12),
    idleTimeout: Duration(minutes: 30),
    requiresAllowListedOrigin: true,
    requiresTurnstile: true,
  );

  /// Builder portal. Cookie-only by design, and Origin-gated — the two
  /// blockers that keep it off a device until the server admits a native
  /// caller.
  static const NpcPortalDescriptor builder = NpcPortalDescriptor(
    id: 'builder',
    displayName: 'Builder Portal',
    functionPrefix: 'builder-portal',
    transport: NpcCookieOnlyTransport(
      cookieName: '__Host-builder_session_token',
    ),
    tokenDelivery: NpcTokenDelivery.setCookieHeader,
    scope: NpcFunctionScope.portal,
    portalDiscriminator: 'builder-portal',
    sessionLifetime: Duration(hours: 12),
    idleTimeout: Duration(minutes: 30),
    requiresAllowListedOrigin: true,
    requiresTurnstile: true,
    selectsOrganisation: true,
  );

  /// The four portal apps.
  static const List<NpcPortalDescriptor> portals = <NpcPortalDescriptor>[
    client,
    finance,
    solicitor,
    builder,
  ];

  /// Every app, including the Command Centre.
  static const List<NpcPortalDescriptor> all = <NpcPortalDescriptor>[
    commandCentre,
    client,
    finance,
    solicitor,
    builder,
  ];

  static NpcPortalDescriptor? byId(String id) {
    for (final NpcPortalDescriptor d in all) {
      if (d.id == id) return d;
    }
    return null;
  }
}
