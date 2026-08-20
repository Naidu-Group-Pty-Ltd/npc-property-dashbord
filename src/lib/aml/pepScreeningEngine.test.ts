import { describe, expect, it } from "vitest";
import {
  SERVER_UNREACHABLE_SOURCES,
  buildScreeningRun,
  runIsEvidence,
  runToMethodDraft,
  type PepScreeningCandidate,
  type PepScreeningSourceResult,
} from "@/lib/aml/pepScreeningEngine";
import { PEP_SOURCE_KINDS } from "@/lib/aml/pepEvidence";

/**
 * The engine screens. It never determines.
 *
 * An automated search that finds nothing has established nothing about the
 * person: it searched some registers and not others, and it cannot see a
 * foreign office it does not hold, a family relationship nobody publishes, or
 * a name spelled differently in the source.
 */

const source = (over: Partial<PepScreeningSourceResult> = {}): PepScreeningSourceResult => ({
  key: "wikidata_au_public_office",
  label: "Australian public office holders",
  status: "searched",
  coverage: "offices whose jurisdiction is Australia",
  excludes: "family members and close associates",
  foundCount: 0,
  asAt: "2026-08-19",
  ...over,
});

const candidate = (over: Partial<PepScreeningCandidate> = {}): PepScreeningCandidate => ({
  id: "wikidata_au_public_office:Q42",
  sourceKey: "wikidata_au_public_office",
  name: "Pat Example",
  aliases: [],
  positionTitle: "member of the Australian Senate",
  jurisdiction: "Australia",
  positionStart: "2016-07-02",
  positionEnd: null,
  currentlyHeld: true,
  confirmUrl: "https://en.wikipedia.org/wiki/Pat_Example",
  score: 0.94,
  ...over,
});

const answered = { answered: true, answer: "no" as const, summary: "The customer said no." };

const run = (over: Parameters<typeof buildScreeningRun>[0] extends never ? never : Partial<{
  searchedNames: string[];
  sources: PepScreeningSourceResult[];
  candidates: PepScreeningCandidate[];
  sanctionsSignal: "none" | "candidate" | "confirmed";
  declaration: typeof answered | null;
}> = {}) => buildScreeningRun({
  searchedNames: ["Pat Example"],
  sources: [source()],
  candidates: [],
  sanctionsSignal: "none",
  declaration: answered,
  ...over,
});

/* ── The line, asserted ────────────────────────────────────────────────── */

describe("a screening verdict can never be read as a determination", () => {
  it("shares no value with the determination vocabulary", () => {
    // `pep_determinations.result` is `not_pep` | `pep`. If a verdict could
    // ever spell one of those, a search would become a conclusion by
    // vocabulary alone.
    const verdicts = new Set([
      run().verdict,
      run({ candidates: [candidate()] }).verdict,
      run({ sources: [source({ status: "unavailable" })] }).verdict,
      run({ searchedNames: [] }).verdict,
    ]);
    for (const v of verdicts) {
      expect(["not_pep", "pep"]).not.toContain(v);
      expect(v).not.toMatch(/clear|pass|clean|ok/i);
    }
  });

  it("no message anywhere asserts a clearance", () => {
    for (const r of [
      run(),
      run({ candidates: [candidate()] }),
      run({ sources: [source({ status: "unavailable" })] }),
      run({ sources: [source({ status: "failed" })] }),
      run({ searchedNames: [] }),
    ]) {
      expect(r.message).not.toMatch(/\bcleared\b|\bclearance\b/i);
      expect(r.message).not.toMatch(/\bis not a pep\b/i);
      expect(r.message).not.toMatch(/\bnot politically exposed\b/i);
    }
  });

  it("an empty result says it is about the SEARCH, not the person", () => {
    const r = run();
    expect(r.verdict).toBe("no_indicators");
    expect(r.message).toMatch(/about the search, not about the person/i);
    expect(r.message).toMatch(/does not clear anybody/i);
  });
});

/* ── Coverage travels ──────────────────────────────────────────────────── */

