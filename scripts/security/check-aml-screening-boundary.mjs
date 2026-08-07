#!/usr/bin/env node
/**
 * AML screening/PEP authorization boundary inventory.
 *
 * Companion to check-aml-edd-mlro-boundary.mjs. Every privileged screening or
 * PEP operation added by the screening repair is inventoried here with the
 * boundary it must keep, so a refactor that loosens one fails CI rather than
 * shipping. Source-text checks, deliberately: these are Deno modules and this
 * script must run in plain Node with no dependencies.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cases = readFileSync("supabase/functions/aml-cases/index.ts", "utf8");
const risk = readFileSync("supabase/functions/aml-risk/index.ts", "utf8");
const verification = readFileSync("supabase/functions/aml-verification/index.ts", "utf8");
const consumer = readFileSync(
  "supabase/functions/cross-portal-outbox-worker/screeningConsumer.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260807120000_aml_screening_repair.sql", "utf8");

const slice = (source, from, to) => {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `expected to find ${JSON.stringify(from)}`);
  const end = to ? source.indexOf(to, start) : source.length;
  assert.ok(end > start, `expected ${JSON.stringify(to)} after ${JSON.stringify(from)}`);
  return source.slice(start, end);
};

/* ── Party adjudication: canonical, human, reviewer/MLRO ─────────────────── */
const adjudicate = slice(cases, "case 'adjudicate_party_screening'", "case 'list_pep_determinations'");
assert.match(adjudicate, /roles\.has\('reviewer'\) \|\| roles\.has\('mlro'\)/,
  "adjudicate_party_screening must require reviewer or MLRO");
assert.match(adjudicate, /canonical_match_required/,
  "adjudication without a canonical match id must be refused");
assert.match(adjudicate, /from\('match_resolutions'\)\.insert/,
  "adjudication must write the hash-chained canonical resolution");
assert.match(adjudicate, /projectPartyScreeningState/,
  "party state must be derived from canonical matches");
assert.doesNotMatch(adjudicate, /state:\s*outcome/,
  "party state must never be set directly from the caller's outcome");

/* ── PEP determination: reviewer/MLRO, derived identity, trigger supersession ── */
const pepOp = slice(cases, "case 'record_pep_determination'", "default:");
assert.match(pepOp, /roles\.has\('reviewer'\) \|\| roles\.has\('mlro'\)/,
  "record_pep_determination must require reviewer or MLRO");
assert.match(pepOp, /subject_identity_mismatch/,
  "a caller-supplied subject name that mismatches the canonical identity must be refused");
assert.match(pepOp, /subject_name: derivedName/,
  "the determination's subject identity must be derived, never asserted");
assert.match(pepOp, /party_type: derivedPartyType/,
  "the determination's party linkage must come from the subject row");
assert.doesNotMatch(pepOp, /\.update\(\{ superseded_at/,
  "supersession must be the migration trigger's job (atomic), not an app-side update");
assert.match(pepOp, /concurrent_determination/,
  "a concurrent duplicate current determination must surface as a conflict");
assert.match(pepOp, /At least one method\/source/,
  "a determination without recorded methods must be refused");

/* ── Senior manager: explicit designation, MLRO-managed, linked approvals ── */
const designate = slice(risk, 'op === "designate_senior_manager"', 'op === "revoke_senior_manager"');
assert.match(designate, /if \(!isMlro\)/, "designating a senior manager must be MLRO-only");
const revoke = slice(risk, 'op === "revoke_senior_manager"', "─── Conditions");
assert.match(revoke, /if \(!isMlro\)/, "revoking a senior manager must be MLRO-only");
const resolveApproval = slice(risk, 'op === "resolve_approval"', 'op === "list_senior_managers"');
assert.match(resolveApproval, /senior_manager_designations/,
  "resolving a PEP service approval must check the designation register");
assert.match(resolveApproval, /senior_manager_designation_required/,
  "an undesignated resolver must be refused, MLRO or not");
assert.match(resolveApproval, /no_current_pep_determination/,
  "approving with no current PEP determination must be refused");
assert.match(resolveApproval, /pep_determination_ids/,
  "the approval must record which determinations it covered");

/* ── PEP evidence linkage in the risk inputs ─────────────────────────────── */
const riskInputs = slice(risk, "async function authoritativeMandatoryInputs", "function blockingHolds");
assert.match(riskInputs, /pepEvidenceSatisfied/,
  "PEP EDD/approval satisfaction must go through the shared linkage rule");
assert.match(riskInputs, /source_of_funds/, "PEP EDD must consult verified source of funds");
assert.match(riskInputs, /source_of_wealth/, "PEP EDD must consult verified source of wealth");
assert.match(riskInputs, /latestPepDeterminedAt/,
  "EDD and approvals must be linked to the current determination's timestamp");
assert.match(riskInputs, /verifiedSofEddCaseIds/,
  "verified SoF must be tied to its EDD case, not counted case-wide");
assert.match(riskInputs, /verifiedSowEddCaseIds/,
  "verified SoW must be tied to its EDD case, not counted case-wide");
assert.match(riskInputs, /select\("edd_case_id"\)/,
  "SoF/SoW reads must carry the EDD linkage column");

/* ── Provider selection stays server-side ────────────────────────────────── */
const runScreening = slice(verification, 'case "run_screening"', 'case "list_screening"');
assert.doesNotMatch(runScreening, /preferred/,
  "run_screening must not pass a caller-controlled provider hint");
assert.match(runScreening, /getScreeningProvider\(\{ resolved, admin \}\)/,
  "the provider must resolve from tenant + capability + provider_configs only");

/* ── Worker consumer: projection-only writer, honest retries ─────────────── */
assert.doesNotMatch(consumer, /from\('(decisions|service_gate_decisions|case_conditions|approvals)'\)/,
  "the screening consumer must never write decisions, conditions, approvals or the gate");
assert.match(consumer, /screeningClaimDecision/,
  "claim eligibility must go through the shared rule");
assert.match(consumer, /screening_in_flight/,
  "an in-flight subject must retry the event, never silently succeed");
assert.match(consumer, /matchDedupKey/,
  "candidate inserts must be keyed for redelivery idempotency");
assert.match(consumer, /state: 'error'/, "technical failure must project to error");
assert.doesNotMatch(consumer, /state:\s*'completed'\s*,\s*\n\s*error_category/,
  "a technical failure must never project to completed");
assert.match(consumer, /checkReuseDecision/,
  "a terminal check must be resumed, never re-executed or duplicated");
assert.ok(
  consumer.indexOf("checkReuseDecision(linked, subject)") <
    consumer.indexOf("resolveTenantProvider(db, tenantId"),
  "recovery must be decided before any provider resolution");

/* ── Migration invariants ────────────────────────────────────────────────── */
assert.match(migration, /trg_aml_pep_det_supersede/,
  "PEP supersession must be a BEFORE INSERT trigger (atomic with the insert)");
assert.match(migration, /idx_aml_pep_det_one_current/,
  "a partial unique index must enforce one current determination per subject scope");
assert.match(migration, /aml_pep_determinations_service_only/,
  "pep_determinations must be service-role only");
assert.match(migration, /aml_senior_manager_designations_service_only/,
  "senior_manager_designations must be service-role only");
assert.match(migration, /ON CONFLICT \(idempotency_key\) DO NOTHING/,
  "the screening outbox emission must be idempotency-keyed");

console.log("AML screening/PEP authorization boundary checks passed");
