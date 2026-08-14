import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:npc_auth/npc_auth.dart';

/// Keychain/Keystore-backed implementation of [NpcSecureStore].
///
/// This is the only production implementation, deliberately. The refresh token
/// and the install id both live here and neither may fall back to ordinary
/// preferences — a refresh token in plain storage is the credential an
/// attacker with filesystem access would most want.
class FlutterSecureStoreAdapter implements NpcSecureStore {
  const FlutterSecureStoreAdapter(this._storage);

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}
