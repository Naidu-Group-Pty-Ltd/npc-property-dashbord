import type { AmlScreeningReadinessReading } from "./screeningReadiness";

/**
 * WHICH screening a case actually needs — and which it does not.
 *
 * ── The request, and the one correction it needs ──────────────────────
 * The ask was: if the client's answers say PEP and adverse-media screening
 * are not required, mark Stage 5 "not required", skip it, and move to
 * Stage 6.
 *
 * The first half is right and is implemented here. The second half is not
 * safe as stated, for one reason:
 *
 *   **SANCTIONS SCREENING IS NOT RISK-BASED.**
 *
 * Australia's targeted financial sanctions obligations bite on everyone.
 * There is no questionnaire answer, risk rating or customer profile that
 * removes them — that is precisely what distinguishes them from PEP and
 * adverse-media screening, which ARE risk-based and can legitimately be
 * scoped out with a recorded basis.
 *
 * Stage 5 is labelled "PEP · Sanctions · Adverse media". Skipping the STAGE
 * therefore skips sanctions, and a case that never ran sanctions screening
 * would carry a compliance gap that no later stage recovers — while looking,
 * on the rail, exactly like one that had.
 *
 * So this module makes the SCOPE conditional, never the stage:
 *
 *   • `sanctions` is always required. It is not in the waivable set at all,
 *     so no combination of answers can remove it.
 *   • `pep` and `adverse_media` are waived when the client's own answers and
 *     the case's risk indicators support it, each with a written basis.
 *   • A case needing only sanctions still RUNS Stage 5 — it just runs a
 *     narrower check, and finishes quickly.
 *
 * That gives the outcome actually wanted (no client is forced through
 * screening that does not apply to them, and the stage stops being a wall)
 * without inventing a compliance position.
 *
 * ── Absence is never a negative answer ────────────────────────────────
 * An unanswered questionnaire does not waive anything. "The client did not
 * say they were a PEP" and "the client said they are not a PEP" are
 * different facts, and only the second is evidence. Every waiver here
 * requires an explicit answer to be present.
 */

export type AmlScreeningScope = "pep" | "sanctions" | "adverse_media" | "watchlist";

/** The scopes that may EVER be waived. Sanctions is deliberately absent. */
export const WAIVABLE_SCREENING_SCOPES: readonly AmlScreeningScope[] = [
  "pep", "adverse_media",
] as const;

/** Always run, for every customer, regardless of anything below. */
export const MANDATORY_SCREENING_SCOPES: readonly AmlScreeningScope[] = ["sanctions"] as const;

/**
 * The client's own declarations, as the portal questionnaire records them.
 * `undefined` means unanswered — which never waives.
 */
export interface AmlScreeningAnswers {
  /** `personal_details.pep` — "are you a politically exposed person?" */
  pep?: "yes" | "no" | null;
  /** `personal_details.adverse` — adverse-media self-declaration. */
  adverse?: "yes" | "no" | null;
  /** `purchase_profile.third_party` — is anybody else involved? */
  thirdParty?: "yes" | "no" | null;
  /** `funding.overseas` — are funds coming from overseas? */
  overseasFunding?: "yes" | "no" | null;
}

export interface AmlScreeningScopeFacts {
  answers: AmlScreeningAnswers | null;
  /** `purchasing_structure.entity_type` — individuals only can narrow. */
  entityType?: string | null;
  subjectType?: string | null;
  riskRating?: string | null;
  /** True when the case is in enhanced due diligence. */
  enhancedDueDiligence?: boolean;
}

export interface AmlScreeningScopeDecision {
  /** What must actually be screened. Always contains `sanctions`. */
  required: AmlScreeningScope[];
  /** What was waived, each with the basis recorded for the audit trail. */
  waived: Array<{ scope: AmlScreeningScope; basis: string }>;
  /**
   * True when nothing beyond the mandatory scopes is required — the case the
   * request called "screening not required". The stage still runs; it just
   * runs narrow.
   */
  narrowed: boolean;
  /**
   * True when the answers needed to narrow are missing. Everything is
   * required, and the reason is that we do not know rather than that we
   * decided.
   */
  undetermined: boolean;
  /** One sentence for the operator. */
  summary: string;
}

const answered = (v: unknown): v is "yes" | "no" => v === "yes" || v === "no";

/**
 * Reasons a case cannot narrow, regardless of what the client answered.
 * Each is a risk indicator that makes PEP and adverse-media screening
 * proportionate even when the client declares nothing.
 */
