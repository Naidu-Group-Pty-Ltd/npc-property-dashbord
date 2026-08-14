import 'package:npc_core/npc_core.dart';
import 'package:test/test.dart';

void main() {
  test('flavors carry distinct discovery domains', () {
    final Set<String> domains = NpcFlavor.values
        .map((NpcFlavor f) => f.discoveryDomain)
        .toSet();
    expect(domains.length, NpcFlavor.values.length);
    expect(NpcFlavor.production.isProduction, isTrue);
    expect(NpcFlavor.development.isProduction, isFalse);
  });

  test('the default flavor is development, never production', () {
    // A plain `flutter run` must not be able to reach production data.
    expect(NpcFlavor.fromEnvironment(), NpcFlavor.development);
  });

  test('results carry a code separately from a message', () {
    const NpcResult<int> ok = NpcSuccess<int>(7);
    expect(ok.isSuccess, isTrue);
    expect(ok.valueOrNull, 7);

    const NpcResult<int> bad = NpcFailure<int>('device_limit_reached', 'Full.');
    expect(bad.isSuccess, isFalse);
    expect(bad.valueOrNull, isNull);
    expect((bad as NpcFailure<int>).code, 'device_limit_reached');
  });

  test('the logger redacts credential-ish keys by name', () {
    final Map<String, Object?> redacted = NpcLog.redact(<String, Object?>{
      'username': 'lavan',
      'access_token': 'secret',
      'refreshToken': 'secret',
      'Authorization': 'Bearer x',
      'apikey': 'k',
      'count': 3,
    });
    expect(redacted['username'], 'lavan');
    expect(redacted['count'], 3);
    expect(redacted['access_token'], '[redacted]');
    expect(redacted['refreshToken'], '[redacted]');
    expect(redacted['Authorization'], '[redacted]');
    expect(redacted['apikey'], '[redacted]');
  });
}
