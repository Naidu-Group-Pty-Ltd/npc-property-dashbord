import 'package:meta/meta.dart';

/// The backend an installation is bound to.
///
/// Mission Control provisions one clone per tenant, each on its own subdomain
/// with its own Supabase project (ARCHITECTURE.md A6). This descriptor is what
/// an app resolves at launch instead of compiling a URL in.
@immutable
class NpcTenant {
  const NpcTenant({
    required this.slug,
    required this.supabaseUrl,
    required this.anonKey,
    required this.minAppVersion,
    required this.portalsEnabled,
  });

  /// Parses a tenant's `/.well-known/npc-mobile.json`.
  ///
  /// Throws [FormatException] on anything missing. A half-resolved tenant is
  /// worse than an unresolved one: the app would boot pointing somewhere it
  /// cannot authenticate against and report it as a sign-in failure.
  factory NpcTenant.fromDiscovery(String slug, Map<String, Object?> json) {
    String required(String key) {
      final Object? value = json[key];
      if (value is! String || value.isEmpty) {
        throw FormatException('Discovery document missing "$key"', json);
      }
      return value;
    }

    final Object? portals = json['portalsEnabled'];
    return NpcTenant(
      slug: slug,
      supabaseUrl: required('supabaseUrl'),
      anonKey: required('anonKey'),
      minAppVersion: required('minAppVersion'),
      portalsEnabled: portals is List
          ? List<String>.unmodifiable(portals.whereType<String>())
          : const <String>[],
    );
  }

  /// The workspace slug, e.g. `npc` for `npc.aurixasystems.com.au`.
  final String slug;

  final String supabaseUrl;

  /// The publishable client key. Never a service key — a device holds no
  /// privileged credential, and no Mission Control clone key ever reaches one.
  final String anonKey;

  /// The oldest app version this backend will serve.
  ///
  /// This is the forced-upgrade gate (plan.md R-BOTH-7): it is what makes a
  /// bad release retirable without stranding sessions.
  final String minAppVersion;

  /// Which portal apps this tenant has switched on.
  final List<String> portalsEnabled;

  /// Whether [version] satisfies [minAppVersion], comparing dotted integers.
  ///
  /// Unparseable input is treated as **supported**, deliberately: locking a
  /// user out because a version string was malformed is a worse failure than
  /// serving a slightly old client.
  bool supportsAppVersion(String version) {
    final List<int> want = _parse(minAppVersion);
    final List<int> have = _parse(version);
    if (want.isEmpty || have.isEmpty) return true;
    for (int i = 0; i < want.length; i++) {
      final int h = i < have.length ? have[i] : 0;
      if (h != want[i]) return h > want[i];
    }
    return true;
  }

  static List<int> _parse(String v) {
    final List<int> parts = <int>[];
    for (final String piece in v.split('.')) {
      final int? n = int.tryParse(piece.trim());
      if (n == null) return const <int>[];
      parts.add(n);
    }
    return parts;
  }

  Map<String, Object?> toJson() => <String, Object?>{
    'slug': slug,
    'supabaseUrl': supabaseUrl,
    'anonKey': anonKey,
    'minAppVersion': minAppVersion,
    'portalsEnabled': portalsEnabled,
  };

  static NpcTenant fromJson(Map<String, Object?> json) =>
      NpcTenant.fromDiscovery(json['slug']! as String, json);
}
