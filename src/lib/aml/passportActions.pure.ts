/**
 * The Compliance Passport's acts, explained — what each button DOES, in
 * which order, and why one is unavailable right now.
 *
 * ── The defect this replaces ──────────────────────────────────────────
 * The reliance panel's header was four bare buttons: "Arrangement",
 * "Issue attestation", "Material change", "Grant access". Nothing said
 * what any of them did, nothing said their order, and production held
 * ZERO written arrangements — so "Grant access" answered every click
 * with a refusal toast ("No active CDD arrangement") that read as the
 * button being broken. A blocked act must name its enabler BEFORE the
 * click, the same rule the service gate and the decision already follow.
 *
 * ── What this module is ───────────────────────────────────────────────
 * Presentation arithmetic only. It performs nothing, fetches nothing and
 * decides nothing — the server's `aml-reliance` ops still enforce every
 * rule (MLRO role, active arrangement, attestation existence). The
 * vocabulary here deliberately shares nothing with a clearance: an act
 * being "ready" is availability, never a compliance claim.
 */

export interface PassportActionFacts {
  /** Current (unsuperseded) attestation, or null when none is issued. */
  attestationVersion: number | null;
  issuedAt: string | null;
  /** SERVER-derived passport state code; null = reading unavailable. */
  passportStateCode: string | null;
  activeAgreements: number;
  activeGrants: number;
  isMlro: boolean;
}

export type PassportActionState = "done" | "ready" | "blocked" | "anytime";

export interface PassportActionRow {
  key: "preview" | "issue" | "arrangement" | "grant" | "material";
  label: string;
  /** What the act does — plain words, shown beside the button. */
  meaning: string;
  state: PassportActionState;
  /** The current standing of this act on this case. */
  detail: string;
  /** What enables a blocked act, named before the click. */
  blockedBy: string | null;
}

const MLRO_NEEDED = "Requires the MLRO";

export function passportActions(f: PassportActionFacts): PassportActionRow[] {
  const hasAttestation = f.attestationVersion !== null;
  const refreshFlagged =
    f.passportStateCode === "refresh_required" || f.passportStateCode === "superseded";

  const rows: PassportActionRow[] = [];

  /* 1 · Look before anything is issued or shared. */
  rows.push({
    key: "preview",
    label: "Preview the digital Passport",
    meaning:
      "Opens the Passport exactly as the client and partners will see it — assess it visually before issuing a version or sharing anything.",
    state: "anytime",
    detail: hasAttestation
      ? `Shows the issued record (currently v${f.attestationVersion}).`
      : "Shows the derived record before any version has been issued.",
    blockedBy: null,
  });

  /* 2 · Freeze the verified facts as a numbered version. */
  rows.push({
    key: "issue",
    label: "Issue the attestation",
    meaning:
      "Freezes what was performed — identity verification, screening, consents — as a numbered, hash-stamped version. Partners only ever read an issued version; issuing again supersedes the previous one. Nothing is shared by issuing alone.",
    state: !f.isMlro
      ? "blocked"
      : !hasAttestation
        ? "ready"
        : refreshFlagged
          ? "ready"
          : "done",
    detail: !hasAttestation
      ? "No version issued yet — issuing creates v1."
      : refreshFlagged
        ? `v${f.attestationVersion} is flagged for refresh — issuing v${(f.attestationVersion ?? 0) + 1} supersedes it.`
        : `v${f.attestationVersion} is in force${f.issuedAt ? ` (issued ${new Date(f.issuedAt).toLocaleDateString()})` : ""}. Reissuing supersedes it.`,
    blockedBy: f.isMlro ? null : MLRO_NEEDED,
  });

  /* 3 · The written arrangement reliance stands on. */
  rows.push({
    key: "arrangement",
    label: "Record the written arrangement",
    meaning:
      "Records the written CDD arrangement with the partner organisation (AML/CTF Act Pt 2 Div 7). Reliance is unavailable without one, and an overdue review blocks new grants. The agreement itself lives with legal — this records it.",
    state: !f.isMlro ? "blocked" : f.activeAgreements > 0 ? "done" : "ready",
    detail: f.activeAgreements > 0
      ? `${f.activeAgreements} active arrangement${f.activeAgreements === 1 ? "" : "s"} recorded.`
      : "No written arrangement recorded yet.",
    blockedBy: f.isMlro ? null : MLRO_NEEDED,
  });

  /* 4 · Hand a partner the issued version — the only act that shares. */
  rows.push({
    key: "grant",
    label: "Grant partner access",
    meaning:
      "Gives a partner the current attestation under an active arrangement, via a one-time access token. They see what was performed — never this case's risk assessment.",
    state: !f.isMlro || !hasAttestation || f.activeAgreements === 0 ? "blocked" : "ready",
    detail: f.activeGrants > 0
      ? `${f.activeGrants} active grant${f.activeGrants === 1 ? "" : "s"}.`
      : "No partner has access yet.",
    blockedBy: !f.isMlro
      ? MLRO_NEEDED
      : !hasAttestation
        ? "Issue the attestation first"
        : f.activeAgreements === 0
          ? "Record a written arrangement first"
          : null,
  });

  /* 5 · Ongoing honesty: re-check the attested facts against the case. */
  rows.push({
    key: "material",
    label: "Check for material change",
    meaning:
      "Re-checks the attested facts against the case as it stands now. A genuine change flags the attestation and every grant for refresh — partners see safe refresh wording only, never the detail. No change means exactly that, and nothing moves.",
    state: !f.isMlro || !hasAttestation ? "blocked" : "anytime",
    detail: hasAttestation
      ? refreshFlagged
        ? "A refresh is already flagged — reissue to resolve it."
        : "Run after anything material changes on the case."
      : "Nothing has been attested yet.",
    blockedBy: !f.isMlro ? MLRO_NEEDED : !hasAttestation ? "Issue the attestation first" : null,
  });

  return rows;
}
