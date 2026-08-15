import 'package:flutter_test/flutter_test.dart';
import 'package:npc_portal/npc_portal.dart';

void main() {
  const NpcSyncStamp a = NpcSyncStamp(
    count: 3,
    latest: '2026-08-15T00:00:00Z',
    openRequests: 1,
    attention: 0,
  );

  test('the key is readable, so support can see which scalar moved', () {
    expect(a.key, '3:2026-08-15T00:00:00Z:1:0');
    const NpcSyncStamp empty = NpcSyncStamp(
      count: 0,
      latest: null,
      openRequests: 0,
      attention: 0,
    );
    expect(empty.key, '0:-:0:0');
  });

  test('a null previous stamp is not a change', () {
    // Without this, every mount refetches what it just fetched — the bug this
    // mechanism exists to fix rather than cause.
    expect(NpcSyncStamp.differ(null, a), isFalse);
    expect(NpcSyncStamp.differ(a, null), isFalse);
    expect(NpcSyncStamp.differ(null, null), isFalse);
  });

  test('an identical stamp is not a change', () {
    expect(NpcSyncStamp.differ(a, a), isFalse);
  });

  test('any one scalar moving is a change', () {
    expect(
      NpcSyncStamp.differ(
        a,
        const NpcSyncStamp(
          count: 4,
          latest: '2026-08-15T00:00:00Z',
          openRequests: 1,
          attention: 0,
        ),
      ),
      isTrue,
    );
    expect(
      NpcSyncStamp.differ(
        a,
        const NpcSyncStamp(
          count: 3,
          latest: '2026-08-16T00:00:00Z',
          openRequests: 1,
          attention: 0,
        ),
      ),
      isTrue,
    );
    expect(
      NpcSyncStamp.differ(
        a,
        const NpcSyncStamp(
          count: 3,
          latest: '2026-08-15T00:00:00Z',
          openRequests: 2,
          attention: 0,
        ),
      ),
      isTrue,
    );
    expect(
      NpcSyncStamp.differ(
        a,
        const NpcSyncStamp(
          count: 3,
          latest: '2026-08-15T00:00:00Z',
          openRequests: 1,
          attention: 1,
        ),
      ),
      isTrue,
    );
  });

  test('parses the server payload and matches the web interval', () {
    final NpcSyncStamp parsed = NpcSyncStamp.fromJson(<String, Object?>{
      'count': 3,
      'latest': '2026-08-15T00:00:00Z',
      'openRequests': 1,
      'attention': 0,
    });
    expect(parsed, a);
    expect(NpcSyncStamp.interval, const Duration(seconds: 20));
  });

  test('a missing field parses as zero rather than throwing', () {
    final NpcSyncStamp parsed = NpcSyncStamp.fromJson(
      const <String, Object?>{},
    );
    expect(parsed.key, '0:-:0:0');
  });
}
