import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:npc_core/npc_core.dart';

import 'session.dart';

/// Signs a Command Centre user in and keeps their session fresh.
///
/// ## Why there are two paths
///
/// The backend **already** accepts a Bearer credential for a `custom_users`
/// identity: `custom-auth-login-v2` returns `access_token`, `verifyAuth`
/// verifies it, and `enforceCsrf` correctly stands aside because a cookieless
/// request carries no ambient authority (ARCHITECTURE.md A1). So a native
/// client can authenticate today with no server change — [legacy] is that
/// path, and it exists so the architecture can be proven end-to-end before any
/// new server code is written.
///
/// What it cannot do is revoke. That token lives 24 hours and is not bound to
/// the `user_sessions` row, so signing out elsewhere does not invalidate it
/// (A2). [native] is the path that fixes it, against `mobile-auth-login` /
/// `-refresh` / `-logout`.
///
/// **[legacy] must never ship to a device.** The flavor gate in
/// [NpcStaffAuth.new] enforces it: an unrevocable 24-hour credential on a lost
/// phone is not an acceptable staff-data posture.
enum NpcStaffAuthMode {
  /// Existing endpoints, no revocation. Development and staging only.
  legacy,

  /// `mobile-auth-*`: short-lived tokens, rotating refresh, revocable.
  native,
}

