import 'dart:convert';

import 'session.dart';

/// Where a session and the install id are persisted.
///
/// The contract is deliberately narrow so the only production implementation
/// can be Keychain/Keystore-backed (`flutter_secure_storage`). Ordinary
/// preferences are not an acceptable home for a refresh token, and an
/// interface this small makes that hard to get wrong by accident.
abstract interface class NpcSecureStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// Reads and writes the signed-in session through a [NpcSecureStore].
class NpcSessionStore {
  const NpcSessionStore(this._store);

  static const String sessionKey = 'npc.session';

  final NpcSecureStore _store;

  Future<NpcSession?> read() async {
    final String? raw = await _store.read(sessionKey);
    if (raw == null || raw.isEmpty) return null;
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! Map<String, Object?>) return null;
      return NpcSession.fromJson(decoded);
    } on FormatException {
      // A corrupt record is discarded rather than crashing the launch path:
      // the worst outcome is one extra sign-in.
      await _store.delete(sessionKey);
      return null;
    }
  }

  Future<void> write(NpcSession session) =>
      _store.write(sessionKey, jsonEncode(session.toJson()));

  Future<void> clear() => _store.delete(sessionKey);
}

/// An in-memory [NpcSecureStore] for tests only.
///
/// Never wire this into an app: it is not persistent and not secure. It exists
/// so session logic can be tested without a platform channel.
class InMemorySecureStore implements NpcSecureStore {
  final Map<String, String> _values = <String, String>{};

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async => _values[key] = value;

  @override
  Future<void> delete(String key) async => _values.remove(key);
}
