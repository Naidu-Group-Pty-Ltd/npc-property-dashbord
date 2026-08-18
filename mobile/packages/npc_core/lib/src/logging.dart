import 'dart:developer' as developer;

/// Severity of a log record.
enum NpcLogLevel { debug, info, warning, error }

/// Minimal structured logger.
///
/// It exists so nothing in the estate reaches for `print` (the lint forbids
/// it), and so one rule can be enforced in one place: **credentials are never
/// logged.** The web backend learned this the hard way — `_shared/auth.ts`
/// carries "never log a preview of the token" — and a mobile client holds the
/// refresh token, which is the more dangerous half.
class NpcLog {
  const NpcLog(this.name);

  final String name;

  void debug(String message, {Map<String, Object?>? data}) =>
      _emit(NpcLogLevel.debug, message, data);

  void info(String message, {Map<String, Object?>? data}) =>
      _emit(NpcLogLevel.info, message, data);

  void warn(String message, {Map<String, Object?>? data}) =>
      _emit(NpcLogLevel.warning, message, data);

  void error(String message, {Object? error, StackTrace? stackTrace}) =>
      developer.log(message, name: name, error: error, stackTrace: stackTrace);

  void _emit(NpcLogLevel level, String message, Map<String, Object?>? data) {
    final String suffix = data == null || data.isEmpty
        ? ''
        : ' ${redact(data)}';
    developer.log('[${level.name}] $message$suffix', name: name);
  }

  /// Replaces the value of any key that looks like a credential.
  ///
  /// Deliberately matches on the key rather than the value: a token is not
  /// recognisable by shape, and a redactor that only catches what it can
  /// pattern-match gives false confidence.
  static Map<String, Object?> redact(Map<String, Object?> data) {
    const List<String> secretish = <String>[
      'token',
      'password',
      'secret',
      'authorization',
      'cookie',
      'key',
      'jwt',
    ];
    return data.map((String k, Object? v) {
      final String lower = k.toLowerCase();
      final bool hide = secretish.any(lower.contains);
      return MapEntry<String, Object?>(k, hide ? '[redacted]' : v);
    });
  }
}