/// Staff authentication against one tenant's edge functions.
class NpcStaffAuth {
  NpcStaffAuth({
    required this.functionsBaseUrl,
    required this.anonKey,
    required this.flavor,
    this.mode = NpcStaffAuthMode.native,
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client(),
       assert(
         mode == NpcStaffAuthMode.native || !flavor.isProduction,
         'legacy auth issues an unrevocable 24-hour token and must not run in '
         'production (ARCHITECTURE.md A2)',
       );

  final String functionsBaseUrl;
  final String anonKey;
  final NpcFlavor flavor;
  final NpcStaffAuthMode mode;
  final http.Client _http;
  static const NpcLog _log = NpcLog('npc_auth.staff');

  String get _loginFunction => switch (mode) {
    NpcStaffAuthMode.legacy => 'custom-auth-login-v2',
    NpcStaffAuthMode.native => 'mobile-auth-login',
  };

  /// Signs in with a username and password.
  Future<NpcResult<NpcSession>> signIn({
    required String username,
    required String password,
  }) async {
    final NpcResult<Map<String, Object?>> result = await _post(
      _loginFunction,
      <String, Object?>{'username': username, 'password': password},
    );
    return switch (result) {
      NpcFailure<Map<String, Object?>>(
        :final String code,
        :final String message,
      ) =>
        NpcFailure<NpcSession>(code, message),
      NpcSuccess<Map<String, Object?>>(:final Map<String, Object?> value) =>
        _sessionFrom(value),
    };
  }

  /// Exchanges a refresh token for a new access token, rotating it.
  ///
  /// Only the native path can refresh; the legacy token has no refresh
  /// mechanism at all, so a legacy session simply expires and signs the user
  /// out — which is the correct behaviour for a credential nothing can revoke.
  Future<NpcResult<NpcSession>> refresh(NpcSession session) async {
    final String? token = session.refreshToken;
    if (mode == NpcStaffAuthMode.legacy || token == null) {
      return const NpcFailure<NpcSession>(
        'refresh_unavailable',
        'This session cannot be renewed. Please sign in again.',
      );
    }
    final NpcResult<Map<String, Object?>> result = await _post(
      'mobile-auth-refresh',
      <String, Object?>{'refresh_token': token},
    );
    return switch (result) {
      NpcFailure<Map<String, Object?>>(
        :final String code,
        :final String message,
      ) =>
        NpcFailure<NpcSession>(code, message),
      NpcSuccess<Map<String, Object?>>(:final Map<String, Object?> value) =>
        _sessionFrom(value, fallback: session),
    };
  }

  /// Revokes the server-side session. Best-effort: local state is cleared by
  /// the caller regardless, so a failed network call cannot strand a user in a
  /// signed-in shell.
  Future<void> signOut(NpcSession session) async {
    if (mode == NpcStaffAuthMode.legacy) return;
    await _post('mobile-auth-logout', <String, Object?>{
      'refresh_token': session.refreshToken,
    }, accessToken: session.accessToken);
  }

  NpcResult<NpcSession> _sessionFrom(
    Map<String, Object?> body, {
    NpcSession? fallback,
  }) {
    final Object? accessToken = body['access_token'];
    if (accessToken is! String || accessToken.isEmpty) {
      return const NpcFailure<NpcSession>(
        'no_access_token',
        'Sign-in succeeded but returned no credential.',
      );
    }
    final Map<String, Object?>? user = body['user'] is Map<String, Object?>
        ? body['user']! as Map<String, Object?>
        : null;

    // The legacy endpoint reports the *session cookie's* expiry, which is not
    // the JWT's. Its token is minted for 24 hours (login.ts:268), so that is
    // what the client must assume rather than trusting `expires_at`.
    final DateTime expiresAt = switch (mode) {
      NpcStaffAuthMode.legacy => DateTime.now().toUtc().add(
        const Duration(hours: 24),
      ),
      NpcStaffAuthMode.native =>
        DateTime.tryParse((body['access_token_expires_at'] ?? '').toString()) ??
            DateTime.now().toUtc().add(const Duration(minutes: 15)),
    };

    return NpcSuccess<NpcSession>(
      NpcSession(
        accessToken: accessToken,
        accessTokenExpiresAt: expiresAt,
        userId: (user?['id'] ?? fallback?.userId ?? '').toString(),
        username: (user?['username'] ?? fallback?.username ?? '').toString(),
        roles: body['roles'] is List
            ? List<String>.from(
                (body['roles']! as List<Object?>).whereType<String>(),
              )
            : (fallback?.roles ?? const <String>[]),
        refreshToken:
            (body['refresh_token'] as String?) ?? fallback?.refreshToken,
        sessionId: (body['session_id'] as String?) ?? fallback?.sessionId,
      ),
    );
  }

  Future<NpcResult<Map<String, Object?>>> _post(
    String function,
    Map<String, Object?> payload, {
    String? accessToken,
  }) async {
    try {
      final http.Response response = await _http
          .post(
            Uri.parse('$functionsBaseUrl/$function'),
            headers: <String, String>{
              'Content-Type': 'application/json',
              'apikey': anonKey,
              if (accessToken != null) 'Authorization': 'Bearer $accessToken',
            },
            body: jsonEncode(payload),
          )
          .timeout(const Duration(seconds: 20));

      final Object? decoded = jsonDecode(response.body);
      final Map<String, Object?> body = decoded is Map<String, Object?>
          ? decoded
          : <String, Object?>{};

      if (response.statusCode == 200 && body['error'] == null) {
        return NpcSuccess<Map<String, Object?>>(body);
      }
      if (response.statusCode == 401 || response.statusCode == 403) {
        return const NpcFailure<Map<String, Object?>>(
          'invalid_credentials',
          'That username and password did not match.',
        );
      }
      if (response.statusCode == 429) {
        return const NpcFailure<Map<String, Object?>>(
          'rate_limited',
          'Too many attempts. Please wait and try again.',
        );
      }
      return NpcFailure<Map<String, Object?>>(
        (body['error'] ?? 'request_failed').toString(),
        (body['message'] ?? 'Sign-in could not be completed.').toString(),
      );
    } catch (error) {
      _log.warn(
        'Auth call failed',
        data: <String, Object?>{'function': function},
      );
      return const NpcFailure<Map<String, Object?>>(
        'network_error',
        'Could not reach the server. Check your connection and try again.',
      );
    }
  }
}
