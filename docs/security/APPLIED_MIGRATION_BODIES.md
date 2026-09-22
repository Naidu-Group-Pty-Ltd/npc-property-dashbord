# A migration that has already run must not change here

`npm run check:applied-body-digests` fails when a migration file this
deployment has already applied is edited. It runs on every pull request, needs
no credential and reaches no network.

Read this before touching `scripts/security/appliedBodyIdentity.mjs`,
`scripts/security/applied-body-digests.txt`, its baseline, or the
`--verify` step in `.github/workflows/apply-migration.yml`.

## Why the guard is keyed on the BYTES and not on the version

`supabase_migrations.schema_migrations` records a version and the SQL. In this
project the two do not line up. Measured 22 September 2026:

```
1,002  migration files in supabase/migrations/
1,019  rows in supabase_migrations.schema_migrations
  176  versions the two have in common
```

Lovable stamps the ledger with the moment it **applied** a file, not with the
version in the filename, so the repository's `20250831091525` is the ledger's
`…091523`. Two seconds apart, byte-identical bodies, no version match. And
versions in this corpus are not even unique — `MIGRATION_VERSION_COLLISIONS.json`
still records 25 groups covering 61 files.

Keyed on the version, a guard of this kind could speak about **83** files: the
ledger rows whose version names exactly one repository file and which carry any
SQL at all. Keyed on the bytes it speaks about **690**.

## The rule

> A migration has been applied when this deployment's ledger holds a body whose
> **executable** bytes are exactly its own. Bytes that cannot execute — trailing
> whitespace, a leading comment block — may differ, and nothing else may.

Three rungs, most literal first, so the index of a match IS the rung that
produced it:

| rung | form | reported as |
| --- | --- | --- |
| 0 | the file, byte for byte | byte-identical |
| 1 | `.trimEnd()` | identical but for trailing whitespace |
| 2 | `executableBody` — drop a leading run of blank and `--` lines, then `.trimEnd()` | identical in what executes |

Measured over the 690: **619 at rung 0, 56 at rung 1, 15 at rung 2.**

Internal comments are never stripped. They are inside the statement stream the
ledger also stores, and removing them would make this a parser rather than a
normaliser.

### Over-normalising cannot promote anything

Each rung removes only bytes that do not execute, so two bodies colliding
anywhere on the ladder have identical executable bytes — for all inputs, not
just today's corpus:

- rung 2 ≡ rung 2 — both are `executableBody`, equal by definition.
- rung 0 or 1 ≡ rung 2 — the left side equals some body's executable form, so
  its own first line is neither blank nor a comment, so stripping it again is a
  no-op and `.trimEnd()` is idempotent.
- rung 0 or 1 ≡ rung 0 or 1 — the two differ at most in trailing whitespace.

Measured against that: **9 digests are shared by more than one file and none of
those groups differs in executable bytes.** What a collision costs is
attribution, not safety — the ledger cannot tell those files apart, and neither
can this.

### An empty body is never evidence

Ledger rows that record a version and no SQL hash to the digest of the empty
string, and a repository file that is nothing but comments normalises to the
same thing. Both sides are excluded by name: `EMPTY_BODY_SHA256` is never
admitted, and a rung that normalises to nothing is dropped before it is hashed.
Dropping it cannot shift a surviving rung's index, because an empty rung can
only ever be followed by empty rungs.

## Why editing an applied migration is not a small thing

This database is unaffected — it already ran what it ran. What is lost is
somewhere else entirely.

Aurixa Mission Control decides what a **clone** may be sent by asking whether
the prime's ledger holds the file's bytes. A file whose bytes the ledger no
longer holds is withheld from every clone, and `partitionByDependency` treats a
withheld version as a barrier, so one hole orphans every runnable migration
behind it. Editing one applied migration can therefore stop a hundred from
reaching the fleet, silently, with nothing in this repository reporting it.

Put the file back to what ran, or carry the change in a **new** migration.

## What the manifest is, and why it never shrinks by itself

`scripts/security/applied-body-digests.txt` is generated. Each line says: this
deployment ran a body whose sha256 is *D*, and *file* produced *D*.

`build-applied-body-digests.mjs` **never drops an entry.** That is the whole
point. If it did, an edit could be laundered by regenerating — the file stops
matching, its line disappears, the check passes, and nothing was guarded. A
file that stops matching keeps its line and the check fails. An entry leaves
only by hand.

The generator also refuses to write anything when the ledger returns no bodies:
a read that failed is not a ledger that is empty, and this cannot tell them
apart.

## The half a pull request cannot do

The check is offline because reaching the ledger needs `SUPABASE_DB_URL`, a
credential that reaches the whole database. Putting it into `ci.yml`, which runs
on every pull request, to power a read-only comparison would widen what a CI run
can do far past what the check is worth.

