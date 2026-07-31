# Builder / Developer Portal programme

**Baseline:** `a2ec188faa806ff97cb272f7f5a8bcf56b984cb1`
**Current phase:** 0 — complete. Phase 1 has not started.

The Builder / Developer Portal is the fourth external portal alongside Client,
Finance and Solicitor. The Solicitor Portal is the architectural reference and is
already implemented and merged; this programme reproduces its structure,
generalises the shared services it left legal-coupled, and deliberately does not
reproduce its known defects.

## Phase 0 scope

Phase 0 is assessment, documentation, characterisation tests and read-only
scripts. It creates no table, no route, no component and no Edge Function. Its
only production-adjacent change is two additive `package.json` script entries.

## Document index

| # | Document | Contents |
| --- | --- | --- |
| 00 | [Baseline record](./00-baseline.md) | Baseline commit, repository shape, non-behavioural invariants |
| 01 | [Solicitor Portal assessment](./01-solicitor-portal-assessment.md) | Route separation, session architecture, authorization, admin pattern, and the seven defects not to copy |
| 02 | [Administration versus portal boundary](./02-admin-vs-portal-boundary.md) | Internal `/admin/builder-portal` versus external `/builder/*` |
| 03 | [Shared-service inventory](./03-shared-service-inventory.md) | REUSE / GENERALISE / LEGAL-ONLY classification, GEN-01 … GEN-13 |
| 04 | [Builder domain boundaries](./04-builder-domain-boundaries.md) | Builder-owned aggregates, private data, governed outbound contracts |
| 05 | [Organisation and access hierarchy](./05-organisation-and-access-hierarchy.md) | Six-level hierarchy, distinct builder and developer entities, grant model |
| 06 | [Roles and permissions](./06-roles-and-permissions.md) | Eleven proposed roles, permission keys, forbidden keys, resolution semantics |
| 07 | [Lifecycle and milestones](./07-lifecycle-and-milestones.md) | Transaction state machine, construction milestones, 409 contract |
| 08 | [Transaction-case relationships](./08-transaction-case-relationships.md) | The fourth link slot, guard trigger, unsold-inventory rule |
| 09 | [Migration risks](./09-migration-risks.md) | MIG-01 … MIG-10 with mitigations |
| 10 | [Security risks](./10-security-risks.md) | SEC-01 … SEC-14 with controls |
| 11 | [Phase 0 report](./11-phase-0-report.md) | Findings, decisions, evidence, test results, Phase 1 recommendation |

## Architecture documents

| Document | Contents |
| --- | --- |
| [`builder-cross-portal-current-state.md`](../architecture/builder-cross-portal-current-state.md) | What exists at the baseline; gap register BLD-01 … BLD-10 |
| [`builder-cross-portal-target-state.md`](../architecture/builder-cross-portal-target-state.md) | Proposed topology, backbone, ownership, audience contracts |
| [`builder-cross-portal-field-ownership.md`](../architecture/builder-cross-portal-field-ownership.md) | Five-domain field-ownership matrix |

## Architecture Decision Records

| ADR | Decision |
| --- | --- |
| [018](../architecture/adr/018-builder-portal-separation.md) | The Builder Portal is a separate external portal with its own login |
| [019](../architecture/adr/019-builder-domain-model.md) | Builder domain records are separate from `transaction_cases` |
| [020](../architecture/adr/020-shared-portal-primitive-generalisation.md) | Legal-coupled shared primitives are generalised, not duplicated |

## Verification

```bash
npm run test:builder-portal        # 80 characterisation tests, no dependencies
npm run builder:phase-0-inspect    # non-behavioural check + findings re-derivation
```

Against a database, with a read-only role:

```bash
psql "$READONLY_DATABASE_URL" -f scripts/builder-portal/phase-0-reconciliation.sql
```

## Reading order for Phase 1

1. ADR 018, 019, 020 — the three decisions Phase 1 implements against.
2. `03-shared-service-inventory.md` — what may be reused and what must be widened.
3. `09-migration-risks.md` — MIG-01, MIG-02 and MIG-03 gate the first migrations.
4. `10-security-risks.md` — SEC-01, SEC-02 and SEC-07 gate the first code.

## Rules for later phases

- One phase per branch, one phase per pull request.
- Timestamped migrations, non-destructive expansion only.
- Backfill before cutover; reconcile before legacy removal.
- Feature flags for every cutover — which requires MIG-03 (GEN-10) resolved first.
- No existing table, column or behaviour is removed during expansion.
- Any Builder-specific version of a shared service requires its own ADR.
- A shared-constraint widening ships in the same migration as every consumer that
  switches on that column.
