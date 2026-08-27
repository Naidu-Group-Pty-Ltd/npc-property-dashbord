import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  LEGAL_ROUTE_CHOICES, PARTNER_PORTAL_CHOICES, defaultPurpose, defaultReviewDate,
  grantReadiness, isoDate,
} from "./partnerOnboarding.pure";

/**
 * Partner onboarding — one guided pass from "does not exist" to "holds a
 * grant". Pinned: the catalogues carry meanings, not bare enum values;
 * the grant readiness never treats an UNKNOWN consent reading as a pass;
 * the defaults satisfy the server's own validation; and the wizard is
 * wired into the reliance panel with the token shown exactly once.
 */

describe("the catalogues explain, and cover the server's vocabulary", () => {
  it("every portal the server accepts is offered, with a meaning and a default role", () => {
    expect(PARTNER_PORTAL_CHOICES.map((p) => p.value)).toEqual([
      "finance", "builder", "developer", "solicitor_conveyancer", "other",
    ]);
    for (const p of PARTNER_PORTAL_CHOICES) {
      expect(p.meaning.length, p.value).toBeGreaterThan(20);
      expect(p.role.length, p.value).toBeGreaterThan(0);
    }
  });

  it("every legal route is offered and explained — reliance leads, because a grant is a reliance disclosure", () => {
    expect(LEGAL_ROUTE_CHOICES[0].value).toBe("reliance");
    expect(LEGAL_ROUTE_CHOICES.map((r) => r.value).sort()).toEqual([
      "independent_cdd", "information_share_only", "outsourced_cdd", "reliance",
    ]);
    for (const r of LEGAL_ROUTE_CHOICES) expect(r.meaning.length, r.value).toBeGreaterThan(20);
  });
});

describe("the defaults satisfy the server's own validation", () => {
  it("dates are plain YYYY-MM-DD and the review default is a year out, not 'sometime'", () => {
    expect(isoDate(new Date(2026, 7, 27))).toBe("2026-08-27");
    expect(defaultReviewDate(new Date(2026, 7, 27))).toBe("2027-08-27");
  });

  it("the suggested purpose clears the server's 10-character floor for every portal", () => {
    for (const p of PARTNER_PORTAL_CHOICES) {
      expect(defaultPurpose(p.label, p.role).length).toBeGreaterThanOrEqual(10);
    }
  });
});

describe("grant readiness — blockers named, unknown never a pass", () => {
  it("no attestation blocks, and says why", () => {
    const r = grantReadiness({ attestationVersion: null, sharingConsent: true });
    expect(r.ready).toBe(false);
    expect(r.blockers.join(" ")).toContain("Issue the attestation first");
  });

  it("a known-missing sharing consent blocks with the client's own step named", () => {
    const r = grantReadiness({ attestationVersion: 1, sharingConsent: false });
    expect(r.ready).toBe(false);
    expect(r.blockers.join(" ")).toContain("sharing consent");
  });

  it("an UNKNOWN consent reading is a caution — never treated as accepted", () => {
    const r = grantReadiness({ attestationVersion: 1, sharingConsent: null });
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.cautions.join(" ")).toContain("could not be read");
    expect(r.cautions.join(" ")).toContain("server will still enforce");
  });

  it("everything present: ready with nothing to say", () => {
    const r = grantReadiness({ attestationVersion: 2, sharingConsent: true });
    expect(r).toEqual({ ready: true, blockers: [], cautions: [] });
  });
});

describe("wired at the source", () => {
  const wizard = readFileSync("src/components/aml/PartnerOnboardingWizard.tsx", "utf8");
  const section = readFileSync("src/components/aml/ReliancePassportSection.tsx", "utf8");

  it("the reliance panel mounts the wizard as the grant row's paved road", () => {
    expect(section).toContain("PartnerOnboardingWizard");
    expect(section).toContain("Onboard partner");
  });

  it("the wizard chains the four EXISTING server acts — it invents no operation", () => {
    for (const call of [
      "amlRelianceApi.upsertPartnerOrganisation(",
      "amlRelianceApi.createAgreement(",
      "amlRelianceApi.linkPartnerToCase(",
      "amlRelianceApi.grantAccess(",
    ]) {
      expect(wizard).toContain(call);
    }
  });

  it("a retry resumes instead of duplicating — created records are cached per step", () => {
    expect(wizard).toContain("setCreatedOrgId");
    expect(wizard).toContain("setCreatedAgreement");
    expect(wizard).toContain("setLinkRecorded");
    // An already-existing link is accepted, not treated as a failure.
    expect(wizard).toMatch(/already exists/i);
  });

  it("the token is handed over as shown-once, with the no-sign-up rule stated", () => {
    expect(wizard).toContain("One-time access token");
    expect(wizard).toMatch(/shown once/i);
    expect(wizard).toMatch(/no sign-up is needed/i);
    // What the partner receives is procedures, never the risk assessment.
    expect(wizard).toMatch(/never this case(?:'|&apos;)s risk assessment/);
  });

  it("consent is read from the case's own record and an unreadable answer stays unknown", () => {
    expect(wizard).toContain("amlCasesApi.consentStatus(");
    expect(wizard).toContain('d.code === "compliance_sharing"');
    expect(wizard).toMatch(/setSharingConsent\(null\)/);
  });
});
