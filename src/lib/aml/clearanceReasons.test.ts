import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { describeClearanceReason } from "./clearanceReasons.pure";

/**
 * Every blocker the server can name has words and a route — and the set is
 * pinned against the server's own source, so a new server code fails here
 * instead of rendering as a mystery.
 */

describe("each blocker has words, an action, and a route where one exists", () => {
  it("counts travel into the words", () => {
    expect(describeClearanceReason("3_open_conditions").label).toBe("3 open conditions on the case");
    expect(describeClearanceReason("1_party_screening_incomplete").label)
      .toBe("1 required party screening not yet run to completion");
    expect(describeClearanceReason("2_party_pep_determination_outstanding").label)
      .toBe("2 related parties without a current PEP determination");
  });

  it("screening-side blockers route to the screening section", () => {
    for (const code of [
      "pep_determination_outstanding", "case_screening_missing",
      "unadjudicated_screening_matches", "2_party_screening_unresolved",
      "pep_edd_outstanding", "pep_senior_manager_approval_outstanding",
    ]) {
      expect(describeClearanceReason(code).section).toBe("screening");
    }
  });

  it("risk-section blockers carry no route — the fix is on this screen", () => {
    for (const code of ["no_assessment", "2_open_conditions", "1_blocking_holds"]) {
      expect(describeClearanceReason(code).section).toBeNull();
    }
  });

  it("a mandatory trigger names itself", () => {
    const view = describeClearanceReason("authoritative_sanctions_hit");
    expect(view.label).toBe("Mandatory trigger: sanctions hit");
  });

  it("an unknown code still renders, crudely, with no route — never hidden", () => {
    const view = describeClearanceReason("some_future_blocker");
    expect(view.label).toBe("some future blocker");
    expect(view.section).toBeNull();
  });
});

describe("pinned against the server", () => {
  const src = readFileSync("supabase/functions/aml-risk/index.ts", "utf8");

  it("every reason code the server can push is described", () => {
    // Only the CLEARANCE vocabulary: the two functions the decide/gate
    // refusals and the readiness op read. The recalc-staleness codes in
    // this file are a different vocabulary for a different question.
    const start = src.indexOf("async function screeningCompletenessReasons");
    const end = src.indexOf("async function tenantCaseAccess");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const clearanceSrc = src.slice(start, end);
    const codes = new Set<string>();
    for (const m of clearanceSrc.matchAll(/reasons\.push\(\s*(?:`\$\{[^}]+\}_([a-z_]+)`|"([a-z_]+)")/g)) {
      codes.add(m[1] ?? m[2]);
    }
    // The scan must actually find the vocabulary — an empty set is a broken
    // regex, not a clean server.
    expect(codes.size).toBeGreaterThanOrEqual(9);
    for (const code of codes) {
      const view = describeClearanceReason(code);
      // Described, not the crude fallback: the fallback echoes the code's
      // own words and offers "Investigate".
      expect(view.action).not.toBe("Investigate this blocker");
    }
  });

  it("the readiness op reads the same computation the refusal enforces", () => {
    expect(src).toContain('op === "clearance_readiness"');
    // Three call sites of the one implementation: the decide refusal, the
    // gate approval check, straight-through eligibility — plus the read.
    expect((src.match(/await clearanceBlockReasons\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("the case subject's determination discharges the case-level requirement wherever it is recorded", () => {
    // Stage 5's dialog records against the primary subject's screening row;
    // demanding a NULL party_screening_subject_id refused clearance to a
    // case whose subject held a current not_pep determination.
    expect(src).toContain("primarySubjectRowIds");
    expect(src).toMatch(/!d\.party_screening_subject_id\s*\n?\s*\|\|\s*primarySubjectRowIds\.has/);
  });
});