describe("what the run could not reach", () => {
  it("names every unreached source, and forces a manual review", () => {
    const r = run({
      sources: [source(), source({ key: "aph", label: "Parliament", status: "not_reachable" })],
    });
    expect(r.notReached).toContain("Parliament");
    expect(r.requiresManualReview).toBe(true);
  });

  it("a register that FAILED is not a register that was empty", () => {
    const r = run({ sources: [source({ status: "failed" })] });
    // Nothing was searched, so the run is incomplete rather than empty.
    expect(r.verdict).toBe("incomplete");
    expect(r.message).toMatch(/nothing was checked/i);
  });

  it("a run that searched nothing never reports no_indicators", () => {
    for (const status of ["unavailable", "failed", "not_reachable"] as const) {
      expect(run({ sources: [source({ status })] }).verdict).toBe("incomplete");
    }
  });

  it("with nothing unreached and nothing found, no manual review is forced", () => {
    // The one case where the engine does not insist — every source it names
    // was searched and the customer answered.
    const r = run({ sources: [source()], declaration: answered });
    expect(r.notReached).toEqual([]);
    expect(r.requiresManualReview).toBe(false);
  });

  it("a party with no searchable name is its own reading", () => {
    const r = run({ searchedNames: [] });
    expect(r.verdict).toBe("not_searchable");
    expect(r.candidates).toEqual([]);
    expect(r.requiresManualReview).toBe(true);
  });
});

/* ── Indicators ────────────────────────────────────────────────────────── */

describe("indicators are leads, never findings", () => {
  it("a candidate becomes a possible_match that says to confirm it", () => {
    const r = run({ candidates: [candidate()] });
    expect(r.verdict).toBe("indicators_found");
    const ind = r.indicators.find((i) => i.kind === "possible_match");
    expect(ind?.detail).toMatch(/confirm against the official register/i);
    expect(ind?.candidateId).toBe(candidate().id);
  });

  it("a confirmed sanctions match is a signal in one direction only", () => {
    const r = run({ sanctionsSignal: "confirmed" });
    const ind = r.indicators.find((i) => i.kind === "sanctions_signal");
    expect(ind?.detail).toMatch(/not itself the determination/i);
  });

  it("a clear sanctions result says nothing at all", () => {
    // "Screened, no match" carries no information about political exposure.
    expect(run({ sanctionsSignal: "none" }).indicators
      .some((i) => i.kind === "sanctions_signal")).toBe(false);
  });

  it("an unanswered declaration is a COVERAGE GAP, not a no", () => {
    const r = run({ declaration: null });
    const ind = r.indicators.find((i) => i.key === "declaration:unanswered");
    expect(ind?.kind).toBe("coverage_gap");
    expect(ind?.detail).toMatch(/is not a declaration that they are not/i);
    expect(r.requiresManualReview).toBe(true);
  });

  it("a declared yes is an indicator to consider", () => {
    const r = run({ declaration: { answered: true, answer: "yes", summary: "Held office." } });
    expect(r.verdict).toBe("indicators_found");
    expect(r.indicators.some((i) => i.kind === "declaration")).toBe(true);
  });
});

/* ── The run as evidence ───────────────────────────────────────────────── */

describe("a run becomes a source row, and only when it searched something", () => {
  it("a run that searched nothing is not evidence", () => {
    expect(runIsEvidence(run({ sources: [source({ status: "failed" })] }))).toBe(false);
    expect(runIsEvidence(run({ searchedNames: [] }))).toBe(false);
  });

  it("a completed run is evidence, and names the registers it read", () => {
    const r = run();
    expect(runIsEvidence(r)).toBe(true);
    const draft = runToMethodDraft(r);
    expect(draft.source).toContain("Australian public office holders");
    expect(draft.reference).toBe("Pat Example");
    expect(draft.result).toMatch(/no entry returned/i);
    // A source kind the evidence contract actually accepts.
    expect(PEP_SOURCE_KINDS).toContain(draft.kind as never);
  });

  it("the drafted result states what came back, never a conclusion", () => {
    const draft = runToMethodDraft(run({ candidates: [candidate()] }));
    expect(draft.result).toMatch(/possible match/i);
    expect(draft.result).not.toMatch(/not a pep|cleared/i);
  });

  it("only the searched registers are named in the source row", () => {
    // Naming a register that was never read would put a line in the record
    // that reads exactly like a check.
    const draft = runToMethodDraft(run({
      sources: [source(), source({ key: "x", label: "Unread register", status: "unavailable" })],
    }));
    expect(draft.source).not.toContain("Unread register");
  });
});

describe("the sources a server cannot reach", () => {
  it("are declared, with what they hold and why they were not searched", () => {
    expect(SERVER_UNREACHABLE_SOURCES.length).toBeGreaterThan(0);
    for (const s of SERVER_UNREACHABLE_SOURCES) {
      expect(s.coverage.length).toBeGreaterThan(10);
      expect(s.excludes.length).toBeGreaterThan(10);
      expect(s.detail).toMatch(/blocks automated requests/i);
    }
  });
});
