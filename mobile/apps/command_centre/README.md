# NPC Command Centre — Flutter app

The staff application, and the first of the five NPC apps to ship
(`plan.md` in this directory; estate-wide architecture in
[`../../plan.md`](../../plan.md) and [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md)).

**Distributed privately** — Apple Business Manager custom app and Play
managed/private. It is not a public store listing (`R-ARCH-2`, `R-APL-10`).

## Running it

The backend is not compiled in. The app asks for a workspace slug and resolves
`https://<slug>.<flavor domain>/.well-known/npc-mobile.json`, because the
platform provisions one clone per tenant (`ARCHITECTURE.md` A6).

```bash
flutter run --flavor development --dart-define=NPC_FLAVOR=development
flutter run --flavor staging     --dart-define=NPC_FLAVOR=staging
flutter build appbundle --flavor production --dart-define=NPC_FLAVOR=production
flutter build ipa       --flavor production --dart-define=NPC_FLAVOR=production
```

The Gradle flavor and `NPC_FLAVOR` must match. `NpcFlavor.fromEnvironment()`
defaults to `development`, so a bare `flutter run` can never reach production
data.

`flutter build ipa` requires macOS — no cloud environment removes that.

## Verifying

```bash
flutter analyze          # must report zero issues
flutter test
```

Contract gates live in the web app's CI because they are generated from it:
`npm run mobile:tokens:check`, `mobile:api:check`, `mobile:dart:tokens:check`,
`mobile:dart:api:check`, `mobile:scope:check`.

## What is not here yet

Screens beyond the shell. Which surfaces come to mobile is decided by the M1
feature matrix in [`plan.md`](./plan.md) — heavy authoring tooling (Template
Builder, Workflow Playground, PDF diagnostics, admin) stays on the web, and
billing surfaces must never appear in the binary (`R-APL-5`).

Revocable sessions are also outstanding: the app authenticates today against
the existing endpoints, whose token cannot be revoked, so that path is refused
in production until `mobile-auth-login` ships (`ARCHITECTURE.md` A1/A2).
