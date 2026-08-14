import 'package:npc_auth/npc_auth.dart';
import 'package:npc_core/npc_core.dart';
import 'package:test/test.dart';

NpcSession session({DateTime? expiresAt, String? sid, String? refresh}) =>
    NpcSession(
      accessToken: 'jwt',
      accessTokenExpiresAt:
          expiresAt ?? DateTime.now().toUtc().add(const Duration(minutes: 15)),
      userId: 'u1',
      username: 'lavan',
      roles: const <String>['admin'],
      refreshToken: refresh,
      sessionId: sid,
    );

void main() {
  group('revocability', () {
    test('a session without a sid claim is not revocable', () {
      // This is the A2 gap: the existing 24-hour token is not bound to the
      // user_sessions row, so revoking the session does not invalidate it.
      expect(session().isRevocable, isFalse);
    });

    test('a session with a sid claim is revocable', () {
      expect(session(sid: 'sess-1').isRevocable, isTrue);
    });
  });

  group('refresh timing', () {
    test('refreshes a minute before expiry, not at it', () {
      final DateTime now = DateTime.utc(2026, 8, 14, 12);
      final NpcSession s = session(
        expiresAt: now.add(const Duration(seconds: 90)),
      );
      expect(s.needsRefresh(now: now), isFalse);
      expect(
        s.needsRefresh(now: now.add(const Duration(seconds: 31))),
        isTrue,
        reason:
            'a request must not be issued against a token that expires '
            'while it is in flight',
      );
    });

    test('an expired token needs refresh', () {
      final DateTime now = DateTime.utc(2026, 8, 14, 12);
      expect(
        session(expiresAt: now.subtract(const Duration(hours: 1)))
            .needsRefresh(now: now),
        isTrue,
      );
    });
  });

  group('storage', () {
    test('round-trips through the secure store', () async {
      final InMemorySecureStore store = InMemorySecureStore();
      final NpcSessionStore sessions = NpcSessionStore(store);
      await sessions.write(session(sid: 's1', refresh: 'r1'));

      final NpcSession? restored = await sessions.read();
      expect(restored, isNotNull);
      expect(restored!.username, 'lavan');
      expect(restored.refreshToken, 'r1');
      expect(restored.sessionId, 's1');
      expect(restored.roles, <String>['admin']);
    });

    test('a corrupt record is discarded, not thrown', () async {
      final InMemorySecureStore store = InMemorySecureStore();
      await store.write(NpcSessionStore.sessionKey, 'not json');
      final NpcSessionStore sessions = NpcSessionStore(store);

      expect(await sessions.read(), isNull);
      // and it is cleared, so the next launch is not stuck on it
      expect(await store.read(NpcSessionStore.sessionKey), isNull);
    });

    test('clear removes the session', () async {
      final InMemorySecureStore store = InMemorySecureStore();
      final NpcSessionStore sessions = NpcSessionStore(store);
      await sessions.write(session());
      await sessions.clear();
      expect(await sessions.read(), isNull);
    });
  });

  group('install id', () {
    test('is stable across reads', () async {
      final NpcInstallId ids = NpcInstallId(InMemorySecureStore());
      final String first = await ids.read();
      expect(await ids.read(), first);
    });

    test('survives sign-out so a seat is reclaimed, not doubled', () async {
      // The seat cap can be as low as two; minting a new id per sign-in would
      // consume the whole plan in two logins.
      final InMemorySecureStore store = InMemorySecureStore();
      final String first = await NpcInstallId(store).read();
      await NpcSessionStore(store).clear();
      expect(await NpcInstallId(store).read(), first);
    });

    test('generates distinct v4 UUIDs', () {
      final Set<String> minted = <String>{
        for (int i = 0; i < 200; i++) NpcInstallId.generate(),
      };
      expect(minted.length, 200);
      expect(
        RegExp(
          r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
        ).hasMatch(minted.first),
        isTrue,
      );
    });
  });

  group('legacy auth mode', () {
    test('is refused in production', () {
      // An unrevocable 24-hour credential must never ship to a device.
      expect(
        () => NpcStaffAuth(
          functionsBaseUrl: 'https://example.invalid',
          anonKey: 'anon',
          flavor: NpcFlavor.production,
          mode: NpcStaffAuthMode.legacy,
        ),
        throwsA(isA<AssertionError>()),
      );
    });

    test('is permitted in development', () {
      expect(
        NpcStaffAuth(
          functionsBaseUrl: 'https://example.invalid',
          anonKey: 'anon',
          flavor: NpcFlavor.development,
          mode: NpcStaffAuthMode.legacy,
        ).mode,
        NpcStaffAuthMode.legacy,
      );
    });

    test('cannot refresh, and says so', () async {
      final NpcStaffAuth auth = NpcStaffAuth(
        functionsBaseUrl: 'https://example.invalid',
        anonKey: 'anon',
        flavor: NpcFlavor.development,
        mode: NpcStaffAuthMode.legacy,
      );
      final NpcResult<NpcSession> result = await auth.refresh(
        session(refresh: 'r1'),
      );
      expect(result, isA<NpcFailure<NpcSession>>());
      expect((result as NpcFailure<NpcSession>).code, 'refresh_unavailable');
    });
  });
}
