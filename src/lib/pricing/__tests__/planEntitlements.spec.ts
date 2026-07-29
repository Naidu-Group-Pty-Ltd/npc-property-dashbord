import { describe, expect, it } from "vitest";
import {
  MODULE_TIERS,
  MODULE_KEY_TO_PRICING_SLUG,
  SUB_MODULE_ENTITLEMENTS,
  enabledSubModules,
  isKnownPlan,
  planEnablesSubModule,
  planIncludesModule,
} from "../planEntitlements";
import { annualCents, exGstCents, gstComponentCents } from "../gst";

describe("gating fails OPEN, never closed", () => {
  // This is the single most important property here. Denying on an unknown
  // plan would lock paying customers out of features they have bought, over a
  // lookup that was merely slow or failed. Showing a feature to someone whose
  // plan we could not read is the far cheaper mistake.
  it("enables everything when the plan is unknown, null or still loading", () => {
    for (const plan of [null, undefined, "", "enterprise", "some-future-tier"]) {
      expect(planEnablesSubModule(plan, "clients.borrowing-capacity")).toBe(true);
      expect(planIncludesModule(plan, "finance-portal")).toBe(true);
    }
  });

  it("enables anything the matrix does not describe", () => {
    // A sub-module nobody has priced is not a gated sub-module.
    expect(planEnablesSubModule("launch", "something.unlisted")).toBe(true);
    expect(planIncludesModule("launch", "not-a-module")).toBe(true);
  });

  it("recognises only the three tiers it actually describes", () => {
    expect(isKnownPlan("launch")).toBe(true);
    expect(isKnownPlan("scale")).toBe(true);
    expect(isKnownPlan("enterprise")).toBe(false);
    expect(isKnownPlan(null)).toBe(false);
  });
});

describe("plan gating matches the signed-off sheet", () => {
  it("holds comparisons back from Launch and opens them at Growth", () => {
    expect(planEnablesSubModule("launch", "generated-reports.comparisons")).toBe(false);
    expect(planEnablesSubModule("growth", "generated-reports.comparisons")).toBe(true);
    expect(planEnablesSubModule("launch", "cash-flow-analysis.comparisons")).toBe(false);
    expect(planEnablesSubModule("growth", "cash-flow-analysis.comparisons")).toBe(true);
  });

  it("keeps the finance and portfolio work for Scale", () => {
    for (const key of [
      "clients.borrowing-capacity",
      "clients.portfolio-analysis",
      "clients.send-to-finance",
      "clients.finance-messages",
      "clients.ai",
    ]) {
      expect(planEnablesSubModule("growth", key)).toBe(false);
      expect(planEnablesSubModule("scale", key)).toBe(true);
    }
  });

  it("leaves Emails and Lenders off on every tier", () => {
    // Emails needs the Email Copilot module; Lenders is still in development.
    for (const plan of ["launch", "growth", "scale"]) {
      expect(planEnablesSubModule(plan, "clients.emails")).toBe(false);
      expect(planEnablesSubModule(plan, "clients.lenders")).toBe(false);
    }
  });

  it("never revokes on upgrade", () => {
    for (const row of SUB_MODULE_ENTITLEMENTS) {
      if (row.launch) expect(row.growth).toBe(true);
      if (row.growth) expect(row.scale).toBe(true);
    }
  });

  it("grows monotonically", () => {
    expect(enabledSubModules("launch")).toHaveLength(20);
    expect(enabledSubModules("growth")).toHaveLength(23);
    expect(enabledSubModules("scale")).toHaveLength(32);
  });
});

