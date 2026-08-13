/**
 * Passport stamps — earned from real records, never authored by hand.
 *
 * A stamp is a presentation of something the system already proved: a consent
 * row, a passed verification check, an issued attestation, a partner's
 * recorded assessment, a settled transaction. This module derives stamps from
 * those records directly — it never parses event-log prose, and there is no
 * stamps table to drift. Portal users cannot create, edit or reorder stamps;
 * the only way to earn one is for the underlying record to exist.
 *
 * The vocabulary is CLOSED. A new stamp kind is a reviewed change to
 * `STAMP_VOCABULARY` in this file, nowhere else. Each derived stamp carries a
 * `source` reference (table + id/timestamp) so Command can open the record
 * behind it, and a `client_safe` flag decides whether the client's own view
 * may show it (titles are already safe — the flag exists so partner-sharing
 * visibility remains a deliberate choice, not an accident of vocabulary).
 */

export type PassportStampCode =
  | "client_consent_recorded"
  | "identity_verified"
  | "documents_verified"
  | "ownership_verified"
  | "screening_completed"
  | "source_of_funds_reviewed"
  | "source_of_wealth_reviewed"
  | "edd_completed"
  | "passport_issued"
  | "passport_updated"
  | "passport_superseded"
  | "passport_shared_finance"
  | "passport_shared_solicitor"
  | "passport_shared_builder"
  | "reliance_accepted_finance"
  | "reliance_accepted_solicitor"
  | "reliance_accepted_builder"
  | "independent_cdd_recorded"
  | "passport_refresh_requested"
  | "access_revoked"
  | "transaction_completed";

export type PassportStampShape = "circle" | "rect" | "seal";
export type PassportStampTone = "gold" | "green" | "navy" | "blue" | "red";

export type PassportStamp = {
  code: PassportStampCode;
  title: string;
  /** Organisation the stamp speaks for (issuer or the partner itself). */
  org: string;
  /** Portal surface the underlying record came from. */
  portal: string;
  /** Actor label where the record carries one; null for system events. */
  actor: string | null;
  /** ISO timestamp of the underlying record. */
  at: string;
  /** Attestation version current when the record was made (null = pre-issue). */
  version: number | null;
  shape: PassportStampShape;
  tone: PassportStampTone;
  /** Where the stamp came from — Command opens this record. */
  source: { kind: string; id: string | null };
  /** May the client's own Passport view show this stamp? */
  client_safe: boolean;
};

type VocabEntry = {
  title: string;
  shape: PassportStampShape;
  tone: PassportStampTone;
  client_safe: boolean;
};

export const STAMP_VOCABULARY: Record<PassportStampCode, VocabEntry> = {
  client_consent_recorded: { title: "CLIENT CONSENT RECORDED", shape: "rect", tone: "navy", client_safe: true },
  identity_verified: { title: "IDENTITY VERIFIED", shape: "circle", tone: "gold", client_safe: true },
  documents_verified: { title: "DOCUMENTS VERIFIED", shape: "rect", tone: "gold", client_safe: true },
  ownership_verified: { title: "OWNERSHIP VERIFIED", shape: "seal", tone: "gold", client_safe: true },
  screening_completed: { title: "SCREENING COMPLETED", shape: "rect", tone: "navy", client_safe: true },
  source_of_funds_reviewed: { title: "SOURCE OF FUNDS REVIEWED", shape: "rect", tone: "green", client_safe: true },
  source_of_wealth_reviewed: { title: "SOURCE OF WEALTH REVIEWED", shape: "rect", tone: "green", client_safe: true },
  edd_completed: { title: "ENHANCED DUE DILIGENCE COMPLETED", shape: "rect", tone: "navy", client_safe: false },
  passport_issued: { title: "PASSPORT ISSUED", shape: "circle", tone: "green", client_safe: true },
  passport_updated: { title: "PASSPORT UPDATED", shape: "circle", tone: "gold", client_safe: true },
  passport_superseded: { title: "PASSPORT VERSION SUPERSEDED", shape: "rect", tone: "navy", client_safe: true },
  passport_shared_finance: { title: "FINANCE PASSPORT SHARED", shape: "rect", tone: "blue", client_safe: true },
  passport_shared_solicitor: { title: "SOLICITOR PASSPORT SHARED", shape: "rect", tone: "blue", client_safe: true },
  passport_shared_builder: { title: "BUILDER / DEVELOPER PASSPORT SHARED", shape: "rect", tone: "blue", client_safe: true },
  reliance_accepted_finance: { title: "FINANCE RELIANCE ACCEPTED", shape: "seal", tone: "blue", client_safe: true },
  reliance_accepted_solicitor: { title: "SOLICITOR RELIANCE ACCEPTED", shape: "seal", tone: "blue", client_safe: true },
  reliance_accepted_builder: { title: "BUILDER / DEVELOPER RELIANCE ACCEPTED", shape: "seal", tone: "blue", client_safe: true },
  independent_cdd_recorded: { title: "INDEPENDENT CDD RECORDED", shape: "rect", tone: "blue", client_safe: true },
  passport_refresh_requested: { title: "PASSPORT REFRESH REQUESTED", shape: "rect", tone: "navy", client_safe: true },
  access_revoked: { title: "ACCESS REVOKED", shape: "rect", tone: "red", client_safe: true },
  transaction_completed: { title: "TRANSACTION COMPLETED", shape: "circle", tone: "green", client_safe: true },
};

