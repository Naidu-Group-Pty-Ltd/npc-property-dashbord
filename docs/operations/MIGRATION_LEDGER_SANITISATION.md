# Migration ledger sanitisation — prime and clones (23 Sep 2026)

This records the state measured on 23 Sep 2026, what was changed, and the
order in which it has to land. Nothing here has been dispatched, deployed or
merged. Every item marked PENDING below is unperformed.

## What was measured

- **Prime ledger:** 1,036 rows. 906 carry a body and 130 do not. Every row
  "Apply a migration" ever wrote is among the 130: it recorded
  `(version, name)` only. `applied-body-digests.txt` verifies 690 of 690
  against that read.
- **Shared versions:** 25 versions are shared by 61 files
  (`MIGRATION_VERSION_COLLISIONS.json`). A version records one row, so the
  second file of a pair reads as applied whether or not it ran.
- **Ledger edits:** `20260921100000` deleted ledger rows. On the clones, the
  same DELETE met four different ledgers, so the Quick Send columns ended up
  present on two clones and absent on two.
  - The next day the prime re-applied `20260719000000` (run 35712338709).
  - Mission Control therefore sends that file to the clones regardless.
- **Seeds and the barrier:** Mission Control reads no body over 256 KiB. Every
  template seed was therefore an opaque barrier on every clone that lacked it.
  - Measured on the four clones' ledgers, the queue sent 1, 3, 3 and 1
    versions.
  - With the seed skeletons read, it sends 5, 7 and 7 on the three mirrors and
    25 on the CRM.
- **The apply workflow:**
  - It applied whatever a checkout held.
  - Twelve runs came from one feature branch.
  - Its file input defaulted to the v5 seed.
  - Its applied-body re-check was psql-only, so on the prime, which applies
    over the Management API, it never ran.

## What changed

**Prime, on `claude/exciting-thompson-16rvet`:**

- `MIGRATION_WITHDRAWN.json` declares three files whose effect is deliberately
  absent, and drift reports them as WITHDRAWN:
  - `20260724000000_prevent_duplicate_portfolio_publications`
  - `20260728120000_aml_verification_checks`
  - `20260901000700_partner_portal_agreement_cascade`

  `check-migration-ledger-writes.mjs` refuses a migration that writes the
  ledger.
- `20261219000000`–`030000` restate four changes some clones lack or disagree
  about.
- `20261219040000` restates the Quick Send columns and indexes on every
  database. **This reverses part of the owner-directed withdrawal in
  `20260921100000` and needs the owner's decision before it is applied.**
- `20261219050000` re-fires the approvals and projections first loads, only
  where they never landed.
- `supabase/migration-seed-skeletons.json` publishes each oversize seed's
  statements without its rows, pinned to the file's blob.
- "Apply a migration" now:
  - refuses a dispatch from anywhere but the default branch;
  - runs a preflight on both routes (`scripts/ops/applyPreflight.pure.mjs`)
    that refuses withdrawn files, shared versions, edited-after-apply files,
    and, unless `reapply: true`, anything already recorded or already run
    under another version;
  - stores the body of every file of 256 KiB or less and reads it back;
  - re-checks the manifest after the apply, on either route, on the prime only.

  One ledger reader (`scripts/lib/ledgerQuery.mjs`) serves the workflow and
  the drift report.

**Mission Control, on the same branch:**

- A withdrawn file is excluded from the corpus and is no longer a hole.
- A migration that writes a ledger is held, never run.
- A shared version is delivered whole or held.
- A file that names a held version waits for it.
- The seed skeletons are read for dependency facts and names only.
- An edge deploy with a failed bundle no longer stamps the backend revision.

## Order (every step needs the owner's confirmation)

1. Merge the prime pull request. Dispatches after this come from `main`,
   because the workflow now refuses any other ref.
2. On the prime, dispatch `20261210000000`–`040000` (urban centres) with
   `record_version: true`. Check first that the vault holds `supabase_url`,
   because `20261210010000` raises without it.
3. On the prime, dispatch `20261219000000`–`020000`.
   - Before `20261219030000`, run migration-drift and read that file's
     `@effect` probe. `NOT APPLIED` means applying it changes the prime's row
     security: replies to a client's email stop being visible across
     clients. `effect present` means it changes nothing on the prime and only
     carries the policies to the clones. Either way, the prime's ledger has to
     record it before Mission Control sends it to any clone.
   - Dispatch `20261219040000` only once the Quick Send decision is made.
4. Merge and deploy Mission Control. Its reader expects the skeleton manifest
   on the prime's `main`.
5. Let Mission Control redeploy `market-sales-ingest` on the clones. Then
   dispatch `20261219050000` on the prime.

## Decisions the owner has not made

- Quick Send: does `20261219040000` reverse the 21 Sep withdrawal?
- A GitHub Environment restricted to `main` holding the database credentials.
  This is the only binding version of the ref gate.
- Backfilling bodies into the 130 body-less prime rows. It is a ledger write,
  and it is not done.
- Porting `native_crm_tables` to the CRM clone.

## PENDING (unperformed; not a pass)

- No dispatch has run the new workflow. The preflight's ledger reads, the body
  read-back and the API-route re-check are proven by tests, not yet against a
  live database.
- Delivery to each clone after the Mission Control deploy.
- Whether the CRM vault holds `supabase_url`.

Lint was run on 23 Sep over the 23 changed script and spec files: 0 errors and
0 warnings. It used the repository's `eslint.config.js`, with its plugins
installed outside the checkout at the declared ranges, because the sandbox's
`node_modules` lacked them. A planted `debugger` failed under the same
invocation, so the configuration was applied. CI runs lint against the
lockfile.
