/**
 * Guard-rails for the AML workspace redesign.
 *
 * The redesign is presentation only. These source tests pin the boundaries
 * it must not cross, so a later change cannot quietly turn a reading into
 * an authority, add a server operation behind a nicer card, or lose a
 * section that used to exist.
 *
 * They are deliberately about *shape*, not about wording: the behavioural
 * assertions live in `src/lib/aml/workspaceViewModel.test.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repo = process.cwd();
const read = (p: string) => readFileSync(join(repo, p), "utf8");

const viewModel = read("src/lib/aml/workspaceViewModel.ts");
const summaryHook = read("src/lib/aml/useAmlCaseSummary.ts");
const workspace = read("src/pages/aml/AmlCaseWorkspace.tsx");
const register = read("src/pages/aml/AmlCases.tsx");
const actionPanel = read("src/components/aml/workspace/AmlContextActionPanel.tsx");
const readinessCard = read("src/components/aml/workspace/AmlServiceReadinessCard.tsx");

const componentDir = "src/components/aml/workspace";
const componentFiles = readdirSync(join(repo, componentDir))
  .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
  .map((f) => ({ name: f, source: read(`${componentDir}/${f}`) }));

/* ------------------------------------------------------------------ */

describe("the view model is pure and cannot become an authority", () => {
  it("fetches nothing — no supabase, no fetch, no API client", () => {
    expect(viewModel).not.toMatch(/supabase|invokeSecureFunction|invokeAmlFunction|\bfetch\(/);
    // No API object is referenced at all, so no call can be made through one.
    expect(viewModel).not.toMatch(/\baml\w*Api\./);
  });

  it("imports only types from the API layer", () => {
    const apiImports = viewModel.match(/^import .*from "\.\/aml\w*Api";$/gm) ?? [];
    expect(apiImports.length).toBeGreaterThan(0);
    for (const line of apiImports) expect(line.startsWith("import type ")).toBe(true);
  });

  it("declares itself presentation-only where a reader will see it", () => {
    expect(viewModel).toContain("PRESENTATION ONLY");
    expect(viewModel).toContain("It never persists");
    expect(viewModel).toContain("It never decides");
  });

  it("has no next_action column anywhere — the value is derived per render", () => {
    expect(viewModel).not.toMatch(/next_action['"\s]*[:=]/);
    expect(workspace).not.toMatch(/next_action['"\s]*[:=]/);
    expect(register).not.toMatch(/next_action['"\s]*[:=]/);
  });
});

describe("the service gate is never inferred", () => {
  it("readiness reads the canonical gate and only the canonical gate", () => {
    const fn = viewModel.slice(
      viewModel.indexOf("export function deriveAmlServiceReadiness"),
      viewModel.indexOf("/* ═", viewModel.indexOf("export function deriveAmlServiceReadiness")),
    );
    expect(fn).toContain("serviceGateStatus(facts.caseRow)");
    // Nothing in the readiness derivation may look at risk, identity,
    // screening, funding or ownership.
    expect(fn).not.toMatch(/risk_rating|facts\.identity|facts\.screening|facts\.funding|facts\.ownership/);
  });

  it("the readiness card says in words that evidence does not move the gate", () => {
    expect(readinessCard).toContain("The service gate is an explicit decision");
    expect(readinessCard).toMatch(/none of them moves the gate/i);
  });

  it("the macro rail completes DECIDE from the gate, not from the stage", () => {
    const fn = viewModel.slice(
      viewModel.indexOf("export function deriveAmlMacroPhase"),
      viewModel.indexOf("/* ═", viewModel.indexOf("export function deriveAmlMacroPhase")),
    );
    expect(fn).toContain("gateSettled");
    expect(fn).not.toContain("risk_rating");
  });
});

describe("no new server surface", () => {
  it("the summary hook calls only existing read operations", () => {
    // Every call it makes goes through an existing typed API module.
    expect(summaryHook).not.toMatch(/supabase|invokeSecureFunction|invokeAmlFunction|\bfetch\(/);
    for (const call of [
      "amlVerificationApi.listVerificationChecks(",
      "amlCasesApi.listPartyScreening(",
      "amlMonitoringApi.caseMonitoringSummary(",
      "amlRiskApi.gateContract(",
      "amlCasesApi.listRequirements(",
      "amlEntitiesApi.listEntitiesForCase(",
      "amlMonitoringApi.listSof(",
      "amlRelianceApi.listGrants(",
      "amlRelianceApi.listAssessments(",
    ]) {
      expect(summaryHook).toContain(call);
    }
  });

  it("the summary hook only reads — it performs no mutation", () => {
    expect(summaryHook).not.toMatch(
      /\b(transition|setServiceGate|decide|recommend|adjudicate|resolveMatch|issueAttestation|grantAccess|upsert|create|delete)\w*\(/,
    );
  });

  it("every evidence read is individually failure-tolerant", () => {
    // A read that fails resolves to null and reads as "not available" —
    // one bad or unauthorised read can never blank the workspace.
    expect(summaryHook).toContain("const soft =");
    expect(summaryHook).toMatch(/\.then\(\(v\) => v, \(\) => null\)/);
    // A synchronous throw is caught too, not just a rejection.
    expect(summaryHook).toMatch(/} catch {\s*return Promise\.resolve\(null\);/);
  });

  it("the presentation components fetch nothing at all", () => {
    for (const { name, source } of componentFiles) {
      expect(
        /supabase|invokeSecureFunction|invokeAmlFunction|\bfetch\(|useEffect/.test(source),
        `${name} must not fetch or run effects`,
      ).toBe(false);
    }
  });

  it("the only mutation in the rail is the transition the old panel already made", () => {
    const mutations = actionPanel.match(/aml\w+Api\.\w+\(/g) ?? [];
    expect([...new Set(mutations)]).toEqual(["amlCasesApi.transition("]);
  });
});

describe("the case state machine is untouched", () => {
  it("the action rail keeps the legal transition map verbatim", () => {
    for (const line of [
      'draft: ["kyc_in_progress", "closed"]',
      'kyc_in_progress: ["kyc_complete", "edd_required", "blocked", "closed"]',
      'kyc_complete: ["under_review", "edd_required", "cleared", "closed"]',
      'edd_required: ["under_review", "escalated_mlro", "blocked", "closed"]',
      'under_review: ["cleared", "escalated_mlro", "edd_required", "blocked", "closed"]',
      'escalated_mlro: ["cleared", "blocked", "closed"]',
      'cleared: ["under_review", "closed"]',
      'blocked: ["under_review", "closed"]',
      "closed: []",
    ]) {
      expect(actionPanel).toContain(line);
    }
  });

  it("Blocked and Closed still require a confirmed, non-empty reason", () => {
    expect(actionPanel).toContain(
      'PANEL_DESTRUCTIVE_TRANSITIONS = new Set<AmlCaseStatus>(["blocked", "closed"])',
    );
    expect(actionPanel).toContain("AlertDialog");
    expect(actionPanel).toContain("!destructiveReason.trim()");
  });

  it("statuses render through the shared labels, never as raw enums", () => {
    expect(actionPanel).toContain("CASE_STATUS_LABELS");
    expect(actionPanel).not.toMatch(/\{caseRow\.status\}/);
  });
});

describe("no section, and no capability, was lost", () => {
  it("keeps every section the previous rail offered", () => {
    for (const key of [
      "overview", "identity", "ownership", "counterparty", "finance", "documents",
      "submission-review", "risk", "monitoring", "requests", "timeline",
    ]) {
      expect(viewModel).toContain(`"${key}"`);
      expect(workspace).toContain(`"${key}"`);
    }
  });

  it("still mounts every existing section component", () => {
    for (const component of [
      "VerificationSection", "PartyVerificationPanel", "PartyScreeningPanel",
      "LegacyVerificationHistoryPanel", "ScreeningTab", "OwnershipControlTab",
      "PurchaseCounterpartySection", "FundingFinanceTab", "DocumentsEvidenceSection",
      "SubmissionReviewPanel", "RiskTab", "RequestsSection", "MonitoringReviewsSection",
      "ComplianceJourneyMap", "ReliancePassportSection", "TimelineTab", "AuditTab",
      "ConsentEvidenceCard",
    ]) {
      expect(workspace).toContain(`<${component}`);
    }
  });

  it("keeps the detailed fourteen-step rail, in Records", () => {
    expect(workspace).toContain("progressRail(caseRow)");
    expect(workspace).toContain("<DetailedProcessRail");
  });

  it("keeps the role gates the previous rail applied", () => {
    expect(workspace).toContain("counterparty: (a) => a.canInvestigate");
    expect(workspace).toContain("finance: (a) => a.canInvestigate");
    expect(workspace).toContain("monitoring: (a) => a.canInvestigate");
    // Hiding a section is a rendering decision, and the source says so.
    expect(workspace).toContain("This is a rendering decision only");
  });
});

describe("deep links and rollout behaviour survive", () => {
  it("the section parameter still drives the workspace", () => {
    expect(workspace).toContain('searchParams.get("section")');
    expect(workspace).toContain('params.set("section", next)');
  });

  it("the flag-off redirect to the legacy dialog is unchanged", () => {
    expect(workspace).toContain("`/admin/aml/cases?open=${caseId}`");
  });

  it("the register keeps every saved-view key other surfaces deep-link to", () => {
    for (const key of ["onboarding", "awaiting_review", "additional_info", "awaiting_decision"]) {
      expect(register).toContain(`key: "${key}"`);
    }
    expect(register).toContain('searchParams.get("view")');
    expect(register).toContain('searchParams.get("open")');
    expect(register).toContain('searchParams.get("activateClientId")');
  });

  it("the register's client-side view is honest about a truncated page", () => {
    expect(register).toContain("refinedFromTruncatedPage");
    expect(register).toContain("loaded case");
  });
});

describe("presentation discipline", () => {
  it("uses semantic tokens only — no raw palette classes or hex literals", () => {
    const palette =
      /(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}/;
    for (const { name, source } of [
      ...componentFiles,
      { name: "AmlCaseWorkspace.tsx", source: workspace },
      { name: "AmlCases.tsx", source: register },
      { name: "workspaceViewModel.ts", source: viewModel },
    ]) {
      expect(palette.test(source), `${name} uses a raw Tailwind palette class`).toBe(false);
      expect(/#[0-9a-fA-F]{3,8}\b/.test(source), `${name} contains a hex colour`).toBe(false);
    }
  });

  it("never claims a partner is 'independently compliant'", () => {
    for (const { name, source } of [
      ...componentFiles,
      { name: "workspaceViewModel.ts", source: viewModel },
      { name: "ComplianceJourneyMap.tsx", source: read("src/components/aml/ComplianceJourneyMap.tsx") },
    ]) {
      expect(
        /independently compliant/i.test(source),
        `${name} makes a compliance claim the domain does not support`,
      ).toBe(false);
    }
  });

  it("marks status with words as well as tone — no colour-only meaning", () => {
    // Every attention level maps to a label, not just a class.
    expect(viewModel).toContain("EVIDENCE_STATE_LABELS");
    const nav = componentFiles.find((f) => f.name === "AmlWorkspaceNavigation.tsx")!.source;
    expect(nav).toContain('aria-label={level === "critical"');
    const macro = componentFiles.find((f) => f.name === "AmlMacroProgress.tsx")!.source;
    expect(macro).toContain("STATE_DESCRIPTION");
    expect(macro).toContain('className="sr-only"');
  });
});

describe("no database change was needed", () => {
  it("no migration persists a derived reading", () => {
    // The next action, the macro phase and the attention level are computed
    // per render. If any of them ever acquires a column, it has become a
    // source of truth — which is the one thing this redesign may not do.
    // Scoped to the AML schema: an unrelated `next_action` on a finance
    // portal valuations table predates all of this and is not ours.
    const offenders = readdirSync(join(repo, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => {
        const sql = read(`supabase/migrations/${f}`);
        return (
          /\baml\./i.test(sql) &&
          /\b(next_action|macro_phase|case_attention|attention_level|service_readiness)\b/i.test(sql)
        );
      });
    expect(offenders).toEqual([]);
  });
});
