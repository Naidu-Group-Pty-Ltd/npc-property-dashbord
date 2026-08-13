/**
 * Passport view — the ONE projection that turns authoritative AML records
 * into audience-safe Passport view models.
 *
 * Three audiences, one assembler:
 *   command — richest AUTHORISED view (still not raw database access);
 *   client  — a dedicated server-side sanitised projection. Never the command
 *             payload with fields hidden by the browser;
 *   partner — NOT built here. Partner disclosure continues through the
 *             existing reliance engine (`intersectPayloadWithManifest` on
 *             `aml-reliance`); the Passport only re-presents that payload.
 *
 * Sanitisation is structural, not cosmetic:
 *   - the client view is BUILT from allow-lists (identity fields, stamp
 *     vocabulary, constructed history) — nothing is copied then redacted;
 *   - `assertClientSafe` deep-scans the finished view for restricted
 *     vocabulary and FAILS CLOSED (throws) if any is found, so a future
 *     accidental widening cannot ship silently. Contract tests pin this.
 *
 * Never in ANY projection produced here: screening match content, risk
 *   ratings/scores, analyst/reviewer/MLRO reasoning, SMR/suspicion material,
 *   provider payloads or secrets, biometric media/scores, storage paths.
 * Additionally never in the CLIENT view: screening/PEP detail of any kind,
 *   funding review detail, EDD reasoning, partner internal assessment notes,
 *   raw case-event summaries (client history is constructed from stamps and
 *   the client's own requests instead).
 */

import {
  derivePassportState,
  type PassportAttestationFact,
  type PassportStateResult,
  versionRegisterState,
  type PassportVersionState,
} from "./passportState.pure.ts";
import {
  clientSafeStamps,
  derivePassportStamps,
  type PassportStamp,
  type PassportStampInput,
} from "./passportStamps.pure.ts";
import { passportCredential, passportVersionLabel, shortFingerprint } from "./passportCredential.pure.ts";

export type PassportAudience = "command" | "client";

/* ── input row shapes (tight selects, fetched by the edge function) ─────── */

export type PassportCaseFact = {
  id: string;
  case_reference: string | null;
  subject_display_name: string | null;
  subject_type: string | null;
  status: string | null;
  case_stage: string | null;
  service_gate_status: string | null;
  opened_at: string | null;
  closed_at: string | null;
};

export type PassportDocumentFact = {
  id: string;
  requirement_label: string | null;
  requirement_code: string | null;
  required: boolean | null;
  status: string;
  created_at: string | null;
  version_number: number | null;
};

export type PassportTransactionFact = {
  id: string;
  kind: string | null;
  status: string | null;
  property_address: string | null;
  contract_date: string | null;
  settlement_date: string | null;
  purchase_price: number | null;
};

export type PassportPartnerFact = {
  org_name: string | null;
  org_type: string | null;
  portal_type: string | null;
  link_state: string | null;
  legal_route: string | null;
  grant_created_at: string | null;
  grant_expires_at: string | null;
  grant_revoked_at: string | null;
  attestation_version: number | null;
  last_viewed_at: string | null;
  assessment_status: string | null;
  assessment_decided_at: string | null;
  assessor_name: string | null;
};

export type PassportEventFact = {
  id: string;
  category: string;
  summary: string;
  actor_label: string | null;
  created_at: string;
};

export type PassportClientRequestFact = {
  id: string;
  kind: string;
  subject: string | null;
  status: string;
  created_at: string;
};

export type PassportViewInput = {
  issuer_org: string;
  officer_label: string | null;
  case: PassportCaseFact;
  attestations: PassportAttestationFact[];
  material_inputs_current: boolean | null;
  open_refresh_obligations: number;
  /** questionnaire payloads, exactly as stored; allow-listed here. */
  personal_details: Record<string, unknown> | null;
  entity_details: Record<string, unknown> | null;
  documents: PassportDocumentFact[];
  transactions: PassportTransactionFact[];
  /** Command-only families; omit entirely for the client audience. */
  screening?: {
    subjects: Array<{ state: string; completed_at?: string | null; party_label?: string | null }>;
    pep_result: string | null;
    pep_determined_at: string | null;
    list_freshness: Record<string, string>;
  } | null;
  funding?: {
    sof: Array<{ verified: boolean | null; verified_at: string | null }>;
    sow: Array<{ verified: boolean | null; verified_at: string | null }>;
    edd: Array<{ status: string; completed_at?: string | null }>;
  } | null;
  partners?: PassportPartnerFact[] | null;
  events?: PassportEventFact[] | null;
  client_requests: PassportClientRequestFact[];
  stamp_input: PassportStampInput;
};

