import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:npc_core/npc_core.dart';

import 'functions.g.dart';

/// Calls NPC edge functions, and nothing else.
///
/// ## Why there is no Supabase data client anywhere in this estate
///
/// Both Supabase projects sign with ES256, so the HS256 token the platform
/// mints is rejected by PostgREST. A direct query against a protected table
/// does not fail — it runs as `anon` and returns **empty**
/// (ARCHITECTURE.md A4). A screen built that way looks like it works and shows
/// nothing, forever, and no test that mocks the client will catch it.
///
/// Realtime is unavailable for the same reason, which is why live surfaces
/// poll a cheap stamp and refetch only when it moves — the pattern
/// `syncStamp.pure.ts` already proved on the web.
///
/// ## Scope
///
/// The client is constructed for one [NpcFunctionScope] and refuses anything
/// outside it. `check-api-scope.mjs` makes the same rule a build failure by
/// scanning app sources, so the runtime guard here is the second line, not the
/// first.
class NpcApiClient {
  NpcApiClient({
    required this.functionsBaseUrl,
    required this.anonKey,
    required this.scope,
    required this.accessTokenProvider,
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  final String functionsBaseUrl;
  final String anonKey;
  final NpcFunctionScope scope;

  /// Supplies a currently-valid access token, refreshing if necessary.
  final Future<String?> Function() accessTokenProvider;

  final http.Client _http;
  static const NpcLog _log = NpcLog('npc_api');

  /// Whether this client is allowed to call [function].
  bool permits(String function) =>
      NpcFunctions.allowedFor(scope).contains(function);

  /// Invokes [function] with [payload].
  Future<NpcResult<Map<String, Object?>>> invoke(
    String function, {
    Map<String, Object?> payload = const <String, Object?>{},
  }) async {
    if (!permits(function)) {
      final NpcFunctionScope? actual = NpcFunctions.scopeOf(function);
      final String reason = actual == null
          ? 'is not in the audited registry'
          : 'is ${actual.name} scope, and this app is ${scope.name}';
      // Programmer error, not a user-facing failure: the scope lint should
      // have refused this at build time.
      throw StateError('Function "$function" $reason.');
    }

    final String? token = await accessTokenProvider();
    try {
      final http.Response response = await _http
          .post(
            Uri.parse('$functionsBaseUrl/$function'),
            headers: <String, String>{
              'Content-Type': 'application/json',
              'apikey': anonKey,
              // Header-only auth. No cookie is ever sent, which is also why
              // `enforceCsrf` correctly stands aside for these requests.
              if (token != null) 'Authorization': 'Bearer $token',
            },
            body: jsonEncode(payload),
          )
          .timeout(const Duration(seconds: 30));

      final Object? decoded = response.body.isEmpty
          ? null
          : jsonDecode(response.body);
      final Map<String, Object?> body = decoded is Map<String, Object?>
          ? decoded
          : <String, Object?>{};

      if (response.statusCode == 401) {
        return const NpcFailure<Map<String, Object?>>(
          'unauthenticated',
          'Your session has ended. Please sign in again.',
        );
      }
      if (response.statusCode >= 400) {
        return NpcFailure<Map<String, Object?>>(
          (body['error'] ?? 'request_failed').toString(),
          (body['message'] ?? 'That request could not be completed.')
              .toString(),
        );
      }
      return NpcSuccess<Map<String, Object?>>(body);
    } catch (error) {
      _log.warn(
        'Edge function call failed',
        data: <String, Object?>{'function': function},
      );
      return const NpcFailure<Map<String, Object?>>(
        'network_error',
        'Could not reach the server. Check your connection and try again.',
      );
    }
  }
}
