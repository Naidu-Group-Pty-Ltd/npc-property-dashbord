import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:npc_auth/npc_auth.dart';

/// Keychain/Keystore-backed [NpcSecureStore].
///
/// The only production implementation, deliberately: the session token and the
/// install id both live here, and neither may fall back to ordinary
/// preferences. It sits in the shared package so all five apps get the same
/// storage guarantees rather than each wiring their own.
class FlutterSecureStoreAdapter implements NpcSecureStore {
  const FlutterSecureStoreAdapter(this._storage);

  factory FlutterSecureStoreAdapter.standard() =>
      const FlutterSecureStoreAdapter(
        FlutterSecureStorage(
          aOptions: AndroidOptions(encryptedSharedPreferences: true),
          iOptions: IOSOptions(
            accessibility: KeychainAccessibility.first_unlock,
          ),
        ),
      );

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}
