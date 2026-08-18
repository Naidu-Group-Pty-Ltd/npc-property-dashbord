# NPC Solicitor Portal

Its own app (`mobile/plan.md` R-ARCH-1), sharing the shell, auth, design
system and API client in `mobile/packages/` with the other four.

## No `android/` or `ios/` yet — deliberately

The backend refuses a native client for this portal today, so there is nothing
to build a signed binary of. `NpcPortals.solicitor` records why, the shell shows
those reasons on screen instead of failing obscurely, and
`test/blocked_test.dart` asserts it.

Generating platform folders now would commit several hundred files of native
boilerplate for an app that cannot reach its server — and they would be stale
by the time it can. They are created when the server work in `mobile/plan.md`
S-1 lands, exactly as `apps/client` and `apps/finance` have them today.

## What unblocks it

See `mobile/ARCHITECTURE.md` P2/P3 and `mobile/plan.md` S-1.
