import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs from the repo root; jsdom rewrites import.meta.url to an http
// scheme, so resolve the sources from the working directory instead.
const repo = process.cwd();
const read = (p: string) => readFileSync(join(repo, p), "utf8");

const edgeSource = read("supabase/functions/aml-cases/index.ts");
const migrationSource = read("supabase/migrations/20260826000000_aml_activate_inactive_client.sql");
const amlCasesPage = read("src/pages/aml/AmlCases.tsx");
const dialogSource = read("src/components/aml/ActivateClientDialog.tsx");
const activateAction = read("src/components/clients/ClientAmlActivateAction.tsx");
const summaryCard = read("src/components/clients/ClientAmlSummaryCard.tsx");
const clientManagement = read("src/pages/ClientManagement.tsx");

describe("AML activation pathway — server contract", () => {
  it("no longer rejects inactive clients from activation", () => {
    expect(edgeSource).not.toContain("Client is not active; cannot activate for AML");
    expect(edgeSource).toContain("const clientWasInactive = client.is_active !== true;");
  });

  it("marks the client active and opens the case in one transaction, with a compensated fallback", () => {
    // Transactional RPC first…
    expect(edgeSource).toContain("aml_activate_client_open_case");
    // …and if the RPC is not migrated yet, the fallback reverts the active
    // flip whenever case creation fails, so a client is never left active
    // without their AML case.
    const fallback = edgeSource.slice(edgeSource.indexOf("isMissingFunctionError(txErr)"));
    expect(fallback).toContain(".update({ is_active: true }).eq('id', clientId)");
    expect(fallback).toContain(".update({ is_active: false }).eq('id', clientId)");
    const revertIdx = edgeSource.indexOf(".update({ is_active: false })");
    const createErrIdx = edgeSource.indexOf("if (createErr) {", edgeSource.indexOf("clientMarkedActive = true;"));
    expect(createErrIdx).toBeGreaterThan(-1);
    expect(revertIdx).toBeGreaterThan(createErrIdx);
  });

  it("the migration performs the flip and the insert inside a single function (one transaction)", () => {
    expect(migrationSource).toContain("CREATE OR REPLACE FUNCTION public.aml_activate_client_open_case");
    expect(migrationSource).toContain("FOR UPDATE");
    expect(migrationSource).toContain("SET is_active = true");
    expect(migrationSource).toContain("INSERT INTO aml.cases");
    // Service-role only; never callable directly from the browser roles.
    expect(migrationSource).toContain("REVOKE ALL ON FUNCTION public.aml_activate_client_open_case(uuid, jsonb) FROM authenticated");
    expect(migrationSource).toContain("GRANT EXECUTE ON FUNCTION public.aml_activate_client_open_case(uuid, jsonb) TO service_role");
  });

  it("keeps duplicate-open-case prevention on every creation path", () => {
    // Pre-check…
    expect(edgeSource).toContain("Duplicate-open guard: one open case per client at a time.");
    // …and the unique-index race backstop surfaces as the same 409 on the
    // active path, the RPC path and the fallback path.
    const occurrences = edgeSource.split("An open AML case already exists for this client").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(4);
  });

  it("gates activation, search and the route-handoff lookup behind AML write roles", () => {
    const activateBlock = edgeSource.slice(
      edgeSource.indexOf("case 'activate_client'"),
      edgeSource.indexOf("case 'update'"),
    );
    expect(activateBlock).toContain("if (!canCreate) return jsonResponse({ error: 'Analyst or MLRO role required' }, 403);");
    const searchBlock = edgeSource.slice(
      edgeSource.indexOf("case 'search_clients'"),
      edgeSource.indexOf("case 'get_client_for_activation'"),
    );
    expect(searchBlock).toContain("if (!canWrite) return jsonResponse({ error: 'Insufficient permissions' }, 403);");
    const lookupBlock = edgeSource.slice(
      edgeSource.indexOf("case 'get_client_for_activation'"),
      edgeSource.indexOf("case 'client_summary'"),
    );
    expect(lookupBlock).toContain("if (!canWrite) return jsonResponse({ error: 'Insufficient permissions' }, 403);");
    expect(lookupBlock).toContain("return jsonResponse({ error: 'Client not found' }, 404);");
  });

  it("search reads only the canonical clients table and returns inactive clients too", () => {
    const searchBlock = edgeSource.slice(
      edgeSource.indexOf("case 'search_clients'"),
      edgeSource.indexOf("case 'get_client_for_activation'"),
    );
    expect(searchBlock).toContain(".from('clients')");
    expect(searchBlock).not.toContain("marketing");
    expect(searchBlock).not.toMatch(/filter\(.*is_active === true\)\.slice/);
    expect(searchBlock).toContain("selectActivationMatches");
  });
});

describe("AML activation pathway — route handoff", () => {
  it("the AML Cases page reads activateClientId and preselects the dialog with it", () => {
    expect(amlCasesPage).toContain('searchParams.get("activateClientId")');
    expect(amlCasesPage).toContain("clientId={activateClientId ?? undefined}");
    // Param is removed once the flow completes or the dialog closes.
    expect(amlCasesPage).toContain('next.delete("activateClientId")');
  });

  it("navigation to the activation route carries the client ID only — no personal information", () => {
    for (const source of [activateAction, summaryCard]) {
      const urls = source.match(/\/admin\/aml\/cases\?activateClientId=\$\{clientId\}/g) ?? [];
      expect(urls.length).toBeGreaterThan(0);
      // No name/email/status interpolation anywhere near the route.
      expect(source).not.toMatch(/activateClientId=\$\{clientId\}[^`]*(name|email|mobile|active)/i);
      expect(source).not.toMatch(/activateClient(Name|Email)/);
    }
  });

  it("the dialog loads the route-selected client server-side and never trusts a caller-supplied name", () => {
    expect(dialogSource).toContain("amlCasesApi.getClientForActivation(clientId)");
    expect(dialogSource).toContain("setDisplayName(res.client.label)");
    expect(dialogSource).not.toContain("Mark the client active on their record first");
  });

  it("the client-details action is not gated behind the startClientCompliance rollout flag", () => {
    // Only the caseWorkspace flag is consumed (for case navigation) — the
    // rollout flag never gates this action's visibility.
    expect(activateAction).toContain("const { caseWorkspace } = useAmlV3Flags();");
    expect(activateAction).not.toMatch(/startClientCompliance\s*[}&|?)]/);
    expect(activateAction).toContain("access.canWrite");
    expect(activateAction).toContain("access.flagEnabled");
    expect(activateAction).toContain('"Open AML Case"');
    expect(activateAction).toContain('isActive === true ? "Start AML/CTF" : "Activate for AML/CTF"');
  });
});

describe("Client data contract", () => {
  it("keeps favourite status and active status as separate concepts", () => {
    // The starred filter reads is_favorite; nothing maps it onto is_active.
    expect(clientManagement).toContain("is_favorite?: boolean");
    expect(clientManagement).toContain("is_active?: boolean | null");
    expect(clientManagement).not.toMatch(/is_active[^\n]*=\s*[^\n]*is_favorite/);
    expect(clientManagement).not.toMatch(/is_favorite[^\n]*as active status/i);
  });
});