/* ── view model ─────────────────────────────────────────────────────────── */

export type PassportVersionRow = {
  version: number;
  label: string | null;
  state: PassportVersionState;
  issued_at: string | null;
  superseded_at: string | null;
  fingerprint_short: string | null;
  schema_version: number | null;
};

export type PassportView = {
  audience: PassportAudience;
  header: {
    credential: string | null;
    case_reference: string | null;
    subject: string | null;
    subject_type: string | null;
    issuer_org: string;
    officer_label: string | null;
    state: PassportStateResult;
    current_version_label: string | null;
    evidence_fingerprint: string | null;
    evidence_fingerprint_short: string | null;
    first_issued_at: string | null;
    last_issued_at: string | null;
    opened_at: string | null;
  };
  versions: PassportVersionRow[];
  identity: { fields: Array<{ key: string; label: string; value: string }> };
  verification: {
    parties: Array<{
      party: string;
      verified: boolean;
      method: string | null;
      completed_at: string | null;
      components: Array<{ check_type: string; status: string; completed_at: string | null }>;
    }>;
  };
  documents: Array<{
    id: string;
    label: string;
    required: boolean;
    status: string;
    uploaded_at: string | null;
    version_number: number | null;
  }>;
  transactions: Array<{
    id: string;
    kind: string | null;
    status: string | null;
    property_address: string | null;
    contract_date: string | null;
    settlement_date: string | null;
    /** Command always; client sees their own purchase figures too. */
    purchase_price: number | null;
  }>;
  stamps: PassportStamp[];
  /** Command: raw hash-chained events. Client: CONSTRUCTED timeline. */
  history: Array<{
    id: string | null;
    at: string;
    title: string;
    detail: string | null;
    source: string;
  }>;
  /** Command-only sections; structurally absent for the client. */
  screening?: {
    performed: boolean;
    subjects_total: number;
    subjects_completed: number;
    last_completed_at: string | null;
    pep_result: string | null;
    pep_determined_at: string | null;
    list_freshness: Record<string, string>;
  };
  funding?: {
    sof_total: number;
    sof_verified: number;
    sow_total: number;
    sow_verified: number;
    edd_present: boolean;
    edd_completed: boolean;
  };
  partners?: Array<{
    org_name: string | null;
    org_type: string | null;
    portal_type: string | null;
    link_state: string | null;
    legal_route: string | null;
    grant_created_at: string | null;
    grant_expires_at: string | null;
    grant_revoked_at: string | null;
    attestation_version: number | null;
    version_label: string | null;
    last_viewed_at: string | null;
    assessment_status: string | null;
    assessment_decided_at: string | null;
    assessor_name: string | null;
  }>;
  open_requests: PassportClientRequestFact[];
};

/* ── identity allow-lists (questionnaire keys are the contract) ─────────── */

// personal_details deliberately EXCLUDES `pep` and `adverse`: they are
// screening-adjacent self-declarations, and no Passport projection carries
// screening-adjacent flags. The command view has real screening records in
// their own section; the client already answered these once and re-showing
// them adds nothing.
const PERSONAL_FIELDS: Array<{ key: string; label: string }> = [
  { key: "full_name", label: "Full legal name" },
  { key: "dob", label: "Date of birth" },
  { key: "citizenship", label: "Citizenship" },
  { key: "tax_residency", label: "Tax residency" },
  { key: "address", label: "Residential address" },
  { key: "occupation", label: "Occupation" },
];

const ENTITY_FIELDS: Array<{ key: string; label: string }> = [
  { key: "entity_name", label: "Entity name" },
  { key: "abn_acn", label: "ABN / ACN" },
  { key: "registration_place", label: "Place of registration" },
  { key: "registered_address", label: "Registered address" },
  { key: "trustee_type", label: "Trustee type" },
];

