/**
 * Passport state — the ONE derivation of the Compliance Passport's lifecycle
 * position, shared by every portal.
 *
 * There is deliberately NO stored passport status. The state is a pure
 * function of records that already exist and are already authoritative:
 * the attestation register (`aml.compliance_attestations`), the service gate
 * (`aml.cases.service_gate_status`), the case lifecycle (`aml.cases.status`)
 * and any open refresh obligations. A stored copy would be the exact drift
 * bug this programme exists to prevent — "Journey says Verified, Passport
 * says Pending" cannot happen when the Passport has nothing of its own to
 * disagree with.
 *
 * The browser must not recompute its own variant of this mapping: edge
 * functions embed the result in every projection, and the UI renders it.
 * (A read-only mirror re-export exists at `src/lib/aml/passport/` for types
 * and presentation helpers only.)
 *
 * Vocabulary (human lifecycle, distinct from `aml.case_status`):
 *   NOT_ISSUED → READY_FOR_ISSUANCE → ISSUED_CURRENT
 *     → SUPERSEDED (between versions) / REFRESH_REQUIRED (caution)
 *     → SUSPENDED / REVOKED (restriction, from the service gate)
 *     → COMPLETED_RETAINED (case closed; record retained, never deleted)
 */

export type PassportStateCode =
  | "not_issued"
  | "ready_for_issuance"
  | "issued_current"
  | "superseded"
  | "refresh_required"
  | "suspended"
  | "revoked"
  | "completed_retained";

/** Tones align with the existing AML badge families (never colour-only). */
export type PassportStateTone =
  | "success"
  | "progress"
  | "attention"
  | "muted"
  | "destructive";

export type PassportAttestationFact = {
  version: number;
  issued_at: string | null;
  superseded_at: string | null;
  payload_sha256: string;
  schema_version: number | null;
};

export type PassportStateInput = {
  /** Every attestation version for the case, any order. Empty = never issued. */
  attestations: PassportAttestationFact[];
  /** `aml.cases.service_gate_status` — the canonical "may the service proceed". */
  service_gate_status: string | null;
  /** `aml.cases.status` (legacy enum) — used only to detect closure. */
  case_status: string | null;
  /**
   * Whether the current attestation's material inputs still match the case.
   * `true`/`false` only when assessable (schema v2 material-input hash);
   * `null` = not assessable (v1 attestation) and never forces a caution state.
   */
  material_inputs_current: boolean | null;
  /** Open rows in `aml.partner_refresh_obligations` for the case. */
  open_refresh_obligations: number;
};

export type PassportStateResult = {
  code: PassportStateCode;
  /** Rendered verbatim by every surface. */
  label: string;
  tone: PassportStateTone;
  /** Machine-readable reasons for the derivation — shown in Command only. */
  reasons: string[];
  /** The unsuperseded attestation version, if one exists. */
  current_version: number | null;
  /** Highest version ever issued (register length), 0 = never issued. */
  latest_version: number;
};

const GATE_APPROVED = new Set(["approved", "approved_with_controls"]);

const LABELS: Record<PassportStateCode, { label: string; tone: PassportStateTone }> = {
  not_issued: { label: "Not issued", tone: "muted" },
  ready_for_issuance: { label: "Ready for issuance", tone: "progress" },
  issued_current: { label: "Issued · Current", tone: "success" },
  superseded: { label: "Superseded — new version pending", tone: "attention" },
  refresh_required: { label: "Refresh required", tone: "attention" },
  suspended: { label: "Suspended", tone: "destructive" },
  revoked: { label: "Revoked", tone: "destructive" },
  completed_retained: { label: "Completed — retained record", tone: "muted" },
};

function result(
  code: PassportStateCode,
  reasons: string[],
  currentVersion: number | null,
  latestVersion: number,
): PassportStateResult {
  return { code, ...LABELS[code], reasons, current_version: currentVersion, latest_version: latestVersion };
}

export function derivePassportState(input: PassportStateInput): PassportStateResult {
  const attestations = [...(input.attestations ?? [])].sort((a, b) => a.version - b.version);
  const latest = attestations.length ? attestations[attestations.length - 1].version : 0;
  const current = attestations.filter((a) => !a.superseded_at).pop() ?? null;
  const currentVersion = current?.version ?? null;
  const gate = input.service_gate_status ?? null;

  // Restriction states win over everything: they are explicit, reasoned MLRO
  // gate decisions, and a restricted Passport must never read as Current.
  if (gate === "terminated") {
    return result("revoked", ["service_gate_terminated"], currentVersion, latest);
  }
  if (gate === "locked") {
    return result("suspended", ["service_gate_locked"], currentVersion, latest);
  }

  // Never issued: the journey is still building the record.
  if (attestations.length === 0) {
    if (gate && GATE_APPROVED.has(gate)) {
      return result("ready_for_issuance", ["gate_approved_no_attestation"], null, 0);
    }
    return result("not_issued", ["no_attestation"], null, 0);
  }

  // Closed case with an issued record: retained under the compliance
  // retention period rather than removed (never "deleted").
  if (input.case_status === "closed") {
    return result("completed_retained", ["case_closed"], currentVersion, latest);
  }

  // Every version superseded and no successor yet — the window between a
  // material change and reissue. A caution state, not a failure.
  if (!current) {
    return result("superseded", ["all_versions_superseded"], null, latest);
  }

  const reasons: string[] = [];
  if (input.material_inputs_current === false) reasons.push("material_inputs_changed");
  if ((input.open_refresh_obligations ?? 0) > 0) reasons.push("open_refresh_obligation");
  // A gate that has regressed below approved (e.g. cleared → under_review)
  // must not leave the Passport claiming Current: reliance-readiness derives
  // only from an explicitly approved gate, the same rule the attestation
  // payload itself applies to `service_readiness`.
  if (gate && !GATE_APPROVED.has(gate)) reasons.push("service_gate_regressed");

  if (reasons.length > 0) {
    return result("refresh_required", reasons, currentVersion, latest);
  }

  return result("issued_current", ["current_attestation_gate_approved"], currentVersion, latest);
}

/** Per-version register state — the version panel's vocabulary. */
export type PassportVersionState = "current" | "superseded" | "initial_issue";

export function versionRegisterState(
  fact: PassportAttestationFact,
  all: PassportAttestationFact[],
): PassportVersionState {
  if (!fact.superseded_at) return "current";
  const minVersion = Math.min(...all.map((a) => a.version));
  return fact.version === minVersion ? "initial_issue" : "superseded";
}
