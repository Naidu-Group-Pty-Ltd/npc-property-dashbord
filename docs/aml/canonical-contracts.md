# AML Canonical Contracts (Phase 1)

Phase 1 of the tri-portal completion directive: separate workflow-status
dimensions, explicit activation fields, portal-safe response contracts, field
provenance and the legacy-activation migration plan. Source of truth for value
lists: `src/lib/aml/caseDimensions.ts` (TypeScript) mirrored by
`supabase/migrations/20260725153000_aml_case_workflow_dimensions.sql` (SQL).

## 1. Workflow-status dimensions (directive §16)

One legacy `aml.cases.status` enum previously carried KYC progress, review
state, escalation and outcomes. The case now has four explicit dimensions
(new nullable columns on `aml.cases`):

| Dimension | Column | Values |
|---|---|---|
| Internal case stage | `case_stage` | draft · activated · awaiting_client · client_in_progress · client_submitted · staff_review · checks_in_progress · additional_info_required · decision_pending · cleared · cleared_with_conditions · enhanced_cdd · blocked · closed |
| Client Portal status | `client_portal_status` | not_started · action_required · in_progress · submitted · under_review · additional_info_required · complete · contact_adviser |
| Finance Portal status | `finance_portal_status` | not_requested · information_required · submitted · clarification_required · under_review · accepted · no_further_action |
| Service gate | `service_gate_status` (+ `service_gate_effective_at`, `service_gate_policy_version`) | not_activated · cdd_incomplete · information_outstanding · under_review · conditions_outstanding · approved_with_controls · approved · locked · terminated |

Risk stays on the existing `risk_rating` / `risk_score` columns — it is a
dimension of its own and is never derived from, or written into, the others.

**Compatibility rule (until the cutover phase):** the legacy `status` column
remains authoritative for V2 surfaces. The `aml-cases` edge function keeps the
dimension columns coherent on `create` / `activate_client` / `transition` using
the deterministic maps, and retries without the new columns when a target
environment has not applied the migration (contract-first deploy tolerance).
The service gate is synced conservatively from legacy transitions only as a
stop-gap — explicit gate decisions arrive in Phase 8 and the gate must never be
inferred solely from stage or risk.

## 2. Explicit activation contract (directive §17)

New columns on `aml.cases`, written at activation time and backfilled from
`metadata->'activation'` for pre-existing rows:

| Column | Meaning |
|---|---|
| `activation_timing` | `pre_agreement` · `conditional_agreement` · `post_agreement_trigger` · `legacy_unclassified` |
| `agreement_state` | `not_executed` · `conditional_executed` · `operative` · `terminated` |
| `activation_policy_version` | Program version recorded at activation (Model B's `program_version`) |
| `legacy_activation_model` | Preserved historic `A` / `B` label — never rewritten |
| `migration_classification` | `auto_classified` · `human_reviewed` · `ambiguous_pending_review` |
| `migration_reviewed_by` / `migration_reviewed_at` | Human sign-off for ambiguous records |

Model label → explicit meaning (labels preserved, not reversed):

- **Model A** ("designated service triggered") → `activation_timing = post_agreement_trigger`, `agreement_state = operative`.
- **Model B** ("pre-service") → `activation_timing = conditional_agreement`, `agreement_state = conditional_executed`; requires tenant legal approval + program version (unchanged server guardrail).

Both models start the gate at `service_gate_status = cdd_incomplete`.

### Legacy-activation migration plan

1. The migration backfills every case where `case_stage IS NULL` using the
   deterministic status maps and `metadata->'activation'->>'model'`.
2. Cases with a recorded model are `auto_classified`; cases without one get
   `activation_timing = legacy_unclassified` + `migration_classification =
   ambiguous_pending_review` and require human review
   (`migration_reviewed_by/at`).
3. Every backfilled row is recorded in `aml.workflow_dimension_migrations`
   (previous status + metadata preserved) — a side table rather than
   `aml.case_events`, so SQL never writes into the SHA-256 hash chain.
4. Production `aml.cases` was empty when this migration was authored
   (verified 2026-07-25), so the backfill is a no-op there; it exists for
   staging/local data and reproducibility.

## 3. Portal-safe response contracts

### Client Portal (`aml-client-portal` `overview`; Appendix C.1)

- The `case.status` field on the wire is now the **portal-safe dimension
  token** (also exposed as `portal_status`), never the internal enum. Labels
  and tones derive from the token.
- `recent_submissions` no longer includes `reviewer_notes` (staff-authored
  free text); client-facing explanations travel through `client_requests`.
- Existing behaviour preserved: consent gating, sections, requirements,
  progress, open requests, signed uploads.

### Finance Portal (`aml-finance` `limited_status`; Appendix C.2)

Response is now exactly:

```json
{
  "finance_status": "not_requested | information_required | submitted | clarification_required | under_review | accepted | no_further_action",
  "service_readiness": "service_ready | service_not_ready",
  "open_finance_discrepancies": 0,
  "updated_at": null
}
```

Raw `status` and `risk_rating` are **removed from the server response** (not
merely hidden in UI). `service_readiness` is `service_ready` only for an
explicit `approved` / `approved_with_controls` gate (legacy fallback: only a
`cleared` case). The blocked `create_case_handoff` / `redeem_case_handoff`
ops are unchanged (they remain 403; replacement channel is Phase 7).

## 4. Field provenance (`aml.field_provenance`; Appendix C.3)

Append-first record of where each material value came from: `field_key`,
`value`, `source_type` (client_portal · finance_portal · document · provider ·
purchase_file · staff), source record/party/entity, submitter, confidence,
`verification_status`, `conflict_status` (none · conflict · superseded ·
resolved), canonical acceptance (`is_canonical`, `canonical_value`,
`accepted_by/at`, `resolution_reason`). RLS default-deny; service-role access
via SECURITY DEFINER edge functions only. Reconciliation workflows populate it
from Phase 5/7 onwards; Phase 1 ships the model.

## 5. Duplicate-open-case enforcement

Partial unique index `aml_cases_one_open_per_client` on
`aml.cases(client_id) WHERE client_id IS NOT NULL AND status NOT IN
('cleared','blocked','closed')` closes the read-then-write race in
`activate_client`; the edge function maps unique violations (23505) to the
existing 409 contract.

## 6. Migration & rollback

- Apply: standard migration deploy (file
  `20260725153000_aml_case_workflow_dimensions.sql`). Additive only; no
  changes to existing columns, enums, or the hash chain. Note the
  **32 earlier unapplied migrations** recorded in the Phase 0R assessment
  (issue I-01) must be applied first or together.
- Deploy order tolerance: edge functions may deploy before or after the
  migration — inserts/updates retry without the new columns when absent, and
  reads use `select('*')` with legacy fallbacks.
- Rollback: the exact statements are in the migration header comment (drop the
  two new tables, the partial index and the added columns). Safe while the V3
  workspace flags remain off; no legacy data is modified beyond backfilling
  previously-NULL columns.

## 7. Verification (Phase 1 gate)

- Unit: `src/lib/aml/caseDimensions.test.ts` (mapping totality, gate
  conservatism, no internal-state leakage, finance-safe vocabulary).
- Contract greps: `risk_rating` absent from `limited_status` response
  construction; `reviewer_notes` absent from the portal payload.
- Regression commands per the directive §0.10 — results recorded in the phase
  gate evidence (PR).
