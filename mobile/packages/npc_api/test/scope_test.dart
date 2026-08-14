import 'package:npc_api/npc_api.dart';
import 'package:test/test.dart';

/// The scope contract from mobile/plan.md R-ARCH-4.
void main() {
  test('the four scopes are disjoint', () {
    expect(NpcFunctions.staff.intersection(NpcFunctions.portal), isEmpty);
    expect(NpcFunctions.staff.intersection(NpcFunctions.public), isEmpty);
    expect(NpcFunctions.portal.intersection(NpcFunctions.public), isEmpty);
    expect(NpcFunctions.staff.intersection(NpcFunctions.serverOnly), isEmpty);
  });

  test('a staff app may not call a portal function', () {
    final Set<String> allowed = NpcFunctions.allowedFor(NpcFunctionScope.staff);
    expect(allowed.intersection(NpcFunctions.portal), isEmpty);
    expect(allowed.intersection(NpcFunctions.serverOnly), isEmpty);
    expect(allowed.containsAll(NpcFunctions.public), isTrue);
  });

  test('a portal app may not call a staff function', () {
    final Set<String> allowed = NpcFunctions.allowedFor(
      NpcFunctionScope.portal,
    );
    expect(allowed.intersection(NpcFunctions.staff), isEmpty);
    expect(allowed.intersection(NpcFunctions.serverOnly), isEmpty);
  });

  test('server-only functions are callable by nobody', () {
    for (final NpcFunctionScope scope in NpcFunctionScope.values) {
      expect(
        NpcFunctions.allowedFor(scope).intersection(NpcFunctions.serverOnly),
        isEmpty,
      );
    }
  });

  test('the client refuses an out-of-scope call loudly', () async {
    final NpcApiClient client = NpcApiClient(
      functionsBaseUrl: 'https://example.invalid/functions/v1',
      anonKey: 'anon',
      scope: NpcFunctionScope.staff,
      accessTokenProvider: () async => null,
    );
    final String portalOnly = NpcFunctions.portal.first;
    expect(client.permits(portalOnly), isFalse);
    // A StateError, not a failure result: the scope lint should have caught
    // this at build time, so reaching it at runtime is a programmer error.
    expect(() => client.invoke(portalOnly), throwsStateError);
  });

  test('the registry is not empty in any client-callable scope', () {
    expect(NpcFunctions.staff, isNotEmpty);
    expect(NpcFunctions.portal, isNotEmpty);
    expect(NpcFunctions.public, isNotEmpty);
  });
}
