import 'package:meta/meta.dart';

/// The outcome of an operation that is expected to fail in ordinary use.
///
/// Network calls, sign-in and tenant discovery all have failure modes a user
/// must be shown rather than a crash — most importantly `device_limit_reached`
/// (ARCHITECTURE.md A5), which is a routine outcome on small seat plans and
/// needs a screen, not an error toast.
@immutable
sealed class NpcResult<T> {
  const NpcResult();

  /// The value, or null when this is a failure.
  T? get valueOrNull => switch (this) {
    NpcSuccess<T>(:final T value) => value,
    NpcFailure<T>() => null,
  };

  bool get isSuccess => this is NpcSuccess<T>;
}

/// A successful outcome carrying [value].
@immutable
final class NpcSuccess<T> extends NpcResult<T> {
  const NpcSuccess(this.value);

  final T value;
}

/// A failure carrying a stable [code] and a human-readable [message].
///
/// [code] is what the app branches on; [message] is what a person reads. They
/// are separate because branching on a message is how a copy edit becomes an
/// outage.
@immutable
final class NpcFailure<T> extends NpcResult<T> {
  const NpcFailure(this.code, this.message, {this.details});

  final String code;
  final String message;
  final Map<String, Object?>? details;

  @override
  String toString() => 'NpcFailure($code): $message';
}
