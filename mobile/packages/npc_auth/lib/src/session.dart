import 'package:meta/meta.dart';

/// A signed-in session held on the device.
///
/// Two credentials, and the distinction matters (ARCHITECTURE.md A1/A2):
///
///  * [accessToken] is the Bearer JWT the backend already accepts —
///    `verifyAuth` verifies it and maps `sub` onto `custom_users`.
///  * [refreshToken] is opaque, rotates on every use, and is the only thing
///    that can mint a new access token. It is the more dangerous of the two
///    and never leaves secure storage.
///
/// Today's server issues a 24-hour access token with no refresh and no binding
/// to the session row, which cannot be revoked. [sessionId] is the `sid` claim
/// that closes that gap once `mobile-auth-login` ships; until then it is null
/// and [isRevocable] is false — which the app treats as a development-only
/// state, because an unrevocable 24-hour credential on a lost phone is not
/// acceptable for staff data.
@immutable
class NpcSession {
  const NpcSession({
    required this.accessToken,
    required this.accessTokenExpiresAt,
    required this.userId,
    required this.username,
    required this.roles,
    this.refreshToken,
    this.sessionId,
  });

  final String accessToken;
  final DateTime accessTokenExpiresAt;
  final String userId;
  final String username;
  final List<String> roles;
  final String? refreshToken;

  /// The `sid` claim binding this token to a revocable `user_sessions` row.
  final String? sessionId;

  /// Whether revoking the server-side session actually invalidates this token.
  bool get isRevocable => sessionId != null;

  /// Whether the access token should be refreshed before the next call.
  ///
  /// Refreshes a minute early so a request cannot be issued against a token
  /// that expires while it is in flight.
  bool needsRefresh({DateTime? now}) {
    final DateTime at = now ?? DateTime.now().toUtc();
    return at.isAfter(
      accessTokenExpiresAt.subtract(const Duration(minutes: 1)),
    );
  }

  NpcSession copyWith({
    String? accessToken,
    DateTime? accessTokenExpiresAt,
    String? refreshToken,
    String? sessionId,
  }) => NpcSession(
    accessToken: accessToken ?? this.accessToken,
    accessTokenExpiresAt: accessTokenExpiresAt ?? this.accessTokenExpiresAt,
    userId: userId,
    username: username,
    roles: roles,
    refreshToken: refreshToken ?? this.refreshToken,
    sessionId: sessionId ?? this.sessionId,
  );

  Map<String, Object?> toJson() => <String, Object?>{
    'accessToken': accessToken,
    'accessTokenExpiresAt': accessTokenExpiresAt.toIso8601String(),
    'userId': userId,
    'username': username,
    'roles': roles,
    'refreshToken': refreshToken,
    'sessionId': sessionId,
  };

  static NpcSession fromJson(Map<String, Object?> json) => NpcSession(
    accessToken: json['accessToken']! as String,
    accessTokenExpiresAt: DateTime.parse(
      json['accessTokenExpiresAt']! as String,
    ),
    userId: json['userId']! as String,
    username: json['username']! as String,
    roles: List<String>.from(
      (json['roles'] as List<Object?>? ?? const <Object?>[])
          .whereType<String>(),
    ),
    refreshToken: json['refreshToken'] as String?,
    sessionId: json['sessionId'] as String?,
  );
}
