import 'package:meta/meta.dart';

/// How an app presents its session credential to the backend.
///
/// The four portals and the Command Centre carry a session five different
/// ways, and the difference is load-bearing rather than cosmetic:
/// `_shared/csrfGuard.ts` stands aside for a request with no `Cookie` header,
/// so a header-carried session skips CSRF entirely, while a cookie-carried one
/// drags the whole browser threat model into a native client that has no need
/// of it.
@immutable
sealed class NpcCredentialTransport {
  const NpcCredentialTransport();

  /// The headers that present [token]. Empty when there is no native path.
  Map<String, String> headers(String token);

  /// Body fields that also carry the token, for functions that read the body.
  ///
  /// Belt and braces: several portal functions hand-roll their own extractor
  /// and not all of them read headers in the same order. Sending both costs
  /// nothing and removes a per-function failure mode.
  Map<String, Object?> bodyFields(String token) => const <String, Object?>{};

  /// Whether a native client can present a session this way at all.
  bool get isNative => true;
}

/// `Authorization: Bearer <jwt>` — the Command Centre.
///
/// `_shared/auth.ts` `verifyAuth` verifies the JWT and maps `sub` onto
/// `custom_users`.
@immutable
final class NpcBearerTransport extends NpcCredentialTransport {
  const NpcBearerTransport();

  @override
  Map<String, String> headers(String token) => <String, String>{
    'Authorization': 'Bearer $token',
  };
}

/// A portal's own `x-*-session-token` header.
///
/// [bodyField] and [legacyBodyField] mirror what the server's extractor
/// accepts; `financeSessionToken.ts` for instance tries
/// `x-finance-session-token` → `finance_session_token` → `x-session-token` →
/// `session_token` → cookie.
@immutable
final class NpcHeaderTransport extends NpcCredentialTransport {
  const NpcHeaderTransport({
    required this.header,
    this.bodyField,
    this.legacyBodyField = 'session_token',
  });

  final String header;
  final String? bodyField;
  final String? legacyBodyField;

  @override
  Map<String, String> headers(String token) => <String, String>{header: token};

  @override
  Map<String, Object?> bodyFields(String token) => <String, Object?>{
    ?bodyField: token,
    ?legacyBodyField: token,
  };
}

/// The session exists only as an HttpOnly cookie — there is no native carrier.
///
/// `builderSessionToken.ts` is explicit that this is a choice, not an
/// oversight: *"Builder has no legacy clients, so it is COOKIE-ONLY. There is
/// nothing to migrate away from later."* Its `extractBuilderSessionToken` takes
/// no body parameter at all.
///
/// A native client could technically run a cookie jar and replay the cookie,
/// but that is an app pretending to be a browser: it re-arms `enforceCsrf`,
/// requires an allow-listed `Origin`, and makes native traffic
/// indistinguishable from web traffic. This transport therefore reports
/// [isNative] `false`, and the app says so rather than faking it.
@immutable
final class NpcCookieOnlyTransport extends NpcCredentialTransport {
  const NpcCookieOnlyTransport({required this.cookieName});

  final String cookieName;

  @override
  Map<String, String> headers(String token) => const <String, String>{};

  @override
  bool get isNative => false;
}