/* ── source facts (rows the edge function already fetched) ──────────────── */

export type StampConsentFact = { id: string | null; kind: string; accepted_at: string | null; actor_label?: string | null };
export type StampCheckFact = {
  id: string | null; party_label: string | null; check_type: string; status: string; completed_at: string | null;
};
export type StampDocumentFact = { status: string; reviewed_at?: string | null; created_at?: string | null };
export type StampScreeningFact = { state: string; completed_at?: string | null };
export type StampOwnershipFact = { verification_state: string | null; verified_at?: string | null };
export type StampSofFact = { verified: boolean | null; verified_at: string | null };
export type StampEddFact = { status: string; completed_at?: string | null };
export type StampGrantFact = {
  id: string | null;
  created_at: string | null;
  revoked_at: string | null;
  partner_org_name: string | null;
  partner_org_type: string | null; // finance | builder | developer | solicitor_conveyancer | other
  attestation_version: number | null;
};
export type StampAssessmentFact = {
  id: string | null;
  status: string; // satisfied | not_satisfied | records_requested
  decided_at: string | null;
  assessor_name: string | null;
  partner_org_name: string | null;
  partner_org_type: string | null;
};
export type StampRefreshFact = { id: string | null; created_at: string | null; status: string };
export type StampTransactionFact = { id: string | null; status: string; settlement_date: string | null; property_address?: string | null };

export type PassportStampInput = {
  issuer_org: string;
  attestations: Array<{ version: number; issued_at: string | null; superseded_at: string | null }>;
  consents: StampConsentFact[];
  verification_checks: StampCheckFact[];
  documents: StampDocumentFact[];
  screening_subjects: StampScreeningFact[];
  owners: StampOwnershipFact[];
  source_of_funds: StampSofFact[];
  source_of_wealth: StampSofFact[];
  edd_cases: StampEddFact[];
  grants: StampGrantFact[];
  assessments: StampAssessmentFact[];
  refresh_obligations: StampRefreshFact[];
  transactions: StampTransactionFact[];
};

/* ── derivation ─────────────────────────────────────────────────────────── */

const PORTAL_BY_ORG_TYPE: Record<string, string> = {
  finance: "Finance Portal",
  solicitor_conveyancer: "Solicitor Portal",
  builder: "Builder / Developer Portal",
  developer: "Builder / Developer Portal",
};

function orgTypeKey(t: string | null): "finance" | "solicitor" | "builder" | null {
  if (t === "finance") return "finance";
  if (t === "solicitor_conveyancer") return "solicitor";
  if (t === "builder" || t === "developer") return "builder";
  return null;
}

/** Latest version whose issue predates `at` — pre-issue records bind to null. */
function versionAt(
  attestations: PassportStampInput["attestations"],
  at: string | null,
): number | null {
  if (!at) return null;
  let best: number | null = null;
  for (const a of attestations) {
    if (a.issued_at && a.issued_at <= at && (best === null || a.version > best)) best = a.version;
  }
  return best;
}

function maxDate(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const v of values) if (v && (!best || v > best)) best = v;
  return best;
}

