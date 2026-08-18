import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:npc_core/npc_core.dart';
import 'package:npc_portal/npc_portal.dart';

NpcPortalAuth authFor(NpcPortalDescriptor d) => NpcPortalAuth(
  descriptor: d,
  functionsBaseUrl: 'https://example.invalid/functions/v1',
  anonKey: 'anon',
);

void main() {
  group('sign-in refuses before the network when a portal is blocked', () {
    test('builder explains the cookie-only blocker', () async {
      final NpcResult<String> r = await authFor(NpcPortals.builder)
          .signIn(email: 'a@b.c', password: 'x');
      expect(r, isA<NpcFailure<String>>());
      final NpcFailure<String> f = r as NpcFailure<String>;
      expect(f.code, 'portal_not_native_ready');
      expect(f.message, contains('HttpOnly cookie'));
    });

    test('solicitor explains the Origin blocker', () async {
      final NpcResult<String> r = await authFor(NpcPortals.solicitor)
          .signIn(email: 'a@b.c', password: 'x');
      expect((r as NpcFailure<String>).message, contains('Origin'));
    });
  });

  group('token extraction follows the portal contract', () {
    test('finance reads session_token from the body', () {
      final String? token = authFor(NpcPortals.finance).readToken(
        http.Response('{}', 200),
        <String, Object?>{'session_token': 'fin-tok'},
      );
      expect(token, 'fin-tok');
    });

    test('solicitor reads it off Set-Cookie, because the body says null', () {
      final String? token = authFor(NpcPortals.solicitor).readToken(
        http.Response(
          '{}',
          200,
          headers: <String, String>{
            'set-cookie': '__Host-solicitor_session_token=abc%2F123; HttpOnly; Secure; SameSite=None; Path=/',
          },
        ),
        <String, Object?>{'session_token': null},
      );
      expect(token, 'abc/123', reason: 'the cookie value is percent-decoded');
    });

    test('an absent token is null rather than an empty string', () {
      expect(
        authFor(NpcPortals.finance)
            .readToken(http.Response('{}', 200), <String, Object?>{}),
        isNull,
      );
      expect(
        authFor(NpcPortals.solicitor)
            .readToken(http.Response('{}', 200), <String, Object?>{}),
        isNull,
      );
    });
  });

  group('auth-failure detection', () {
    test('401 and 403 are auth failures', () {
      expect(
        NpcPortalAuth.isAuthFailure(401, const <String, Object?>{}),
        isTrue,
      );
      expect(
        NpcPortalAuth.isAuthFailure(403, const <String, Object?>{}),
        isTrue,
      );
    });

    test('a 400 that means "no session" is an auth failure too', () {
      // Several portal functions answer a missing session with 400, and a
      // client that only checks 401 treats that as a data error and never
      // re-authenticates.
      for (final String message in <String>[
        'Authentication required',
        'Session token is required',
        'Invalid or expired session',
      ]) {
        expect(
          NpcPortalAuth.isAuthFailure(400, <String, Object?>{'error': message}),
          isTrue,
          reason: message,
        );
      }
    });

    test('an ordinary 400 is not an auth failure', () {
      expect(
        NpcPortalAuth.isAuthFailure(400, const <String, Object?>{
          'error': 'invalid_body',
        }),
        isFalse,
      );
      expect(
        NpcPortalAuth.isAuthFailure(200, const <String, Object?>{}),
        isFalse,
      );
      expect(
        NpcPortalAuth.isAuthFailure(500, const <String, Object?>{}),
        isFalse,
      );
    });
  });
}
