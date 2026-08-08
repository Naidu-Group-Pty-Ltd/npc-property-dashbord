# Agreement Centre — what has to ship, and how it fails when it doesn't

Read this before assuming an Agreement Centre feature is broken. Twice now the
answer has been that it was never deployed.

## The Agreement Centre ships on three separate paths

| Half | Ships via | Ships on merge? |
|---|---|---|
| Browser bundle (`src/`) | the site build | **yes**, automatically |
| Edge Functions (`supabase/functions/`) | [`deploy-supabase-functions.yml`](../../.github/workflows/deploy-supabase-functions.yml) | **only if `SUPABASE_ACCESS_TOKEN` is set** |
| Migrations (`supabase/migrations/`) | applied out-of-band | **no** |

Only the first is automatic. That asymmetry is the whole problem: a merged PR
puts a new interface in front of old server code and an old schema, and the
result is a feature that is visibly present and uniformly broken.

## The failure this caused

PR #2007 added **Void**, **Archive** and **Delete permanently**. It merged, CI
was green, the deploy workflow ran and reported success — and all three buttons
answered `unknown_action` in production.

The deploy workflow had done exactly what it says on the tin:

```
Work out which functions changed        ✓ success
Check for a deploy credential           ✓ success
Report and stop when no credential …    ✓ success   ← the whole job
Run supabase/setup-cli@v1                 skipped
Deploy                                    skipped
```

No `SUPABASE_ACCESS_TOKEN` secret, so it annotated a `::warning::` and stopped.
Green. The functions in production were the pre-#2007 build, which has no
`void_agreement`, `archive`, `restore` or `delete_agreement` case, so all three
fell through to the `unknown_action` fallback at the bottom of the router.

The migration had not been applied either, so even a correct function deploy
would then have failed on `column partner_agreements.archived_at does not
exist` — the second failure hiding behind the first.

**Verify production directly rather than reasoning from `main`.** The two
checks that settle it in seconds:

```sql
-- Is the schema current?
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'partner_agreements'
  AND column_name IN ('archived_at', 'voided_at');
```

…and read the deployed function source (Supabase MCP `get_edge_function`, or
the dashboard) and grep it for the action you are calling. Note that
`supabase_migrations.schema_migrations` is **not** a reliable ledger here — the
Agreement Centre's own tables exist in production under no recorded version, so
an absent row proves nothing on its own. Query the schema, not the ledger.

## The one-time fix

Set **`SUPABASE_ACCESS_TOKEN`** in Settings → Secrets → Actions. Every merge
touching `supabase/functions/**` then deploys itself, and the class of bug
above stops existing. Until then, every such merge needs a manual
`supabase functions deploy <name> --project-ref <ref>`, and the workflow's job
summary lists exactly which ones.

Migrations still need applying by hand either way.

## What the app does about it now

It cannot deploy itself, but it can stop lying about what happened.
[`src/lib/agreements/apiErrors.pure.ts`](../../src/lib/agreements/apiErrors.pure.ts)
recognises both signatures of a stale deployment and replaces them with the
diagnosis:

- `unknown_action` → *"This action is not available on the server yet… the
  change was merged but the Edge Functions have not been deployed."*
- a missing column → *"The database is missing the columns this action needs…
  the migration was merged but has not been applied."*

Both say **nothing was changed**, and both name the artefact to ship. A raw
slug in a toast reads like a broken feature and sends whoever receives it
looking in the one place the fault is not.

## Deploy order

Migration first, then the functions.

A function deployed before its migration fails on every call. A migration
applied before its function is inert — the new columns simply sit unused. Only
one of those two orders has a broken window.