export function derivePassportStamps(input: PassportStampInput): PassportStamp[] {
  const issuer = input.issuer_org || "Aurixa Systems";
  const stamps: PassportStamp[] = [];
  const V = (at: string | null) => versionAt(input.attestations ?? [], at);

  const make = (
    code: PassportStampCode,
    at: string | null,
    over: Partial<Pick<PassportStamp, "org" | "portal" | "actor" | "source" | "version">>,
  ) => {
    if (!at) return; // no record time = no stamp; a stamp without provenance is decoration
    const vocab = STAMP_VOCABULARY[code];
    stamps.push({
      code,
      title: vocab.title,
      org: over.org ?? issuer,
      portal: over.portal ?? "Command Centre",
      actor: over.actor ?? null,
      at,
      version: over.version !== undefined ? over.version : V(at),
      shape: vocab.shape,
      tone: vocab.tone,
      source: over.source ?? { kind: "derived", id: null },
      client_safe: vocab.client_safe,
    });
  };

  // Consent — the first recorded client consent of any kind.
  const firstConsent = [...input.consents]
    .filter((c) => c.accepted_at)
    .sort((a, b) => String(a.accepted_at).localeCompare(String(b.accepted_at)))[0];
  if (firstConsent) {
    make("client_consent_recorded", firstConsent.accepted_at, {
      portal: "Client Portal",
      actor: firstConsent.actor_label ?? null,
      source: { kind: "aml.consents", id: firstConsent.id },
    });
  }

  // Identity verified — a passed identity check of any accepted kind exists.
  const passedIdv = input.verification_checks
    .filter((c) => c.status === "passed" && ["electronic_idv", "document_sighting", "dvs"].includes(c.check_type))
    .sort((a, b) => String(b.completed_at ?? "").localeCompare(String(a.completed_at ?? "")))[0];
  if (passedIdv) {
    make("identity_verified", passedIdv.completed_at, {
      source: { kind: "aml.verification_checks", id: passedIdv.id },
    });
  }

  // Documents verified — every non-superseded document accepted, at least one.
  const liveDocs = input.documents.filter((d) => !["superseded", "deleted"].includes(d.status));
  if (liveDocs.length > 0 && liveDocs.every((d) => d.status === "accepted")) {
    make("documents_verified", maxDate(liveDocs.map((d) => d.reviewed_at ?? d.created_at)), {
      source: { kind: "aml.documents", id: null },
    });
  }

  // Ownership verified — at least one owner and none unresolved.
  const owners = input.owners ?? [];
  if (
    owners.length > 0 &&
    owners.every((o) => ["verified", "waived"].includes(String(o.verification_state)))
  ) {
    make("ownership_verified", maxDate(owners.map((o) => o.verified_at)), {
      source: { kind: "aml.beneficial_owners", id: null },
    });
  }

  // Screening completed — every subject reached a terminal, non-error state.
  const subjects = input.screening_subjects ?? [];
  const screeningDone = subjects.length > 0 &&
    subjects.every((s) => ["completed", "false_positive", "confirmed_match", "not_required"].includes(s.state));
  if (screeningDone) {
    make("screening_completed", maxDate(subjects.map((s) => s.completed_at)), {
      portal: "System",
      source: { kind: "aml.party_screening_subjects", id: null },
    });
  }

  // Source of funds / wealth — at least one verified row each.
  const sofAt = maxDate(input.source_of_funds.filter((r) => r.verified).map((r) => r.verified_at));
  if (sofAt) make("source_of_funds_reviewed", sofAt, { source: { kind: "aml.source_of_funds", id: null } });
  const sowAt = maxDate(input.source_of_wealth.filter((r) => r.verified).map((r) => r.verified_at));
  if (sowAt) make("source_of_wealth_reviewed", sowAt, { source: { kind: "aml.source_of_wealth", id: null } });

  // EDD completed — only when an EDD case existed and completed.
  const eddDone = input.edd_cases.filter((e) => e.status === "completed");
  if (eddDone.length > 0) {
    make("edd_completed", maxDate(eddDone.map((e) => e.completed_at)), {
      source: { kind: "aml.edd_cases", id: null },
    });
  }

  // Issuance lineage: v1 = issued; later versions = updated; every
  // superseded version also records its supersession.
  const sorted = [...(input.attestations ?? [])].sort((a, b) => a.version - b.version);
  for (const a of sorted) {
    if (a.issued_at) {
      make(a.version === (sorted[0]?.version ?? 1) ? "passport_issued" : "passport_updated", a.issued_at, {
        version: a.version,
        source: { kind: "aml.compliance_attestations", id: null },
      });
    }
    if (a.superseded_at) {
      make("passport_superseded", a.superseded_at, {
        version: a.version,
        portal: "System",
        source: { kind: "aml.compliance_attestations", id: null },
      });
    }
  }

  // Partner sharing and revocation — from grants.
  for (const g of input.grants ?? []) {
    const key = orgTypeKey(g.partner_org_type);
    if (key && g.created_at) {
      make(`passport_shared_${key}` as PassportStampCode, g.created_at, {
        portal: PORTAL_BY_ORG_TYPE[g.partner_org_type ?? ""] ?? "Command Centre",
        version: g.attestation_version ?? V(g.created_at),
        source: { kind: "aml.reliance_grants", id: g.id },
      });
    }
    if (g.revoked_at) {
      make("access_revoked", g.revoked_at, {
        portal: "Command Centre",
        actor: g.partner_org_name,
        source: { kind: "aml.reliance_grants", id: g.id },
      });
    }
  }

  // Partner decisions — the partner's own stamp, attributed to the partner.
  for (const a of input.assessments ?? []) {
    if (!a.decided_at) continue;
    const key = orgTypeKey(a.partner_org_type);
    if (a.status === "satisfied" && key) {
      make(`reliance_accepted_${key}` as PassportStampCode, a.decided_at, {
        org: a.partner_org_name ?? "Partner organisation",
        portal: PORTAL_BY_ORG_TYPE[a.partner_org_type ?? ""] ?? "Partner portal",
        actor: a.assessor_name,
        source: { kind: "aml.independent_assessments", id: a.id },
      });
    } else if (a.status !== "satisfied") {
      // not_satisfied / records_requested both record independent CDD activity;
      // neither is presented as an acceptance.
      make("independent_cdd_recorded", a.decided_at, {
        org: a.partner_org_name ?? "Partner organisation",
        portal: PORTAL_BY_ORG_TYPE[a.partner_org_type ?? ""] ?? "Partner portal",
        actor: a.assessor_name,
        source: { kind: "aml.independent_assessments", id: a.id },
      });
    }
  }

  // Refresh requested — open or completed obligations both record the ask.
  for (const r of input.refresh_obligations ?? []) {
    if (r.created_at) {
      make("passport_refresh_requested", r.created_at, {
        portal: "System",
        source: { kind: "aml.partner_refresh_obligations", id: r.id },
      });
    }
  }

  // Transaction completed — settled transactions only, from canonical status.
  for (const t of input.transactions ?? []) {
    if (t.status === "settled") {
      make("transaction_completed", t.settlement_date, {
        portal: "System",
        source: { kind: "aml.transactions", id: t.id },
      });
    }
  }

  return stamps.sort((a, b) => a.at.localeCompare(b.at));
}

