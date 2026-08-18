import 'dart:math';

import 'session_store.dart';

/// The stable identifier for this installation's device seat.
///
/// The web derives a fingerprint from `navigator.userAgent`, screen size and
/// timezone plus a random UUID (`src/lib/deviceFingerprint.ts`). Mobile does
/// **not** reproduce that: a UUID minted at first launch and held in
/// Keychain/Keystore is more stable, is private, and stays clear of Apple's
/// rules on deriving an identity from device characteristics.
///
/// It must outlive sign-out — releasing a seat and signing back in should
/// reclaim the same slot rather than consume a second one from a cap that may
/// be as small as two (ARCHITECTURE.md A5).
class NpcInstallId {
  const NpcInstallId(this._store);

  static const String storageKey = 'npc.install.id';

  final NpcSecureStore _store;

  Future<String> read() async {
    final String? existing = await _store.read(storageKey);
    if (existing != null && existing.isNotEmpty) return existing;
    final String minted = generate();
    await _store.write(storageKey, minted);
    return minted;
  }

  /// A v4 UUID from the platform's secure random source.
  static String generate() {
    final Random random = Random.secure();
    final List<int> bytes = List<int>.generate(
      16,
      (_) => random.nextInt(256),
      growable: false,
    );
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    String hex(int start, int end) => bytes
        .sublist(start, end)
        .map((int b) => b.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex(0, 4)}-${hex(4, 6)}-${hex(6, 8)}-${hex(8, 10)}-${hex(10, 16)}';
  }
}
