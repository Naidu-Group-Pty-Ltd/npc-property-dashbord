/**
 * Conditional screening scope — and the one thing it must never do.
 *
 * The request was to skip Stage 5 when the client's answers say PEP and
 * adverse-media screening are not required. The scoping half is implemented;
 * skipping the STAGE is not, because Stage 5 is "PEP · Sanctions · Adverse
 * media" and **sanctions screening is not risk-based**. No answer, rating or
 * profile removes it.
 *
 * The first describe block is the compliance invariant. If it ever fails,
 * the change that made it fail is wrong, not the test.
 */
import { describe, expect, it } from "vitest";

import {
  MANDATORY_SCREENING_SCOPES,
  WAIVABLE_SCREENING_SCOPES,
  deriveAmlScreeningScope,
  describeScreeningStage,
  type AmlScreeningScopeFacts,
} from "./screeningScope";

const clear = (over: Partial<AmlScreeningScopeFacts> = {}): AmlScreeningScopeFacts => ({
  answers: { pep: "no", adverse: "no", thirdParty: "no", overseasFunding: "no" },
  entityType: "individual",
  subjectType: "individual",
  riskRating: "low",
  enhancedDueDiligence: false,
  ...over,
});

describe("sanctions screening can never be waived", () => {
  it("is not even in the waivable set", () => {
    expect(WAIVABLE_SCREENING_SCOPES).not.toContain("sanctions");
    expect(MANDATORY_SCREENING_SCOPES).toContain("sanctions");
  });

  it("survives every combination of answers and risk", () => {
    const answers = ["yes", "no", null, undefined] as const;
    for (const pep of answers) {
      for (const adverse of answers) {
        for (const risk of ["low", "medium", "high", "prohibited", null]) {
          for (const entityType of ["individual", "company", "trust", null]) {
            const d = deriveAmlScreeningScope({
              answers: { pep, adverse }, riskRating: risk, entityType,
            });
            expect(d.required, `pep=${pep} adverse=${adverse} risk=${risk} entity=${entityType}`)
              .toContain("sanctions");
            expect(d.waived.map((w) => w.scope)).not.toContain("sanctions");
          }
        }
      }
    }
  });

  it("never reports a narrowed case as needing no screening", () => {
    const d = deriveAmlScreeningScope(clear());
    expect(d.narrowed).toBe(true);
    expect(d.required).toEqual(["sanctions"]);
    // The wording must not read as "screening not required".
    expect(d.summary).toMatch(/applies to every customer and still runs/i);
  });
});

describe("absence is never a negative answer", () => {
  it("requires everything when the questionnaire was not read", () => {
    for (const f of [null, undefined, { answers: null }]) {
      const d = deriveAmlScreeningScope(f as AmlScreeningScopeFacts);
      expect(d.undetermined).toBe(true);
      expect(d.narrowed).toBe(false);
      expect(d.required).toEqual(["sanctions", "pep", "adverse_media"]);
    }
  });

  it("requires everything when either answer is missing", () => {
    // "The client did not say they were a PEP" and "the client said they are
    // not" are different facts, and only the second is evidence.
    for (const answers of [
      { pep: "no" }, { adverse: "no" }, { pep: null, adverse: "no" }, {},
    ] as const) {
      const d = deriveAmlScreeningScope(clear({ answers }));
      expect(d.undetermined).toBe(true);
      expect(d.waived).toHaveLength(0);
    }
  });
});

describe("narrowing, when the client's answers genuinely support it", () => {
  it("waives PEP and adverse media, each with a written basis", () => {
    const d = deriveAmlScreeningScope(clear());
    expect(d.waived.map((w) => w.scope).sort()).toEqual(["adverse_media", "pep"]);
    for (const w of d.waived) {
      // A basis an auditor can read, not a code.
      expect(w.basis.length).toBeGreaterThan(40);
      expect(w.basis).toMatch(/declared/i);
    }
    expect(d.undetermined).toBe(false);
  });

  it("waives only the one the client cleared", () => {
    const pepOnly = deriveAmlScreeningScope(clear({
      answers: { pep: "yes", adverse: "no", thirdParty: "no", overseasFunding: "no" },
    }));
    expect(pepOnly.required).toContain("pep");
    expect(pepOnly.waived.map((w) => w.scope)).toEqual(["adverse_media"]);

    const adverseOnly = deriveAmlScreeningScope(clear({
      answers: { pep: "no", adverse: "yes", thirdParty: "no", overseasFunding: "no" },
    }));
    expect(adverseOnly.required).toContain("adverse_media");
    expect(adverseOnly.waived.map((w) => w.scope)).toEqual(["pep"]);
  });
});

describe("risk indicators override the client's own answers", () => {
  const cases: Array<[string, Partial<AmlScreeningScopeFacts>, RegExp]> = [
    ["high risk", { riskRating: "high" }, /high risk/],
    ["prohibited risk", { riskRating: "prohibited" }, /prohibited risk/],
    ["enhanced due diligence", { enhancedDueDiligence: true }, /enhanced due diligence/],
    ["a company customer", { entityType: "company" }, /company rather than an individual/],
    ["a trust customer", { entityType: "trust" }, /trust rather than an individual/],
    ["overseas funding", {
      answers: { pep: "no", adverse: "no", overseasFunding: "yes", thirdParty: "no" },
    }, /overseas/],
    ["a third party", {
      answers: { pep: "no", adverse: "no", overseasFunding: "no", thirdParty: "yes" },
    }, /third party/],
  ];

  it.each(cases)("keeps the full scope for %s", (_name, over, reason) => {
    const d = deriveAmlScreeningScope(clear(over));
    expect(d.narrowed).toBe(false);
    expect(d.waived).toHaveLength(0);
    expect(d.required).toEqual(["sanctions", "pep", "adverse_media"]);
    expect(d.summary).toMatch(reason);
  });

  it("names every reason, not just the first", () => {
    const d = deriveAmlScreeningScope(clear({ riskRating: "high", enhancedDueDiligence: true }));
    expect(d.summary).toMatch(/high risk/);
    expect(d.summary).toMatch(/enhanced due diligence/);
  });
});

describe("a narrowed scope is not permission to skip a blocked stage", () => {
  const notReady = {
    code: "simulator_mode" as const, label: "Screening is not configured",
    detail: "…", canRun: false, blockers: ["x"], owner: "administrator" as const,
  };
  const ready = {
    code: "ready" as const, label: "Ready to screen", detail: "…",
    canRun: true, blockers: [], owner: "none" as const,
  };

  it("never says 'not required' while sanctions still cannot run", () => {
    // The trap: a narrowed case whose provider is unconfigured is still
    // blocked, and saying "screening not required" there would be false.
    const d = describeScreeningStage(deriveAmlScreeningScope(clear()), notReady);
    expect(d.canProceed).toBe(false);
    expect(d.headline).toMatch(/cannot run/i);
    expect(d.detail).toMatch(/Sanctions screening is still required/i);
  });

  it("reports a reduced scope once the provider is ready", () => {
    const d = describeScreeningStage(deriveAmlScreeningScope(clear()), ready);
    expect(d.canProceed).toBe(true);
    expect(d.headline).toBe("Reduced screening scope");
  });

  it("reports the full scope when nothing was narrowed", () => {
    const d = describeScreeningStage(
      deriveAmlScreeningScope(clear({ riskRating: "high" })), ready);
    expect(d.headline).toBe("Screening required");
  });
});
