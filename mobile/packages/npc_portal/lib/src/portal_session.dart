import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:npc_core/npc_core.dart';

import 'credential_transport.dart';
import 'portal_descriptor.dart';

/// Signs in to any of the four portals, and to the Command Centre.
///
/// One implementation for five apps. The portals differ only in the values on
/// their [NpcPortalDescriptor]; the sequence — post credentials, take the
/// token, present it back — is identical, which is why four copies of this
/// would be four places for the same bug.
class NpcPortalAuth {
  NpcPortalAuth({
    required this.descriptor,
    required this.functionsBaseUrl,
    required this.anonKey,
    this.flavor = NpcFlavor.development,
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  final NpcPortalDescriptor descriptor;
  final NpcFlavor flavor;
  final String functionsBaseUrl;
  final String anonKey;
  final http.Client _http;
  static const NpcLog _log = NpcLog('npc_portal.auth');

  /// Signs in with an email and password.
  ///
  /// Refuses before touching the network when the portal has no native path —
  /// a request that the server is certain to reject is not worth making, and
  /// the blocker is more useful to the user than a 401.
  Future<NpcResult<String>> signIn({
    required String email,
    required String password,
    String? turnstileToken,
  }) async {
    if (flavor.isProduction && !descriptor.revocableSessions) {
      return NpcFailure<String>(
        'session_not_revocable',
        'The ${descriptor.displayName} cannot sign in on this build: its '
            'credential cannot be revoked remotely.',
      );
    }
    if (!descriptor.isNativeReady) {
      return NpcFailure<String>(
        'portal_not_native_ready',
        'The ${descriptor.displayName} is not yet available on mobile: '
            '${descriptor.nativeBlockers.first}.',
      );
    }

    try {
      final http.Response response = await _http
          .post(
            Uri.parse('$functionsBaseUrl/${descriptor.loginFunction}'),
            headers: <String, String>{
              'Content-Type': 'application/json',
              'apikey': anonKey,
              ...descriptor.baseHeaders,
            },
            body: jsonEncode(<String, Object?>{
              'email': email,
              'password': password,
              // Omitted entirely when absent: the server treats a null and a
              // missing key identically, and the Zod field is optional.
              'turnstile_token': ?turnstileToken,
            }),
          )
          .timeout(const Duration(seconds: 20));

      final Object? decoded = response.body.isEmpty
          ? null
          : jsonDecode(response.body);
      final Map<String, Object?> body = decoded is Map<String, Object?>
          ? decoded
          : <String, Object?>{};

      if (isAuthFailure(response.statusCode, body)) {
        return NpcFailure<String>(
          'invalid_credentials',
          (body['error'] ?? 'That email and password did not match.')
              .toString(),
        );
      }
      if (response.statusCode == 429) {
        return const NpcFailure<String>(
          'rate_limited',
          'Too many attempts. Please wait and try again.',
        );
      }
      if (response.statusCode != 200) {
        return NpcFailure<String>(
          (body['error'] ?? 'login_failed').toString(),
          (body['error'] ?? 'Sign-in could not be completed.').toString(),
        );
      }

      final String? token = readToken(response, body);
      if (token == null || token.isEmpty) {
        return const NpcFailure<String>(
          'no_session_token',
          'Sign-in succeeded but returned no session.',
        );
      }
      return NpcSuccess<String>(token);
    } catch (error) {
      _log.warn(
        'Portal sign-in failed',
        data: <String, Object?>{'portal': descriptor.id},
      );
      return const NpcFailure<String>(
        'network_error',
        'Could not reach the server. Check your connection and try again.',
      );
    }
  }

  /// Reads the session token from wherever this portal puts it.
  ///
  /// Client and finance answer with `session_token` in the body; solicitor and
  /// builder put it only in `Set-Cookie`, so it is parsed out of the header.
  String? readToken(http.Response response, Map<String, Object?> body) {
    switch (descriptor.tokenDelivery) {
      case NpcTokenDelivery.responseBody:
        final Object? token = body[descriptor.tokenBodyField];
        return token is String && token.isNotEmpty ? token : null;
      case NpcTokenDelivery.setCookieHeader:
        return _cookieValue(response.headers['set-cookie']);
    }
  }

  String? _cookieValue(String? setCookie) {
    if (setCookie == null || setCookie.isEmpty) return null;
    final NpcCredentialTransport t = descriptor.transport;
    final String name = t is NpcCookieOnlyTransport
        ? t.cookieName
        : '__Host-${descriptor.id}_session_token';
    final RegExpMatch? match = RegExp('$name=([^;]+)').firstMatch(setCookie);
    if (match == null) return null;
    return Uri.decodeComponent(match.group(1)!);
  }

  Future<void> signOut(String token) async {
    if (!descriptor.isNativeReady) return;
    try {
      await _http
          .post(
            Uri.parse('$functionsBaseUrl/${descriptor.logoutFunction}'),
            headers: <String, String>{
              'Content-Type': 'application/json',
              'apikey': anonKey,
              ...descriptor.baseHeaders,
              ...descriptor.transport.headers(token),
            },
            body: jsonEncode(descriptor.transport.bodyFields(token)),
          )
          .timeout(const Duration(seconds: 15));
    } catch (_) {
      // Best effort. Local state is cleared by the caller regardless, so a
      // failed network call cannot strand a user in a signed-in shell.
    }
  }

  /// Whether a response means "your session is not valid".
  ///
  /// Not simply `status == 401`. Several portal functions answer a missing
  /// session with `400 {error: 'Authentication required'}`, and a client that
  /// only checks 401 treats that as a data error and never re-authenticates.
  /// This is the rule `src/lib/secureInvoke.ts` already encodes on the web.
  static bool isAuthFailure(int status, Map<String, Object?> body) {
    if (status == 401 || status == 403) return true;
    if (status != 400) return false;
    final String message = '${body['error'] ?? ''} ${body['message'] ?? ''}'
        .toLowerCase();
    return message.contains('authentication required') ||
        message.contains('session token is required') ||
        message.contains('invalid or expired session') ||
        message.contains('session expired') ||
        message.contains('invalid email or password');
  }
}
