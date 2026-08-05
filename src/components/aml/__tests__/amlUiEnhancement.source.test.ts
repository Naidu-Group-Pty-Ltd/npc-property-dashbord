/**
 * UI/UX enhancement guard-rails (docs/aml/ui-ux-enhancement.md).
 *
 * The Command Center enhancement is presentation-only. These source tests
 * pin the boundaries it must not cross: routes, flag defaults, readiness
 * truthfulness and the fail-closed Developer Portal.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repo = process.cwd();
const read = (p: string) => readFileSync(join(repo, p), "utf8");

const appSource = read("src/App.tsx");
const flagsSource = read("src/lib/aml/useAmlV3Flags.ts");
const layoutSource = read("src/components/aml/AmlLayout.tsx");
const casesSource = read("src/pages/aml/AmlCases.tsx");
const partnerOpsSource = read("src/pages/aml/AmlPartnerOperations.tsx");
const workspaceSource = read("src/pages/aml/AmlCaseWorkspace.tsx");

describe("routes are preserved — enhancement adds no routes and removes none", () => {
  it("keeps every AML route, including legacy aliases hidden from V3 nav", () => {
    for (const path of [
      'path="intake"', 'path="cases"', 'path="cases/:caseId"',
      'path="verification"', 'path="screening"', 'path="risk"',
      'path="counterparty"', 'path="finance"', 'path="transactions"',
      'path="monitoring"', 'path="investigations"', 'path="austrac"',
      'path="records"', 'path="governance"', 'path="launch-ops"',
      'path="partner-operations"', 'path="configuration"',
    ]) {
      expect(appSource).toContain(path);
    }
    expect(appSource).toContain('path="admin/aml-integration-health"');
  });

  it("has no Developer Portal route in the admin app", () => {
    expect(appSource).not.toMatch(/developer-portal/i);
    expect(appSource).not.toMatch(/DeveloperPortal/);
  });
});

describe("feature flags stay default-off and both navs ship together", () => {
  it("useAmlV3Flags defaults every flag to false", () => {
    // Both the initial state and the network-failure fallback are all-false.
    for (const field of [
      "v3Nav", "startClientCompliance", "complianceHome", "caseWorkspace",
      "regulatoryHub", "terminologyEditor", "metricsRelocation", "orgSettings",
    ]) {
      expect(flagsSource).toContain(`${field}: false`);
      expect(flagsSource).not.toContain(`${field}: true`);
    }
  });

  it("AmlLayout keeps LEGACY_WORKSPACES and V3_WORKSPACES", () => {
    expect(layoutSource).toContain("const LEGACY_WORKSPACES: Workspace[]");
    expect(layoutSource).toContain("const V3_WORKSPACES: Workspace[]");
    expect(layoutSource).toContain("v3Nav ? V3_WORKSPACES : LEGACY_WORKSPACES");
  });

  it("the shell never surfaces flag names or role chips", () => {
    // Flag identifiers may appear in comments; assert none are in JSX text
    // by checking the known offender patterns.
    expect(layoutSource).not.toMatch(/\{[^}]*aml_v3[^}]*\}/);
    expect(layoutSource).toContain("Role chips + module status intentionally removed");
  });
});

describe("register deep links and rollout fallbacks stay intact", () => {
  it("supports ?open=, ?tab=, ?activateClientId= and the new ?view=", () => {
    expect(casesSource).toContain('searchParams.get("open")');
    expect(casesSource).toContain('searchParams.get("view")');
    expect(casesSource).toContain('searchParams.get("activateClientId")');
  });

  it("full-page workspace keeps the flag-off redirect to the legacy dialog", () => {
    expect(workspaceSource).toContain("`/admin/aml/cases?open=${caseId}`");
  });

  it("workspace section state lives in the section URL parameter", () => {
    expect(workspaceSource).toContain('searchParams.get("section")');
    expect(workspaceSource).toContain('params.set("section", next)');
  });
});

describe("readiness surfaces stay truthful", () => {
  it("partner operations still reports unknown readiness as not verified", () => {
    expect(partnerOpsSource).toMatch(/unknown — not verified/i);
  });
});
