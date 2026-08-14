/// Build flavors.
///
/// A flavor selects **which tenant-discovery environment is consulted**, not a
/// hardcoded backend (ARCHITECTURE.md A6, plan.md R-ARCH-6). Compiling a
/// Supabase URL into the binary would bind the app to one tenant, and the
/// platform provisions one clone per tenant.
enum NpcFlavor {
  development('development', 'dev.aurixasystems.com.au'),
  staging('staging', 'staging.aurixasystems.com.au'),
  production('production', 'aurixasystems.com.au');

  const NpcFlavor(this.name, this.discoveryDomain);

  /// The flavor name, matching the Gradle/Xcode flavor of the same name.
  final String name;

  /// The domain a workspace slug is resolved against for this environment.
  final String discoveryDomain;

  /// Resolved from `--dart-define=NPC_FLAVOR=…`, defaulting to development so
  /// a plain `flutter run` can never point at production data by accident.
  static NpcFlavor fromEnvironment() {
    const String raw = String.fromEnvironment(
      'NPC_FLAVOR',
      defaultValue: 'development',
    );
    for (final NpcFlavor flavor in NpcFlavor.values) {
      if (flavor.name == raw) return flavor;
    }
    throw ArgumentError.value(raw, 'NPC_FLAVOR', 'Unknown flavor');
  }

  bool get isProduction => this == NpcFlavor.production;
}