function allowListedFields(
  payload: Record<string, unknown> | null,
  fields: Array<{ key: string; label: string }>,
): Array<{ key: string; label: string; value: string }> {
  if (!payload) return [];
  const out: Array<{ key: string; label: string; value: string }> = [];
  for (const f of fields) {
    const v = payload[f.key];
    if (typeof v === "string" && v.trim()) out.push({ key: f.key, label: f.label, value: v.trim().slice(0, 300) });
  }
  return out;
}

/* ── client tripwire ────────────────────────────────────────────────────── */

/**
 * Restricted vocabulary that must never appear as a KEY anywhere in a client
 * view. Deep-scanned over the finished object; a hit throws. This is the
 * fail-closed backstop behind the allow-lists, mirroring the attestation
 * restricted-key tripwire — belt AND braces, because the failure mode
 * (internal compliance material on a client's screen) is not recoverable.
 */
const CLIENT_RESTRICTED_KEYS =
  /(risk_(rating|score)|screening|sanction|pep(\b|_)|adverse|match_|mlro|suspic|smr(\b|_)|austrac|reviewer_note|internal_note|decision_note|rationale|biometric|liveness_score|face_match|provider_(payload|reference|secret)|storage_(path|bucket)|access_token|secret|api_key)/i;

export function findClientRestrictedKeys(value: unknown, path = ""): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findClientRestrictedKeys(v, `${path}[${i}]`)));
    return hits;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (CLIENT_RESTRICTED_KEYS.test(k)) hits.push(p);
      hits.push(...findClientRestrictedKeys(v, p));
    }
  }
  return hits;
}

export function assertClientSafe(view: PassportView): void {
  const hits = findClientRestrictedKeys(view);
  if (hits.length > 0) {
    throw new Error(`client passport view carries restricted keys: ${hits.slice(0, 5).join(", ")}`);
  }
}

/* ── assembler ──────────────────────────────────────────────────────────── */

const METHOD_ACCEPTED = new Set(["electronic_idv", "document_sighting", "dvs"]);