function escalators(facts: AmlScreeningScopeFacts): string[] {
  const out: string[] = [];
  const risk = String(facts.riskRating ?? "").toLowerCase();
  if (risk === "high" || risk === "prohibited") {
    out.push(`the case is rated ${risk} risk`);
  }
  if (facts.enhancedDueDiligence) out.push("the case is in enhanced due diligence");

  const entity = String(facts.entityType ?? facts.subjectType ?? "").toLowerCase();
  if (entity && entity !== "individual" && entity !== "individuals") {
    // A company or trust has controllers who are not the named subject, and
    // narrowing on the subject's own answers would miss them.
    out.push(`the customer is a ${entity} rather than an individual`);
  }
  if (facts.answers?.overseasFunding === "yes") out.push("funds are coming from overseas");
  if (facts.answers?.thirdParty === "yes") out.push("a third party is involved in the purchase");
  return out;
}

export function deriveAmlScreeningScope(
  facts: AmlScreeningScopeFacts | null | undefined,
): AmlScreeningScopeDecision {
  const all: AmlScreeningScope[] = ["sanctions", "pep", "adverse_media"];

  if (!facts || !facts.answers) {
    return {
      required: all,
      waived: [],
      narrowed: false,
      undetermined: true,
      summary:
        "The client's declarations have not been read, so the full screening scope applies.",
    };
  }

  const { pep, adverse } = facts.answers;
  const blocks = escalators(facts);

  // Both answers must be PRESENT to narrow anything. Absence is not a no.
  if (!answered(pep) || !answered(adverse)) {
    return {
      required: all,
      waived: [],
      narrowed: false,
      undetermined: true,
      summary:
        "The client has not answered the politically-exposed-person and adverse-media " +
        "questions, so the full screening scope applies.",
    };
  }

  if (blocks.length > 0) {
    return {
      required: all,
      waived: [],
      narrowed: false,
      undetermined: false,
      summary:
        `The full screening scope applies because ${blocks.join(", and ")}.`,
    };
  }

  const required: AmlScreeningScope[] = [...MANDATORY_SCREENING_SCOPES];
  const waived: AmlScreeningScopeDecision["waived"] = [];

  if (pep === "no") {
    waived.push({
      scope: "pep",
      basis:
        "The client declared they are not a politically exposed person, the customer is an " +
        "individual, the case is not high risk or in enhanced due diligence, and no overseas " +
        "funding or third party is involved.",
    });
  } else {
    required.push("pep");
  }

  if (adverse === "no") {
    waived.push({
      scope: "adverse_media",
      basis:
        "The client declared no adverse media, the customer is an individual, the case is not " +
        "high risk or in enhanced due diligence, and no overseas funding or third party is " +
        "involved.",
    });
  } else {
    required.push("adverse_media");
  }

  const narrowed = waived.length > 0;
  return {
    required,
    waived,
    narrowed,
    undetermined: false,
    summary: narrowed
      ? "Sanctions screening applies to every customer and still runs. " +
        `${waived.map((w) => label(w.scope)).join(" and ")} ` +
        `${waived.length === 1 ? "is" : "are"} not required for this client.`
      : "The full screening scope applies.",
  };
}

function label(scope: AmlScreeningScope): string {
  return scope === "pep" ? "PEP screening"
    : scope === "adverse_media" ? "Adverse-media screening"
      : scope === "watchlist" ? "Watchlist screening"
        : "Sanctions screening";
}

/**
 * What the operator should see on Stage 5, combining WHAT is required with
 * WHETHER it can run.
 *
 * The two are independent and both matter: a narrowed case whose sanctions
 * provider is unconfigured is still blocked, and saying "screening not
 * required" there would be false.
 */
export function describeScreeningStage(
  scope: AmlScreeningScopeDecision,
  readiness: AmlScreeningReadinessReading | null,
): { headline: string; canProceed: boolean; detail: string } {
  const blocked = readiness ? !readiness.canRun : false;
  if (blocked) {
    return {
      headline: "Screening cannot run yet",
      canProceed: false,
      // Never "not required" — sanctions is still outstanding.
      detail:
        scope.narrowed
          ? "Sanctions screening is still required for this client and the provider is not ready."
          : readiness?.detail ?? "The screening configuration is incomplete.",
    };
  }
  return {
    headline: scope.narrowed ? "Reduced screening scope" : "Screening required",
    canProceed: true,
    detail: scope.summary,
  };
}
