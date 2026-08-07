import { describe, expect, it } from "vitest";
import {
  computeRefreshDueAt,
  isPartyScreeningMissing,
  partyScreeningOutstanding,
  pepControlsRequired,
  pepDeterminationCurrent,
  pepDeterminationRequiredForRole,
  projectPartyScreeningState,
} from "../../../supabase/functions/_shared/aml/partyScreening.pure.ts";

/**
 * The projection and gate rules for party screening (Defects C/D/F) and the
 * AUSTRAC PEP control selection (Defect E). These pure functions are the
 * single definition shared by aml-cases, aml-risk, aml-monitoring and the
 * outbox worker's screening consumer.
 */

describe("projectPartyScreeningState — party state derives from canonical matches", () => {
  it("no matches at all → completed", () => {
    expect(projectPartyScreeningState([])).toBe("completed");
  });
  it("any open or escalated match → possible_match", () => {
    expect(projectPartyScreeningState(["open"])).toBe("possible_match");
    expect(projectPartyScreeningState(["dismissed", "escalated"])).toBe("possible_match");
  });
  it("any confirmed match → confirmed_match, even with others open", () => {
    expect(projectPartyScreeningState(["confirmed"])).toBe("confirmed_match");
    expect(projectPartyScreeningState(["open", "confirmed", "dismissed"])).toBe("confirmed_match");
  });
  it("all candidates dismissed → false_positive", () => {
    expect(projectPartyScreeningState(["dismissed"])).toBe("false_positive");
    expect(projectPartyScreeningState(["dismissed", "dismissed"])).toBe("false_positive");
  });
});

describe("required screening blocks clearance in every non-final state (Defect F)", () => {
  const now = "2026-08-07T00:00:00.000Z";
  const subject = (state: string, refresh_due_at: string | null = null) =>
    ({ required: true, state, refresh_due_at });

  it.each(["not_started", "queued", "processing", "error"])("%s is incomplete", (state) => {
    expect(partyScreeningOutstanding(subject(state), now)).toBe("incomplete");
    expect(isPartyScreeningMissing(subject(state), now)).toBe(true);
  });

  it("a technical error stays outstanding and retryable — never clear", () => {
    expect(partyScreeningOutstanding(subject("error"), now)).toBe("incomplete");
  });

  it("possible_match awaits adjudication", () => {
    expect(partyScreeningOutstanding(subject("possible_match"), now)).toBe("unresolved");
    expect(isPartyScreeningMissing(subject("possible_match"), now)).toBe(true);
  });

  it("confirmed_match is a finding, not missing work — the mandatory-hold path owns it", () => {
    expect(partyScreeningOutstanding(subject("confirmed_match"), now)).toBe("confirmed_match");
    expect(isPartyScreeningMissing(subject("confirmed_match"), now)).toBe(false);
  });

  it("satisfied screening past its refresh date is outstanding again", () => {
    expect(partyScreeningOutstanding(subject("completed", "2026-01-01T00:00:00.000Z"), now)).toBe("stale");
    expect(partyScreeningOutstanding(subject("false_positive", "2026-01-01T00:00:00.000Z"), now)).toBe("stale");
    expect(isPartyScreeningMissing(subject("completed", "2026-01-01T00:00:00.000Z"), now)).toBe(true);
  });

  it("current satisfied screening is not outstanding", () => {
    expect(partyScreeningOutstanding(subject("completed", "2027-01-01T00:00:00.000Z"), now)).toBeNull();
    expect(partyScreeningOutstanding(subject("false_positive"), now)).toBeNull();
  });

  it("non-required subjects never block", () => {
    expect(partyScreeningOutstanding({ required: false, state: "error" }, now)).toBeNull();
    expect(partyScreeningOutstanding({ required: true, state: "not_required" }, now)).toBeNull();
  });
});

describe("computeRefreshDueAt", () => {
  it("adds the rescreen interval to the screening time", () => {
    expect(computeRefreshDueAt("2026-01-01T00:00:00.000Z", 365))
      .toBe("2027-01-01T00:00:00.000Z");
  });
  it("falls back to an annual cycle on a nonsense interval", () => {
    expect(computeRefreshDueAt("2026-01-01T00:00:00.000Z", 0))
      .toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("pepControlsRequired — AUSTRAC PEP controls, not rejection (Defect E)", () => {
  const det = (pep_type: string, extra: Record<string, unknown> = {}) => ({
    result: "pep" as const, pep_type, pep_relationship: "self", ...extra,
  });

  it("a foreign PEP always requires EDD and senior manager approval", () => {
    for (const risk of ["low", "medium", "high", null]) {
      expect(pepControlsRequired(det("foreign"), risk)).toEqual({
        eddRequired: true, seniorManagerApprovalRequired: true,
      });
    }
  });

  it("domestic / international organisation PEPs require the controls only at high ML/TF risk", () => {
    expect(pepControlsRequired(det("domestic"), "low"))
      .toEqual({ eddRequired: false, seniorManagerApprovalRequired: false });
    expect(pepControlsRequired(det("domestic"), "high"))
      .toEqual({ eddRequired: true, seniorManagerApprovalRequired: true });
    expect(pepControlsRequired(det("international_organisation"), "prohibited"))
      .toEqual({ eddRequired: true, seniorManagerApprovalRequired: true });
  });

  it("family members and close associates carry the PEP's category", () => {
    expect(pepControlsRequired(
      { result: "pep", pep_type: "foreign", pep_relationship: "family_member" }, "low",
    )).toEqual({ eddRequired: true, seniorManagerApprovalRequired: true });
  });

  it("being a PEP is never an automatic rejection — not_pep and superseded determinations require nothing", () => {
    expect(pepControlsRequired({ result: "not_pep" }, "high"))
      .toEqual({ eddRequired: false, seniorManagerApprovalRequired: false });
    expect(pepControlsRequired(det("foreign", { superseded_at: "2026-01-01T00:00:00Z" }), "high"))
      .toEqual({ eddRequired: false, seniorManagerApprovalRequired: false });
    expect(pepControlsRequired(null, "high"))
      .toEqual({ eddRequired: false, seniorManagerApprovalRequired: false });
  });
});

describe("pepDeterminationCurrent — freshness for ongoing CDD", () => {
  const now = "2026-08-07T00:00:00.000Z";
  it("current when not superseded and not past review", () => {
    expect(pepDeterminationCurrent({ result: "not_pep", review_due_at: "2027-01-01T00:00:00Z" }, now)).toBe(true);
  });
  it("a lapsed review date makes it non-current — reconsidered, not assumed", () => {
    expect(pepDeterminationCurrent({ result: "not_pep", review_due_at: "2026-01-01T00:00:00Z" }, now)).toBe(false);
  });
  it("superseded determinations are never current", () => {
    expect(pepDeterminationCurrent({ result: "pep", superseded_at: "2026-06-01T00:00:00Z" }, now)).toBe(false);
    expect(pepDeterminationCurrent(null, now)).toBe(false);
  });
});

describe("pepDeterminationRequiredForRole — mirrors the program's identification roles", () => {
  it.each(["co_purchaser", "director", "trustee", "beneficial_owner", "authorised_representative"])(
    "%s requires a determination", (role) => {
      expect(pepDeterminationRequiredForRole(role)).toBe(true);
    });
  it("roles outside the identification list do not", () => {
    expect(pepDeterminationRequiredForRole("private_lender")).toBe(false);
    expect(pepDeterminationRequiredForRole("donor")).toBe(false);
  });
});