describe("module inclusion by tier", () => {
  it("covers all 23 priced modules", () => {
    expect(Object.keys(MODULE_TIERS)).toHaveLength(23);
  });

  it("includes Deal Pipeline and Market Updates from Growth up", () => {
    expect(planIncludesModule("launch", "deal-pipeline")).toBe(false);
    expect(planIncludesModule("growth", "deal-pipeline")).toBe(true);
    expect(planIncludesModule("launch", "market-updates")).toBe(false);
    expect(planIncludesModule("scale", "market-updates")).toBe(true);
  });

  it("does not withhold AML/CTF, which every tier's headline price pays for", () => {
    // This assertion used to be the other way round, on the reasoning that
    // AML/CTF is the $195 separating a tier's two prices so a tier does not
    // buy it. The price list settled that question the other way: every tier
    // is titled with its WITH-AML figure — $699, $1,055, $2,210 — and that is
    // the amount Stripe charges. The without-AML figures are the documented
    // alternative, not the default.
    //
    // So a workspace on Launch has paid for compliance, and a gate that denied
    // it would withhold a module they are being billed for.
    for (const plan of ["launch", "growth", "scale"]) {
      expect(planIncludesModule(plan, "aml-ctf")).toBe(true);
    }
  });

  it("treats Client Forms as included everywhere, per the tier matrix", () => {
    for (const plan of ["launch", "growth", "scale"]) {
      expect(planIncludesModule(plan, "client-forms")).toBe(true);
    }
  });
});

describe("GST is contained in the price, not added to it", () => {
  it("splits a tax-inclusive total", () => {
    expect(gstComponentCents(69900)).toBe(6355);
    expect(exGstCents(69900)).toBe(63545);
  });

  it("always reconciles", () => {
    for (const cents of [4900, 5900, 50400, 86000, 201500, 1, 0]) {
      expect(exGstCents(cents) + gstComponentCents(cents)).toBe(cents);
    }
  });

  it("discounts twelve months by 10% for annual", () => {
    expect(annualCents(50400)).toBe(544320);
    expect(annualCents(201500)).toBe(2176200);
  });
});

describe("a module no tier includes requires a separate add-on entitlement", () => {
  const ADD_ONS = [
    "intelligence-hub",
    "email-copilot",
    "call-logs",
    "lenders",
    "integrations",
    "aurixa-agent",
  ];

  it("lists exactly the modules that belong to no tier", () => {
    const empty = Object.entries(MODULE_TIERS)
      .filter(([, tiers]) => tiers.length === 0)
      .map(([slug]) => slug)
      .sort();
    expect(empty).toEqual([...ADD_ONS].sort());
  });

  it("does not treat them as included in a known plan", () => {
    for (const slug of ADD_ONS) {
      for (const plan of ["launch", "growth", "scale"]) {
        expect(planIncludesModule(plan, slug)).toBe(false);
      }
    }
  });

  it("still gates a module that genuinely belongs to some tiers", () => {
    // The fix must not turn the gate off wholesale.
    expect(planIncludesModule("launch", "agreements")).toBe(false);
    expect(planIncludesModule("scale", "agreements")).toBe(true);
    expect(planIncludesModule("launch", "deal-pipeline")).toBe(false);
    expect(planIncludesModule("growth", "deal-pipeline")).toBe(true);
  });
});

describe("app permission keys reach their pricing entitlements", () => {
  it("maps every differently-spelled app key to a priced module", () => {
    for (const pricingSlug of Object.values(MODULE_KEY_TO_PRICING_SLUG)) {
      expect(MODULE_TIERS[pricingSlug]).toBeDefined();
    }
  });

  it("withholds tier-restricted modules when called with app keys", () => {
    expect(planIncludesModule("launch", "deal_pipeline")).toBe(false);
    expect(planIncludesModule("launch", "portfolio_reports")).toBe(false);
    expect(planIncludesModule("growth", "portfolio_reports")).toBe(false);
    expect(planIncludesModule("launch", "marketing_analytics")).toBe(false);
    expect(planIncludesModule("growth", "marketing_analytics")).toBe(false);
    expect(planIncludesModule("growth", "api_usage")).toBe(false);
  });

  it("preserves access once the mapped module is included", () => {
    expect(planIncludesModule("growth", "deal_pipeline")).toBe(true);
    expect(planIncludesModule("scale", "portfolio_reports")).toBe(true);
    expect(planIncludesModule("scale", "marketing_analytics")).toBe(true);
    expect(planIncludesModule("scale", "api_usage")).toBe(true);
  });
});
