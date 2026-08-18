import 'package:meta/meta.dart';

/// Four scalars that say whether anything a viewer can see has moved.
///
/// Ported from `supabase/functions/_shared/agreements/syncStamp.pure.ts`, and
/// deliberately field-for-field: the web and mobile clients must agree on what
/// "changed" means, or one of them polls forever and the other never refreshes.
///
/// Realtime is not an alternative here. Both Supabase projects sign ES256, so a
/// native client holds no token PostgREST will accept — a subscription would
/// simply never fire (see `mobile/ARCHITECTURE.md` A4). Polling a cheap stamp
/// and refetching only on movement is the pattern that already works in
/// production for the Agreement Centre.
@immutable
class NpcSyncStamp {
  const NpcSyncStamp({
    required this.count,
    required this.latest,
    required this.openRequests,
    required this.attention,
  });

  factory NpcSyncStamp.fromJson(Map<String, Object?> json) => NpcSyncStamp(
    count: (json['count'] as num?)?.toInt() ?? 0,
    latest: json['latest'] as String?,
    openRequests: (json['openRequests'] as num?)?.toInt() ?? 0,
    attention: (json['attention'] as num?)?.toInt() ?? 0,
  );

  /// Rows visible to this viewer — catches arrival and disappearance.
  final int count;

  /// `max(updated_at)` across them — catches any field or status change.
  final String? latest;

  /// Open change requests — catches one raised or answered.
  final int openRequests;

  /// How many need this viewer to act. Drives the badge.
  final int attention;

  /// A readable key rather than a hash, deliberately: when something refetches
  /// too often, support can see *which* scalar moved.
  String get key => '$count:${latest ?? '-'}:$openRequests:$attention';

  /// Whether the stamp moved between [previous] and [next].
  ///
  /// **A null previous is not a change.** Without that rule every mount
  /// refetches what it has just fetched, which is the bug this whole mechanism
  /// was built to fix rather than cause.
  static bool differ(NpcSyncStamp? previous, NpcSyncStamp? next) {
    if (previous == null || next == null) return false;
    return previous.key != next.key;
  }

  /// How often a foreground surface asks. Matches `AGREEMENT_SYNC_INTERVAL_MS`.
  static const Duration interval = Duration(seconds: 20);

  @override
  bool operator ==(Object other) => other is NpcSyncStamp && other.key == key;

  @override
  int get hashCode => key.hashCode;

  @override
  String toString() => 'NpcSyncStamp($key)';
}
