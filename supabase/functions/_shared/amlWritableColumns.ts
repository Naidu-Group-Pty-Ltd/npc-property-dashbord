/**
 * WP-20: which columns a request body may write, per AML table.
 *
 * ## Why these tables and not others
 *
 * Several AML operations took a request sub-object and wrote it straight to a
 * table — `const a = body.alert ?? {}` then `aml.from('alerts').update(a)`. Every
 * column the caller chose to name got written, including ones no UI exposes.
 *
 * These are behind `requireWrite()` / MLRO gates, so this is not an anonymous
 * hole; it is an authorised AML user reaching columns the workflow never meant
 * them to set. In this domain that matters more than usual: `resolved_by` and
 * `resolved_at` are the record of who closed an alert and when, and an AML file
 * that says the wrong thing about that is a compliance problem rather than a
 * data-quality one. `AGENTS.md` §2 treats the AML trail as evidence.
 *
 * ## Where these lists come from
 *
 * Read from `information_schema.columns` on the live project, minus the
 * identity and audit columns no request may ever set:
 *
 *     id, created_at, created_by, updated_at, updated_by, deleted_at,
 *     deleted_by, tenant_id, org_id, organisation_id, row_version
 *
 * then narrowed further per table where a column belongs to a *different*
 * operation — see the notes below. Adding a column to a table does not add it
 * here, which is the point: a new column is not writable from a request body
 * until somebody decides it should be.
 *
 * Used with `pickAllowed` from `_shared/wp09Guards.ts`.
 */

/**
 * `aml.alerts` via `upsert_alert`.
 *
 * `resolved_at`, `resolved_by` and `resolution_note` are deliberately absent.
 * They are the closure record and are written by `resolve_alert`, which stamps
 * `resolved_by` from the verified session rather than from the body. Leaving
 * them writable here let one operator record another as having closed an alert.
 */
export const ALERT_WRITABLE = new Set([
  'case_id', 'rule_id', 'event_id', 'severity', 'status', 'title', 'summary',
  'assigned_to', 'metadata',
]);

/** `aml.monitoring_rules` via `upsert_rule`. */
export const MONITORING_RULE_WRITABLE = new Set([
  'name', 'description', 'trigger_kind', 'criteria', 'severity', 'is_enabled',
  'cooldown_minutes',
]);

/** `aml.risk_factors` via `upsert_factor` (MLRO only). */
export const RISK_FACTOR_WRITABLE = new Set([
  'key', 'label', 'category', 'weight', 'active', 'description', 'scoring',
]);

/** `aml.mandatory_triggers` via `upsert_trigger` (MLRO only). */
export const MANDATORY_TRIGGER_WRITABLE = new Set([
  'key', 'label', 'description', 'severity', 'rule', 'active',
]);

/** `aml.transaction_parties` via `upsert_party`. */
export const TRANSACTION_PARTY_WRITABLE = new Set([
  'transaction_id', 'case_id', 'party_type', 'capacity', 'display_name',
  'entity_id', 'external_reference', 'contact', 'metadata',
]);
