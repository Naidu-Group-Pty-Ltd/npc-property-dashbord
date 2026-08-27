import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  LEGAL_ROUTE_CHOICES, PARTNER_PORTAL_CHOICES, PREBUILT_AGREEMENT_TITLE,
  builderOrgType, defaultPurpose, defaultReviewDate, grantReadiness, isValidEmail, isoDate,
  portalHasPrebuiltAgreement, prebuiltArrangementDraft,
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

describe("the prebuilt arrangement — portal sign-up carries it, so nobody types it", () => {
  it("every portal partner has the prebuilt agreement; a partner outside the portals does not", () => {
    for (const p of ["finance", "builder", "developer", "solicitor_conveyancer"]) {
      expect(portalHasPrebuiltAgreement(p), p).toBe(true);
    }
    expect(portalHasPrebuiltAgreement("other")).toBe(false);
  });

  it("the register row names the instrument and where its acknowledgement happens", () => {
    const draft = prebuiltArrangementDraft(new Date(2026, 7, 27));
    expect(draft.agreement_reference).toContain(PREBUILT_AGREEMENT_TITLE);
    expect(draft.agreement_reference).toContain("acknowledged at portal sign-up");
    // The server caps agreement_reference at 200 characters.
    expect(draft.agreement_reference.length).toBeLessThanOrEqual(200);
    expect(draft.executed_on).toBe("2026-08-27");
    expect(draft.next_review_due).toBe("2027-08-27");
  });

  it("the claim is CROSS-REFERENCED to the module sign-up enforces, not asserted here", () => {
    // The prebuilt agreement's mandatory acknowledgement IS the s 37A
    // arrangement statement, and portal sign-up refuses acceptance
    // without it — that is what lets onboarding skip the manual step.
    const signup = readFileSync("supabase/functions/_shared/portalAgreement.ts", "utf8");
    expect(signup).toContain("'binding_amlctf_arrangement'");
    expect(signup).toContain("section 37A of the AML/CTF Act");
    expect(signup).toContain("REQUIRED_TERMS_ACKNOWLEDGEMENTS");
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

  it("the invite email is validated before anything sends", () => {
    expect(isValidEmail("jordan@partner.com.au")).toBe(true);
    expect(isValidEmail("  jordan@partner.com.au  ")).toBe(true);
    for (const bad of ["", "jordan", "jordan@", "@partner.com", "a b@c.d"]) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });

  it("a developer partner is a developer ORGANISATION in the shared builder portal", () => {
    expect(builderOrgType("developer")).toBe("developer");
    expect(builderOrgType("builder")).toBe("builder");
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

  it("a portal partner never sees the arrangement step — the prebuilt draft is recorded instead", () => {
    expect(wizard).toContain('? ["partner", "link", "grant"]');
    expect(wizard).toContain(': ["partner", "arrangement", "link", "grant"]');
    expect(wizard).toContain("portalHasPrebuiltAgreement(portal)");
    expect(wizard).toContain("prebuiltArrangementDraft(");
    // The manual step names who it is for: a partner outside the portals.
    expect(wizard).toContain("A partner outside the portals has no sign-up to carry the prebuilt agreement");
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
    expect(wizard).toMatch(/no prior\s+sign-up is needed/i);
    // What the partner receives is procedures, never the risk assessment.
    expect(wizard).toMatch(/never this case(?:'|&apos;)s risk assessment/);
  });

  it("existing partners come from each portal's OWN registry — never re-created", () => {
    expect(wizard).toContain('from("finance_agent_contacts")');
    expect(wizard).toContain('"solicitor-portal-admin", { operation: "list_users" }');
    expect(wizard).toContain('"builder-portal-admin", { operation: "list_users" }');
    // Someone who already holds access is reported, never re-invited.
    expect(wizard).toContain('{ state: "already", email }');
  });

  it("the invite goes through each portal's existing pipeline — no parallel email path", () => {
    expect(wizard).toContain('"finance-portal-invite"');
    expect(wizard).toContain('"builder-portal-invite"');
    expect(wizard).toContain('"solicitor-portal-invite"');
    // Builder provisioning is the full chain the portal requires: an
    // organisation, its activation, the user and a membership — the invite
    // function refuses a user with no membership.
    for (const op of ['"upsert_organisation"', '"set_organisation_status"', '"create_user"', '"upsert_membership"']
      .map((s) => `operation: ${s}`)) {
      expect(wizard).toContain(op);
    }
  });

  it("a failed invite never blocks the grant, and only the invite is retried", () => {
    // The one-time token must not be lost to a bounced email — the grant
    // proceeds, the outcome is reported, and the retry re-runs the invite
    // alone (the grant is done and stays done).
    expect(wizard).toMatch(/failure never blocks the\s+\* grant|failure is reported and retryable, never fatal/);
    expect(wizard).toContain("The grant succeeded, but the portal invite");
    expect(wizard).toContain("Retry portal invite");
    expect(wizard).toContain("const retryInvite");
  });

  it("a portal partner needs a deliverable contact — validated before the pass starts", () => {
    expect(wizard).toContain("isValidEmail(contactEmail)");
    expect(wizard).toContain("Who receives portal access?");
  });

  it("consent is read from the case's own record and an unreadable answer stays unknown", () => {
    expect(wizard).toContain("amlCasesApi.consentStatus(");
    expect(wizard).toContain('d.code === "compliance_sharing"');
    expect(wizard).toMatch(/setSharingConsent\(null\)/);
  });
});
