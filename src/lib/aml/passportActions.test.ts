import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { passportActions, type PassportActionFacts } from "./passportActions.pure";

/**
 * The Passport's acts, explained. Pinned: a blocked act names its enabler
 * BEFORE the click (production held zero arrangements, so "Grant access"
 * refused every click with a toast that read as a broken button); order and
 * meaning are stated; availability is never a compliance claim; and issuing
 * confirms with the preview one click away.
 */

const facts = (over: Partial<PassportActionFacts> = {}): PassportActionFacts => ({
  attestationVersion: null,
  issuedAt: null,
  passportStateCode: null,
  activeAgreements: 0,
  activeGrants: 0,
  isMlro: true,
  ...over,
});

const byKey = (rows: ReturnType<typeof passportActions>, key: string) =>
  rows.find((r) => r.key === key)!;

describe("a blocked act names its enabler before the click", () => {
  it("grant with nothing issued: issue first", () => {
    const r = byKey(passportActions(facts()), "grant");
    expect(r.state).toBe("blocked");
    expect(r.blockedBy).toBe("Issue the attestation first");
  });

  it("grant with an attestation but no arrangement: record the arrangement first", () => {
    const r = byKey(passportActions(facts({ attestationVersion: 1 })), "grant");
    expect(r.state).toBe("blocked");
    expect(r.blockedBy).toBe("Record a written arrangement first");
  });

  it("grant with both prerequisites: ready", () => {
    const r = byKey(passportActions(facts({ attestationVersion: 1, activeAgreements: 1 })), "grant");
    expect(r.state).toBe("ready");
    expect(r.blockedBy).toBeNull();
  });

  it("every MLRO act names the role for a non-MLRO instead of hiding", () => {
    const rows = passportActions(facts({ isMlro: false, attestationVersion: 1, activeAgreements: 1 }));
    for (const key of ["issue", "arrangement", "grant", "material"]) {
      expect(byKey(rows, key).blockedBy, key).toBe("Requires the MLRO");
    }
    // The preview is everybody's.
    expect(byKey(rows, "preview").state).toBe("anytime");
  });
});

describe("issuance states follow the record, and only the record", () => {
  it("nothing issued yet: issuing creates v1", () => {
    const r = byKey(passportActions(facts()), "issue");
    expect(r.state).toBe("ready");
    expect(r.detail).toContain("issuing creates v1");
  });

  it("a refresh-flagged version calls for its successor by number", () => {
    const r = byKey(passportActions(facts({
      attestationVersion: 2, passportStateCode: "refresh_required",
    })), "issue");
    expect(r.state).toBe("ready");
    expect(r.detail).toContain("v2 is flagged for refresh");
    expect(r.detail).toContain("issuing v3 supersedes it");
  });

  it("a current version reads as done — and still reissuable", () => {
    const r = byKey(passportActions(facts({
      attestationVersion: 1, issuedAt: "2026-08-27T00:00:00Z", passportStateCode: "issued_current",
    })), "issue");
    expect(r.state).toBe("done");
    expect(r.detail).toContain("v1 is in force");
  });

  it("an unavailable passport reading is never treated as a refresh flag", () => {
    const r = byKey(passportActions(facts({ attestationVersion: 1, passportStateCode: null })), "issue");
    expect(r.state).toBe("done");
  });

  it("material change is blocked until something is attested, and names it", () => {
    const r = byKey(passportActions(facts()), "material");
    expect(r.state).toBe("blocked");
    expect(r.blockedBy).toBe("Issue the attestation first");
  });
});

describe("availability is never a compliance claim", () => {
  it("no row's vocabulary can be read as a clearance", () => {
    const everything = passportActions(facts({ attestationVersion: 3, activeAgreements: 2, activeGrants: 1 }))
      .flatMap((r) => [r.label, r.meaning, r.detail, r.blockedBy ?? ""]).join(" ");
    expect(everything).not.toMatch(/\bcompliant\b/i);
    expect(everything).not.toMatch(/\bcleared\b/i);
    // Sharing shows what was performed, never the assessment.
    expect(everything).toContain("never this case's risk assessment");
  });

  it("issuing alone shares nothing, and the row says so", () => {
    expect(byKey(passportActions(facts()), "issue").meaning)
      .toContain("Nothing is shared by issuing alone");
  });
});

describe("wired at the source", () => {
  const section = readFileSync("src/components/aml/ReliancePassportSection.tsx", "utf8");

  it("the section renders the explained rows, not bare header buttons", () => {
    expect(section).toContain("passportActions(");
    expect(section).toContain('aria-label="Passport actions, in order"');
  });

  it("issuing confirms, with the visual preview one click away", () => {
    expect(section).toContain("Issue attestation v{nextVersion}?");
    expect(section).toContain("Preview first");
    expect(section).toContain("/admin/aml/passport?case=${caseId}");
  });

  it("the passport state code is the server's; a failed read stays null", () => {
    expect(section).toContain("getPassportDistributionStatus");
    expect(section).toContain("setPassportStateCode(null)");
  });
});
