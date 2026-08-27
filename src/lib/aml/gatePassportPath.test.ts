import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  gatePassportComplete, gatePassportPath, type GatePassportFacts,
} from "./gatePassportPath.pure";

/**
 * Stage 9's order. Pinned: the Stage 8 outcome pulls through as step 1;
 * the gate step directs to where it is decided; preview is "anytime" and
 * never gates; issuance follows the SERVER's passport code and an
 * unavailable reading is never "not issued"; and the stage's buttons are
 * wired at the source.
 */

const facts = (over: Partial<GatePassportFacts> = {}): GatePassportFacts => ({
  decisionOutcome: "cleared",
  gateStatus: "under_review",
  passportState: "not_issued",
  passportVersion: null,
  canReview: true,
  ...over,
});

const byKey = (steps: ReturnType<typeof gatePassportPath>, key: string) =>
  steps.find((s) => s.key === key)!;

describe("the Stage 8 outcome pulls through", () => {
  it("a cleared case says so as step 1 — the fact the stage used to keep silent", () => {
    const s = byKey(gatePassportPath(facts()), "decision");
    expect(s.state).toBe("done");
    expect(s.detail).toBe("Cleared — recorded on the Decision stage.");
  });

  it("no decision yet makes step 1 the current step, routed to Stage 8", () => {
    const s = byKey(gatePassportPath(facts({ decisionOutcome: null })), "decision");
    expect(s.state).toBe("current");
    expect(s.detail).toMatch(/Decision stage first/);
  });

  it("a blocked case blocks the path and names it", () => {
    const steps = gatePassportPath(facts({ decisionOutcome: "blocked" }));
    expect(byKey(steps, "decision").state).toBe("blocked");
    expect(byKey(steps, "decision").blockedBy).toBe("The case is blocked");
    expect(byKey(steps, "gate").state).toBe("outstanding");
  });
});

describe("the gate step directs", () => {
  it("cleared + unapproved gate: current for a reviewer, with the route named", () => {
    const s = byKey(gatePassportPath(facts()), "gate");
    expect(s.state).toBe("current");
    expect(s.detail).toMatch(/approve the gate on the Decision stage/);
  });

  it("blocked-with-blocker for an operator who cannot review", () => {
    const s = byKey(gatePassportPath(facts({ canReview: false })), "gate");
    expect(s.state).toBe("blocked");
    expect(s.blockedBy).toBe("Requires a reviewer or the MLRO");
  });

  it("an approved gate is done, in the gate's own words", () => {
    const s = byKey(gatePassportPath(facts({ gateStatus: "approved_with_controls" })), "gate");
    expect(s.state).toBe("done");
    expect(s.detail).toMatch(/approved with controls — the designated service may proceed/);
  });
});

describe("preview never gates; issuance follows the server's code", () => {
  it("preview is anytime — a look, not a step owed", () => {
    const s = byKey(gatePassportPath(facts()), "preview");
    expect(s.state).toBe("anytime");
    expect(s.detail).toMatch(/exactly as the client and partners will see it/);
  });

  it("ready_for_issuance is the current step whatever the gate column says", () => {
    const s = byKey(gatePassportPath(facts({ passportState: "ready_for_issuance" })), "issue");
    expect(s.state).toBe("current");
    expect(s.detail).toMatch(/authorised decision-maker issues it/);
  });

  it("issued_current completes the path", () => {
    const steps = gatePassportPath(facts({
      gateStatus: "approved", passportState: "issued_current", passportVersion: 3,
    }));
    expect(byKey(steps, "issue").detail).toMatch(/v3 is in force/);
    expect(gatePassportComplete(steps)).toBe(true);
  });

  it("an unavailable passport reading is never read as not issued", () => {
    const s = byKey(gatePassportPath(facts({ passportState: null, gateStatus: "approved" })), "issue");
    expect(s.state).toBe("outstanding");
    expect(s.detail).toMatch(/could not be read/);
  });

  it("refresh_required and superseded call for a reissue", () => {
    for (const code of ["refresh_required", "superseded"]) {
      const s = byKey(gatePassportPath(facts({ passportState: code })), "issue");
      expect(s.state).toBe("current");
      expect(s.detail).toMatch(/newer version is needed/);
    }
  });
});

describe("wired at the source", () => {
  const journey = readFileSync("src/lib/aml/journeyModel.ts", "utf8");
  const workspace = readFileSync("src/pages/aml/AmlCaseWorkspace.tsx", "utf8");
  const passports = readFileSync("src/pages/aml/AmlPassports.tsx", "utf8");

  it("the stage's primary button carries a type the workspace handles", () => {
    expect(journey).toContain('actionType: "record_gate"');
    expect(workspace).toContain('case "record_gate":');
    expect(workspace).toContain('"decision-step-gate"');
  });

  it("preview deep-links the passport hub to THIS case, and the hub honours it", () => {
    expect(workspace).toContain("/admin/aml/passport?case=${caseRow.id}");
    expect(passports).toContain('searchParams.get("case")');
    // An unknown id falls back to the first row, never a blank selection.
    expect(passports).toMatch(/some\(\(r\) => r\.id === requestedCaseId\)/);
  });

  it("the issue step lands on the reliance panel where issuance lives", () => {
    expect(workspace).toContain('id="aml-passport-issue"');
    expect(workspace).toContain('getElementById("aml-passport-issue")');
  });
});
