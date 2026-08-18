import 'package:npc_core/npc_core.dart';
import 'package:npc_tenant/npc_tenant.dart';
import 'package:test/test.dart';

void main() {
  Map<String, Object?> doc() => <String, Object?>{
    'supabaseUrl': 'https://abc.supabase.co',
    'anonKey': 'anon-key',
    'minAppVersion': '1.2.0',
    'portalsEnabled': <String>['client', 'finance'],
  };

  group('discovery document', () {
    test('parses a complete document', () {
      final NpcTenant tenant = NpcTenant.fromDiscovery('npc', doc());
      expect(tenant.slug, 'npc');
      expect(tenant.supabaseUrl, 'https://abc.supabase.co');
      expect(tenant.portalsEnabled, <String>['client', 'finance']);
    });

    test('rejects a partial document rather than half-resolving', () {
      final Map<String, Object?> partial = doc()..remove('anonKey');
      expect(
        () => NpcTenant.fromDiscovery('npc', partial),
        throwsFormatException,
      );
    });

    test('survives a round trip through storage', () {
      final NpcTenant original = NpcTenant.fromDiscovery('npc', doc());
      final NpcTenant restored = NpcTenant.fromJson(original.toJson());
      expect(restored.supabaseUrl, original.supabaseUrl);
      expect(restored.minAppVersion, original.minAppVersion);
    });
  });

  group('minimum app version', () {
    final NpcTenant tenant = NpcTenant.fromDiscovery('npc', doc());

    test('accepts equal and newer', () {
      expect(tenant.supportsAppVersion('1.2.0'), isTrue);
      expect(tenant.supportsAppVersion('1.3.0'), isTrue);
      expect(tenant.supportsAppVersion('2.0.0'), isTrue);
    });

    test('refuses older', () {
      expect(tenant.supportsAppVersion('1.1.9'), isFalse);
      expect(tenant.supportsAppVersion('0.9.0'), isFalse);
    });

    test('treats a shorter version as zero-padded', () {
      // '1.2' zero-pads to '1.2.0', which IS the minimum — so it is supported.
      expect(tenant.supportsAppVersion('1.2'), isTrue);
      expect(tenant.supportsAppVersion('1.1'), isFalse);
      expect(tenant.supportsAppVersion('2'), isTrue);
      expect(tenant.supportsAppVersion('1'), isFalse);
    });

    test('an unparseable version is supported, not locked out', () {
      // Locking a user out because a version string was malformed is a worse
      // failure than serving a slightly old client.
      expect(tenant.supportsAppVersion('nightly'), isTrue);
    });
  });

  group('slug validation', () {
    final NpcTenantDiscovery discovery = NpcTenantDiscovery(
      flavor: NpcFlavor.development,
    );

    test('rejects malformed slugs before any network call', () async {
      for (final String bad in <String>[
        '',
        'a',
        'has space',
        'UPPER!',
        '-lead',
      ]) {
        final NpcResult<NpcTenant> result = await discovery.resolve(bad);
        expect(result, isA<NpcFailure<NpcTenant>>());
        expect((result as NpcFailure<NpcTenant>).code, 'invalid_slug');
      }
    });

    test('builds the discovery URL from the flavor domain', () {
      expect(
        discovery.discoveryUri('npc').toString(),
        'https://npc.dev.aurixasystems.com.au/.well-known/npc-mobile.json',
      );
      expect(
        NpcTenantDiscovery(flavor: NpcFlavor.production)
            .discoveryUri('npc')
            .toString(),
        'https://npc.aurixasystems.com.au/.well-known/npc-mobile.json',
      );
    });
  });
}