export function buildPassportView(audience: PassportAudience, input: PassportViewInput): PassportView {
  const attestations = [...(input.attestations ?? [])].sort((a, b) => a.version - b.version);
  const current = attestations.filter((a) => !a.superseded_at).pop() ?? null;
  const state = derivePassportState({
    attestations,
    service_gate_status: input.case.service_gate_status,
    case_status: input.case.status,
    material_inputs_current: input.material_inputs_current,
    open_refresh_obligations: input.open_refresh_obligations,
  });

  const allStamps = derivePassportStamps(input.stamp_input);
  const stamps = audience === "client" ? clientSafeStamps(allStamps) : allStamps;

  // State derivation reasons are Command diagnostics. The client sees the
  // label and tone; the machine codes (e.g. `service_gate_regressed`) name
  // internal workflow the client view must not carry.
  const stateForAudience = audience === "client" ? { ...state, reasons: [] } : state;

  // Verification parties: collapse checks per party label; no provider, no
  // scores — component status and timing only.
  const partyMap = new Map<string, PassportView["verification"]["parties"][number]>();
  for (const c of input.stamp_input.verification_checks ?? []) {
    const key = c.party_label ?? input.case.subject_display_name ?? "Subject";
    const entry = partyMap.get(key) ?? { party: key, verified: false, method: null, completed_at: null, components: [] };
    entry.components.push({ check_type: c.check_type, status: c.status, completed_at: c.completed_at });
    if (c.status === "passed" && METHOD_ACCEPTED.has(c.check_type)) {
      entry.verified = true;
      entry.method = c.check_type;
      entry.completed_at = c.completed_at;
    }
    partyMap.set(key, entry);
  }

  const versions: PassportVersionRow[] = attestations.map((a) => ({
    version: a.version,
    label: passportVersionLabel(a.version),
    state: versionRegisterState(a, attestations),
    issued_at: a.issued_at,
    superseded_at: a.superseded_at,
    fingerprint_short: shortFingerprint(a.payload_sha256),
    schema_version: a.schema_version ?? 1,
  }));

  const view: PassportView = {
    audience,
    header: {
      credential: passportCredential(input.case.case_reference, current?.version ?? null),
      case_reference: input.case.case_reference,
      subject: input.case.subject_display_name,
      subject_type: input.case.subject_type,
      issuer_org: input.issuer_org,
      officer_label: input.officer_label,
      state: stateForAudience,
      current_version_label: passportVersionLabel(current?.version ?? null),
      evidence_fingerprint: current?.payload_sha256 ?? null,
      evidence_fingerprint_short: shortFingerprint(current?.payload_sha256),
      first_issued_at: attestations[0]?.issued_at ?? null,
      last_issued_at: current?.issued_at ?? attestations[attestations.length - 1]?.issued_at ?? null,
      opened_at: input.case.opened_at,
    },
    versions,
    identity: {
      fields: [
        ...allowListedFields(input.personal_details, PERSONAL_FIELDS),
        ...allowListedFields(input.entity_details, ENTITY_FIELDS),
      ],
    },
    verification: { parties: [...partyMap.values()] },
    documents: (input.documents ?? []).map((d) => ({
      id: d.id,
      label: d.requirement_label ?? d.requirement_code ?? "Document",
      required: Boolean(d.required),
      status: d.status,
      uploaded_at: d.created_at,
      version_number: d.version_number,
    })),
    transactions: (input.transactions ?? []).map((t) => ({
      id: t.id,
      kind: t.kind,
      status: t.status,
      property_address: t.property_address,
      contract_date: t.contract_date,
      settlement_date: t.settlement_date,
      purchase_price: t.purchase_price,
    })),
    stamps,
    history: audience === "command"
      ? (input.events ?? []).map((e) => ({
          id: e.id,
          at: e.created_at,
          title: e.summary,
          detail: e.category,
          source: e.actor_label ?? "System",
        }))
      // Client history is CONSTRUCTED — stamps plus the client's own
      // requests. Raw event summaries never reach the client, because a
      // summary written for staff can carry vocabulary a client must not see.
      : [
          ...stamps.map((s) => ({
            id: null,
            at: s.at,
            title: s.title,
            detail: s.org,
            source: s.portal,
          })),
          ...(input.client_requests ?? []).map((r) => ({
            id: r.id,
            at: r.created_at,
            title: r.subject ? `Request: ${r.subject}` : "Information request",
            detail: r.status === "open" ? "Action required" : "Answered",
            source: "Client Portal",
          })),
        ].sort((a, b) => a.at.localeCompare(b.at)),
    open_requests: (input.client_requests ?? []).filter((r) => r.status === "open"),
  };

  if (audience === "command") {
    if (input.screening) {
      const subjects = input.screening.subjects ?? [];
      const terminal = new Set(["completed", "false_positive", "confirmed_match", "not_required"]);
      view.screening = {
        performed: subjects.length > 0,
        subjects_total: subjects.length,
        subjects_completed: subjects.filter((s) => terminal.has(s.state)).length,
        last_completed_at: subjects.reduce<string | null>(
          (best, s) => (s.completed_at && (!best || s.completed_at > best) ? s.completed_at : best),
          null,
        ),
        pep_result: input.screening.pep_result,
        pep_determined_at: input.screening.pep_determined_at,
        list_freshness: input.screening.list_freshness ?? {},
      };
    }
    if (input.funding) {
      view.funding = {
        sof_total: input.funding.sof.length,
        sof_verified: input.funding.sof.filter((r) => r.verified).length,
        sow_total: input.funding.sow.length,
        sow_verified: input.funding.sow.filter((r) => r.verified).length,
        edd_present: input.funding.edd.length > 0,
        edd_completed: input.funding.edd.some((e) => e.status === "completed"),
      };
    }
    if (input.partners) {
      view.partners = input.partners.map((p) => ({
        ...p,
        version_label: passportVersionLabel(p.attestation_version),
      }));
    }
  } else {
    // Structural, not cosmetic: the client view never had these sections.
    assertClientSafe(view);
  }

  return view;
}