That leaves one way for the manifest to become fiction: a line written by hand
that the ledger cannot back. `apply-migration.yml` already holds the credential,
so it runs `build-applied-body-digests.mjs --verify` after every apply and fails
the run if any recorded digest is one this ledger never held.

## What it does not cover, and says so

- **16 files past 256 KB** are not digested — successive generations of the
  seeded template catalogue. Mission Control applies the same ceiling when it
  reads bodies for the cascade, so a file this skips is one the cascade clears
  by version or not at all. Every one of the 16 is already version-matched.
- **296 files the ledger holds no body for.** Most have never been applied here.
  A file absent from the manifest is not judged, and that is deliberate: judging
  a file against a row that does not exist is not a check, it is a guess.

## Four files this guard does not speak for, and why

The 83 rows that a VERSION key does reach were compared by hand while the guard
was being built. Seventy-nine are byte-identical to what ran. Four are not, and
none of them is in the manifest — so nothing here rests on the verdicts below.
They are recorded so nobody has to find them twice.

| file | finding |
| --- | --- |
| `20260802193235_listings_cache.sql` | documentation added after it applied |
| `20260803162826_listing_enrichment.sql` | documentation added after it applied |
| `20260816091514_format_report_template_dates.sql` | documentation added after it applied |
| `20260807101044_8f6ce9f8-48ba-43e9-9d4d-8f5444771c50.sql` | one line of executable SQL differs — see below |

The first three were judged by removing blank and comment lines from both sides
and comparing what was left, which matched exactly in all three. **That is a
stripper's verdict, not a person's**, and a verdict of "only comments changed"
reached that way is precisely the confident-wrong answer this programme keeps
finding. It is recorded at that strength and nothing is exempted on it.

The fourth was compared line by line and is understood completely. The ledger's
body and the repository file have the same 166 executable lines and differ in
exactly one:

```
ledger:  builder_organisation_id uuid REFERENCES public.builder_organisations(id),
repo:    builder_organisation_id uuid,
```

The reference was removed from the repository on purpose. `20261122000000_builder_network_phase5_inbound_fk_release.sql`
drops that exact constraint by name, and `20261124000000_builder_portal_decommission.sql`
then drops `public.builder_organisations` itself — so a database rebuilt from
this repository must not create it. The neighbouring `solicitor_firm_id` and
`finance_agent_contact_id` references are untouched on both sides, and
`20260805100000_aml_partner_identity_phase1.sql`, which declares the same column
two days earlier, has always carried it without a reference.

So the repository is right, the ledger is history, and the two correctly
disagree. The file still reaches clones, because its version is in the ledger.

## Running it

```sh
npm run check:applied-body-digests    # offline; what CI runs
npm run migrations:body-digests       # rebuild from the live ledger (needs SUPABASE_DB_URL)
```

The generator also accepts `--digests <file>`, one sha256 per line, for when the
ledger has been read by some other route. The manifest header records which
route wrote it.

## The baseline is frozen and empty

`scripts/security/applied-body-digest-baseline.txt` holds files whose drift a
**person** has looked at, statement by statement, and judged harmless. It is
empty, because the guard was armed on a corpus with no such file.

Nothing may be added to it. A migration edited after it applied fails the check,
and adding it there to make the check pass is the failure the guard exists to
prevent. The check also fails on a baseline entry whose file matches again (a
spent exemption re-arms silently on the next edit) and on one naming a file the
manifest does not record (an exemption that exempts nothing).

## The rule lives in two repositories

`appliedBodyIdentity.mjs` is a transcription of Mission Control's
`migrationBodyIdentity.pure.ts`, which is what the cascade itself runs on.
Transcribed rather than imported, because this check must run on every pull
request with no network and no dependency on another repository.

Two copies of one rule is how the two come to disagree, so the properties the
rule turns on are pinned on both sides — here in
`src/lib/deploy/__tests__/appliedBodyDigests.spec.ts`, there in
`migrationBodyIdentity.pure.test.ts`. If a future edit widens or narrows one
copy, the symptom is that Mission Control's reading of the fleet and this
manifest describe different corpora.

One correction already came out of that transcription. `migrationBodyForms`
deduped identical rungs, which made the reported index an index into a shorter
list: a body with a leading comment and no trailing whitespace has rung 1 equal
to rung 0, so rung 1 vanished and a leading-comment match reported itself as a
whitespace match. Measured the day it was found: **0 files affected in this
corpus**, because every leading-comment match here also carries trailing
whitespace. Right by coincidence. Identical rungs are kept now, in both
repositories, and `index === rung` for every input.
