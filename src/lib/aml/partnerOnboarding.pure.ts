/**
 * Partner onboarding — the vocabulary and defaults for taking a partner
 * from "does not exist in the system" to "holds a passport grant" in one
 * guided pass.
 *
 * ── The defect this replaces ──────────────────────────────────────────
 * Granting a partner access required four separate acts spread across
 * three dialogs — record the organisation (free-text type field), record
 * the written arrangement (typing the partner's name again, exactly),
 * link the partner to the case (typing it a third time), then grant —
 * and nothing said the order. Production held zero organisations, zero
 * arrangements and zero links: nobody had ever made it through.
 *
 * ── What this module is ───────────────────────────────────────────────
 * Presentation arithmetic only: the portal and legal-route catalogues
 * with their meanings, the date and wording defaults, and the readiness
 * reading for the grant step. It performs nothing — the `aml-reliance`
 * ops enforce every rule (MLRO role, written arrangement, review
 * currency, client sharing consent, attestation existence), and nothing
 * here can bypass one. A readiness reading of `null` means UNKNOWN and
 * is never treated as satisfied.
 */

export interface PartnerPortalChoice {
  value: "finance" | "builder" | "developer" | "solicitor_conveyancer" | "other";
  label: string;
  /** Default relationship role recorded on the case link. */
  role: string;
  meaning: string;
}

/**
 * The portals a partner can belong to. The token a grant mints is
 * redeemed by the partner's portal integration — the partner does NOT
 * need a portal account before the passport is issued to them.
 */
export const PARTNER_PORTAL_CHOICES: PartnerPortalChoice[] = [
  {
    value: "finance", label: "Finance portal", role: "lender",
    meaning: "Mortgage brokers and lenders relying on the completed verification for the lending file.",
  },
  {
    value: "builder", label: "Builder portal", role: "builder",
    meaning: "Building partners on the client's construction contract.",
  },
  {
    value: "developer", label: "Developer portal", role: "developer",
    meaning: "Development partners on the client's purchase.",
  },
  {
    value: "solicitor_conveyancer", label: "Solicitors & conveyancers", role: "buyer_solicitor",
    meaning: "The legal practice acting on the client's matter.",
  },
  {
    value: "other", label: "Other", role: "partner",
    meaning: "Any other organisation with a recorded reason to access this matter.",
  },
];

export interface LegalRouteChoice {
  value: "reliance" | "independent_cdd" | "outsourced_cdd" | "information_share_only";
  label: string;
  meaning: string;
}

/**
 * The legal route is a RECORDED decision, never inferred from portal
 * type. Reliance is the default here because this flow ends in a
 * passport grant, which is a reliance disclosure.
 */
export const LEGAL_ROUTE_CHOICES: LegalRouteChoice[] = [
  {
    value: "reliance", label: "Reliance (Pt 2 Div 7)",
    meaning: "The partner relies on our customer identification under the written arrangement — the route a passport grant uses.",
  },
  {
    value: "independent_cdd", label: "Independent CDD",
    meaning: "The partner makes its own determination against the same records. Always available; no arrangement needed.",
  },
  {
    value: "outsourced_cdd", label: "Outsourced CDD",
    meaning: "We perform identification as the partner's service provider under an outsourcing arrangement.",
  },
  {
    value: "information_share_only", label: "Information share only",
    meaning: "Named records are shared for a documented purpose — no reliance and no passport follows.",
  },
];

/** YYYY-MM-DD for a date, in local time (the server expects a plain date). */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * s 37A requires the arrangement to be reviewed regularly, and an overdue
 * review blocks new grants — so the default review date is one year out,
 * never "sometime".
 */
export function defaultReviewDate(from: Date): string {
  const d = new Date(from.getTime());
  d.setFullYear(d.getFullYear() + 1);
  return isoDate(d);
}

/** A purpose the operator edits, never an empty box (the server requires ≥ 10 chars). */
export function defaultPurpose(portalLabel: string, role: string): string {
  return `${portalLabel} partner acting as ${role.replace(/_/g, " ")} on this client's matter — access under the recorded arrangement for passport reliance.`;
}

/**
 * ── The prebuilt arrangement ──────────────────────────────────────────
 * Every portal sign-up executes the "Portal Access, Confidentiality,
 * Privacy and AML/CTF Compliance Passport Agreement" — one prebuilt
 * instrument across the Finance, Builder/Developer and Solicitor
 * portals, whose mandatory `binding_amlctf_arrangement` acknowledgement
 * states that it constitutes the s 37A / rule 6-29 CDD arrangement. The
 * acceptance is refused without that acknowledgement
 * (`_shared/portalAgreement.ts`), and the executed copy lands in Partner
 * Agreement Records.
 *
 * So onboarding a PORTAL partner does not ask the operator to type an
 * arrangement: the register row is recorded automatically against the
 * prebuilt instrument, and the partner's binding acknowledgement is
 * captured when they take up portal access. Only a partner outside the
 * portals ("Other") still records a manual arrangement — there is no
 * sign-up to carry one for them.
 */
export const PREBUILT_AGREEMENT_TITLE =
  "Portal Access, Confidentiality, Privacy and AML/CTF Compliance Passport Agreement";

export function portalHasPrebuiltAgreement(portal: string): boolean {
  return portal !== "other";
}

export interface PrebuiltArrangementDraft {
  agreement_reference: string;
  executed_on: string;
  next_review_due: string;
}

/**
 * The register row for the prebuilt instrument. `executed_on` is the
 * onboarding date — the date this register entry is made; the partner's
 * own binding acknowledgement is captured at portal sign-up and lives in
 * Partner Agreement Records, and the reference says so.
 */
export function prebuiltArrangementDraft(today: Date): PrebuiltArrangementDraft {
  return {
    agreement_reference: `${PREBUILT_AGREEMENT_TITLE} — acknowledged at portal sign-up`,
    executed_on: isoDate(today),
    next_review_due: defaultReviewDate(today),
  };
}

/** The invite email is the door into the portal — validated before anything sends. */
export function isValidEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

/**
 * The builder portal's organisation vocabulary for the two portals it
 * serves. A "developer" partner signs into the Builder/Developer portal
 * as a developer organisation — the portal is shared, the type is not.
 */
export function builderOrgType(portal: string): "builder" | "developer" {
  return portal === "developer" ? "developer" : "builder";
}

export interface GrantReadinessFacts {
  /** Current attestation version, null when none is issued. */
  attestationVersion: number | null;
  /** Client sharing consent: true accepted, false known-missing, null unknown. */
  sharingConsent: boolean | null;
}

export interface GrantReadiness {
  ready: boolean;
  /** Blockers, named before the click — the server enforces the same rules. */
  blockers: string[];
  /** Cautions that do not block (an UNKNOWN reading is a caution, never a pass). */
  cautions: string[];
}

export function grantReadiness(f: GrantReadinessFacts): GrantReadiness {
  const blockers: string[] = [];
  const cautions: string[] = [];
  if (f.attestationVersion === null) {
    blockers.push("Issue the attestation first — a grant hands the partner an issued version, and none exists yet.");
  }
  if (f.sharingConsent === false) {
    blockers.push("The client has not accepted the sharing consent in their portal. Sharing their completed verification without it is refused (APP 6).");
  } else if (f.sharingConsent === null) {
    cautions.push("The client's sharing-consent status could not be read — the server will still enforce it.");
  }
  return { ready: blockers.length === 0, blockers, cautions };
}
