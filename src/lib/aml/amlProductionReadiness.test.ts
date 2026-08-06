/**
 * Production-readiness remediation coverage:
 *  - environment classification and the fail-closed provider policy
 *    (behavioural, against the pure module);
 *  - the client-portal session contract that broke production (source
 *    contracts, so the exact defect cannot be reintroduced silently);
 *  - simulated executions staying out of compliance decisions.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  classifyEnvironment,
  decideProvider,
  PRODUCTION_PROJECT_REF,
} from "../../../supabase/functions/_shared/aml/providerEnvironment";

const portalFn = readFileSync("supabase/functions/aml-client-portal/index.ts", "utf8");
const portalPage = readFileSync("src/pages/portal/PortalAml.tsx", "utf8");
const verificationFn = readFileSync("supabase/functions/aml-verification/index.ts", "utf8");
const riskFn = readFileSync("supabase/functions/aml-risk/index.ts", "utf8");
const providersFactory = readFileSync("supabase/functions/_shared/aml/providers/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260830000000_aml_check_execution_mode.sql", "utf8");
const workspaceTabs = readFileSync("src/components/aml/CaseWorkspaceTabs.tsx", "utf8");

describe("environment classification", () => {
  it("honours the explicit declaration above everything else", () => {
    expect(classifyEnvironment({ amlEnvironment: "staging", supabaseUrl: `https://${PRODUCTION_PROJECT_REF}.supabase.co` })).toBe("staging");
    expect(classifyEnvironment({ amlEnvironment: "Production" })).toBe("production");
    expect(classifyEnvironment({ amlEnvironment: "local" })).toBe("local");
  });
  it("recognises the production project from the platform-injected URL", () => {
    expect(classifyEnvironment({ supabaseUrl: `https://${PRODUCTION_PROJECT_REF}.supabase.co` })).toBe("production");
  });
  it("answers unknown when nothing trusted identifies the environment", () => {
    expect(classifyEnvironment({})).toBe("unknown");
    expect(classifyEnvironment({ supabaseUrl: "https://someotherref.supabase.co" })).toBe("unknown");
  });
});

describe("provider policy — production fails closed", () => {
  const base = { adapterWired: true, adapterConfigured: true } as const;
  it("production with no configuration refuses as provider_not_configured", () => {
    const d = decideProvider({ environment: "production", mode: "simulator", providerKey: "simulator", ...base });
    expect(d.kind).toBe("refuse");
    expect((d as any).code).toBe("provider_not_configured");
  });
  it("production with an explicit simulator selection is blocked", () => {
    const d = decideProvider({ environment: "production", mode: "live", providerKey: "simulator", ...base });
    expect(d.kind).toBe("refuse");
    expect((d as any).code).toBe("simulator_blocked_in_production");
  });
  it("production live but unwired or unconfigured refuses as misconfigured", () => {
    expect((decideProvider({ environment: "production", mode: "live", providerKey: "frankie", adapterWired: false, adapterConfigured: false }) as any).code).toBe("provider_misconfigured");
    expect((decideProvider({ environment: "production", mode: "live", providerKey: "selfhosted", adapterWired: true, adapterConfigured: false }) as any).code).toBe("provider_misconfigured");
  });
  it("production fully-configured live runs live", () => {
    expect(decideProvider({ environment: "production", mode: "live", providerKey: "selfhosted", ...base }).kind).toBe("live");
  });
  it("local and test keep the simulator; unknown is not treated as production", () => {
    for (const environment of ["local", "test", "staging", "unknown"] as const) {
      expect(decideProvider({ environment, mode: "simulator", providerKey: "simulator", ...base }).kind).toBe("simulator");
    }
  });
});

describe("client-portal session contract (the production defect)", () => {
  it("never selects full_name from client_portal_users", () => {
    expect(portalFn).not.toMatch(/client_portal_users:user_id\([^)]*full_name/);
  });
  it("selects exactly the columns production has, and keeps the error", () => {
    expect(portalFn).toContain("client_portal_users:user_id(id, client_id, email, status)");
    expect(portalFn).toContain("portal_session_lookup_failed");
    expect(portalFn).toMatch(/const \{ data: session, error: sessionError \}/);
  });
  it("refuses revoked sessions", () => {
    expect(portalFn).toContain("revoked_at");
    expect(portalFn).toContain("portal_session_invalid");
  });
  it("keeps the case query scoped to the session's exact client_id", () => {
    expect(portalFn).toContain(".eq('client_id', clientId)");
    expect(portalFn).not.toMatch(/ilike\(|\.or\(.*email/);
  });
});

describe("portal page — error is never the empty state", () => {
  it("renders a retryable failure state distinct from the no-case message", () => {
    expect(portalPage).toContain("loadFailed");
    expect(portalPage).toContain("Try again");
    const errorBranch = portalPage.indexOf("loadFailed ? (");
    const emptyBranch = portalPage.indexOf("hasn’t opened an AML onboarding case");
    expect(errorBranch).toBeGreaterThan(-1);
    expect(emptyBranch).toBeGreaterThan(errorBranch);
  });
});

describe("verification function — refusals never create customer failures", () => {
  it("maps ProviderResolutionError to 409 before any insert", () => {
    const idvBlock = verificationFn.slice(verificationFn.indexOf('case "initiate_idv"'), verificationFn.indexOf('case "get_idv"'));
    expect(idvBlock.indexOf("ProviderResolutionError")).toBeLessThan(idvBlock.indexOf('from("identity_checks").insert'));
    expect(idvBlock).toContain("}, 409)");
  });
  it("records provider outages as pending with attempt_not_consumed, never failed", () => {
    const idvBlock = verificationFn.slice(verificationFn.indexOf('case "initiate_idv"'), verificationFn.indexOf('case "get_idv"'));
    expect(idvBlock).toContain('error_category: "provider_unavailable"');
    expect(idvBlock).toContain("attempt_not_consumed");
    expect(idvBlock).not.toContain('status: "failed"');
  });
  it("stamps execution mode and standing at insert with a legacy retry", () => {
    expect(verificationFn).toContain('execution_mode: provider.mode === "simulator" ? "simulation" : "live"');
    expect(verificationFn).toContain('authoritative: provider.mode !== "simulator"');
    expect(verificationFn).toMatch(/execution_mode\|authoritative\|environment/);
  });
  it("exposes readiness read-only with boolean secrets", () => {
    expect(verificationFn).toContain('case "provider_readiness"');
    expect(verificationFn).toContain("Boolean(Deno.env.get(\"AML_VERIFICATION_SERVICE_URL\"))");
    expect(verificationFn).not.toMatch(/provider_readiness[\s\S]{0,2000}Deno\.env\.get\("AML_VERIFICATION_SERVICE_TOKEN"\)\s*[^)]*\}/);
  });
});

describe("factory — no silent simulator anywhere", () => {
  it("both factories consult the decision policy and throw typed refusals", () => {
    expect(providersFactory).toContain("decideProvider({");
    expect(providersFactory.match(/decideProvider\(\{/g)?.length).toBeGreaterThanOrEqual(2);
    expect(providersFactory).toContain("ProviderResolutionError(decision.code");
  });
});

describe("simulated records stay out of compliance decisions", () => {
  it("migration is additive, backfills only conclusive simulator rows, deletes nothing", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS execution_mode");
    expect(migration).toContain("WHERE provider = 'simulator'");
    expect(migration).not.toMatch(/\bDELETE\b|\bDROP TABLE\b/);
    expect(migration).toContain("did not converge");
  });
  it("risk mandatory inputs read only authoritative failed IDV rows", () => {
    expect(riskFn).toContain('.eq("authoritative", true)');
    expect(riskFn).toContain("failedAuthoritativeIdv");
  });
  it("staff rows label simulations and outages instead of a bare failed badge", () => {
    expect(workspaceTabs).toContain("Test simulation — not compliance evidence");
    expect(workspaceTabs).toContain("Provider unavailable — attempt not consumed");
    expect(workspaceTabs).toContain("Request identity verification");
    expect(workspaceTabs).not.toContain(">Initiate IDV<");
  });
});