/** The client's own view: vocabulary-flagged subset, same order. */
export function clientSafeStamps(stamps: PassportStamp[]): PassportStamp[] {
  return stamps.filter((s) => s.client_safe);
}

/* ── client stamp facts ─────────────────────────────────────────────────── */

export type ClientStampFacts = {
  issuer_org: string;
  attestations: PassportStampInput["attestations"];
  consents: StampConsentFact[];
  verification_checks: StampCheckFact[];
  documents: StampDocumentFact[];
  grants: StampGrantFact[];
  assessments: StampAssessmentFact[];
  refresh_obligations: StampRefreshFact[];
  transactions: StampTransactionFact[];
  /** The CURRENT attestation's sanitised payload (v1 or v2 shape), if issued. */
  attestation_payload: Record<string, unknown> | null;
};

/**
 * Assemble the stamp input for the CLIENT audience.
 *
 * The client portal function is contract-bound never to read the restricted
 * case families — not even their table names may appear in its source. So
 * the client's post-issuance milestone facts come from the ISSUED, SANITISED
 * attestation payload instead: what the MLRO attested outward is exactly
 * what the client may see. Before issuance the client earns only the stamps
 * their own actions produce (consent, identity, documents). Families the
 * payload does not carry stay empty — an empty family means "no stamp",
 * never "invent one".
 */
export function buildClientStampInput(facts: ClientStampFacts): PassportStampInput {
  const payload = facts.attestation_payload;
  const performedBlock = payload && typeof payload === "object"
    ? (payload as Record<string, any>).screening ?? null
    : null;
  const attestedComplete: StampScreeningFact[] = performedBlock && performedBlock.performed
    ? [{ state: "completed", completed_at: performedBlock.last_performed_at ?? null }]
    : [];

  return {
    issuer_org: facts.issuer_org,
    attestations: facts.attestations,
    consents: facts.consents,
    verification_checks: facts.verification_checks,
    documents: facts.documents,
    screening_subjects: attestedComplete,
    owners: [],
    source_of_funds: [],
    source_of_wealth: [],
    edd_cases: [],
    grants: facts.grants,
    assessments: facts.assessments,
    refresh_obligations: facts.refresh_obligations,
    transactions: facts.transactions,
  };
}
