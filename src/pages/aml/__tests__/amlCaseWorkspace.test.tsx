import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AmlCaseWorkspace from "../AmlCaseWorkspace";
import type { AmlCase } from "@/lib/aml/amlCasesApi";

class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: TestResizeObserver });

const get = vi.fn();
const listClientRequests = vi.fn();
const transition = vi.fn();
const consentStatus = vi.fn();

vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    get: (...a: unknown[]) => get(...a),
    listClientRequests: (...a: unknown[]) => listClientRequests(...a),
    transition: (...a: unknown[]) => transition(...a),
    consentStatus: (...a: unknown[]) => consentStatus(...a),
    listRequirements: () => Promise.resolve({ requirements: [] }),
    listDocuments: () => Promise.resolve({ documents: [] }),
    createClientRequest: vi.fn(),
    resolveClientRequest: vi.fn(),
  },
}));
vi.mock("@/lib/aml/amlFinanceApi", () => ({
  amlFinanceApi: { listEvidence: () => Promise.resolve({ evidence: [] }) },
}));
vi.mock("@/lib/aml/amlTransactionsApi", () => ({ amlTransactionsApi: {} }));
vi.mock("@/lib/aml/amlMonitoringApi", () => ({
  amlMonitoringApi: { caseMonitoringSummary: () => Promise.resolve({ monitoring: null }) },
}));
// Section bodies are heavy trees with their own data models — replace with
// labelled stubs; this suite is about the workspace shell.
vi.mock("@/components/aml/VerificationSection", () => ({
  VerificationSection: () => <div data-testid="section-verification" />,
}));
vi.mock("@/components/aml/ReliancePassportSection", () => ({
  ReliancePassportSection: () => <div data-testid="section-reliance" />,
}));
vi.mock("@/components/aml/ComplianceJourneyMap", () => ({
  ComplianceJourneyMap: () => <div data-testid="journey-map" />,
}));
vi.mock("@/components/aml/CaseWorkspaceTabs", () => ({
  VerificationTab: () => <div data-testid="tab-verification" />,
  ScreeningTab: () => <div data-testid="tab-screening" />,
  RiskTab: () => <div data-testid="tab-risk" />,
  OwnershipControlTab: () => <div data-testid="tab-ownership" />,
  FundingFinanceTab: () => <div data-testid="tab-finance" />,
  TimelineTab: () => <div data-testid="tab-timeline" />,
  AuditTab: () => <div data-testid="tab-audit" />,
}));

let mockWorkspaceFlag = true;
vi.mock("@/lib/aml/useAmlV3Flags", () => ({
  useAmlV3Flags: () => ({
    v3Nav: false, startClientCompliance: false, complianceHome: false,
    caseWorkspace: mockWorkspaceFlag,
    regulatoryHub: false, terminologyEditor: false, metricsRelocation: false,
    orgSettings: false, loading: false,
  }),
}));

let mockRoles = new Set(["analyst", "reviewer", "mlro"]);
vi.mock("@/hooks/useAmlAccess", () => ({
  useAmlAccess: () => ({
    loading: false, flagEnabled: true, roles: mockRoles,
    hasAnyRole: mockRoles.size > 0, canWrite: true,
    isMlro: mockRoles.has("mlro"), refresh: vi.fn(),
  }),
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const baseCase: AmlCase = {
  id: CASE_ID,
  case_reference: "AML-2026-00001",
  client_id: "22222222-2222-4222-8222-222222222222",
  purchase_file_id: null,
  subject_type: "individual",
  subject_display_name: "Avery Client",
  status: "kyc_complete",
  risk_rating: "medium", risk_score: null,
  assigned_analyst_id: null, assigned_mlro_id: null,
  opened_at: "2026-08-01T00:00:00Z", closed_at: null,
  metadata: {}, created_by: null,
  created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-02T00:00:00Z",
} as AmlCase;

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location" data-search={location.search} />;
}

function setup(url = `/admin/aml/cases/${CASE_ID}`) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/admin/aml/cases/:caseId"
          element={<><AmlCaseWorkspace /><LocationProbe /></>}
        />
        <Route path="/admin/aml/cases" element={<><div data-testid="register-page" /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  get.mockReset();
  listClientRequests.mockReset();
  consentStatus.mockReset();
  toast.mockReset();
  mockWorkspaceFlag = true;
  mockRoles = new Set(["analyst", "reviewer", "mlro"]);
  get.mockResolvedValue({ case: baseCase, events: [] });
  listClientRequests.mockResolvedValue({ requests: [] });
  consentStatus.mockResolvedValue({ version: 1, satisfied: true, outstanding: [], documents: [], history: [] });
});

describe("AmlCaseWorkspace — full-page shell", () => {
  it("renders the persistent case header with phase, gate and risk in text", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Avery Client" })).toBeInTheDocument();
    expect(screen.getByText("AML-2026-00001")).toBeInTheDocument();
    // Risk and the gate are the header's only two badges, and they are
    // always words — never colour alone.
    expect(screen.getByText(/Service gate: Under review/)).toBeInTheDocument();
    expect(screen.getByText(/Risk: MEDIUM/)).toBeInTheDocument();
    // The five macro phases, with the current one marked for assistive tech.
    const rail = screen.getByRole("list", { name: "Case phase" });
    for (const phase of ["Collect", "Verify", "Assess", "Decide", "Monitor"]) {
      expect(within(rail).getByText(phase)).toBeInTheDocument();
    }
    expect(within(rail).getByText("Verify").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("link", { name: "Back to the case register" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Client record/ })).toBeInTheDocument();
  });

  it("puts the next action, readiness and the evidence summary on the overview", async () => {
    setup();
    await screen.findByRole("heading", { name: "Avery Client" });
    // The one dominant call to action, derived from canonical state.
    expect(screen.getByRole("heading", { name: "Review the client submission" })).toBeInTheDocument();
    expect(screen.getByText("Service readiness")).toBeInTheDocument();
    expect(screen.getByText("Compliance evidence")).toBeInTheDocument();
    // Evidence never implies the gate.
    expect(
      screen.getByText(/The service gate is an explicit decision/),
    ).toBeInTheDocument();
  });

  it("selecting an area writes its section to the URL so refresh and sharing keep it", async () => {
    setup();
    await screen.findByRole("heading", { name: "Avery Client" });
    // The rail renders twice (a scrolling rail below lg, a vertical rail
    // above it); only one is ever visible, so either drives the same state.
    fireEvent.click(screen.getAllByRole("button", { name: /^Customer/ })[0]);
    expect(screen.getByTestId("location").dataset.search).toBe("?section=identity");
    expect(screen.getByTestId("tab-screening")).toBeInTheDocument();
    // The area's sections appear once it is open.
    expect(screen.getAllByRole("button", { name: /Ownership & control/ }).length)
      .toBeGreaterThan(0);
    // Overview is the clean default — no parameter.
    fireEvent.click(screen.getAllByRole("button", { name: /^Overview/ })[0]);
    expect(screen.getByTestId("location").dataset.search).toBe("");
  });

  it("keeps every previously deep-linked section reachable at the same key", async () => {
    for (const [section, testId] of [
      ["risk", "tab-risk"],
      ["ownership", "tab-ownership"],
      ["finance", "tab-finance"],
    ] as const) {
      const view = setup(`/admin/aml/cases/${CASE_ID}?section=${section}`);
      await screen.findByRole("heading", { name: "Avery Client" });
      expect(screen.getByTestId(testId)).toBeInTheDocument();
      view.unmount();
    }
  });

  it("opens directly on a deep-linked ?section=", async () => {
    setup(`/admin/aml/cases/${CASE_ID}?section=timeline`);
    await screen.findByRole("heading", { name: "Avery Client" });
    expect(screen.getByTestId("tab-timeline")).toBeInTheDocument();
    expect(screen.getByTestId("tab-audit")).toBeInTheDocument();
  });

  it("ignores unknown ?section= values and falls back to the overview", async () => {
    setup(`/admin/aml/cases/${CASE_ID}?section=nonsense`);
    await screen.findByRole("heading", { name: "Avery Client" });
    expect(screen.getByText("Service readiness")).toBeInTheDocument();
  });

  it("keeps the compliance journey map and passport, in Records", async () => {
    setup(`/admin/aml/cases/${CASE_ID}?section=passport`);
    await screen.findByRole("heading", { name: "Avery Client" });
    expect(screen.getByTestId("journey-map")).toBeInTheDocument();
    expect(screen.getByTestId("section-reliance")).toBeInTheDocument();
  });

  it("keeps the detailed fourteen-step rail, in Records", async () => {
    setup(`/admin/aml/cases/${CASE_ID}?section=timeline`);
    await screen.findByRole("heading", { name: "Avery Client" });
    const rail = screen.getByRole("list", { name: "Case process steps" });
    expect(within(rail).getByText("Identity verification")).toBeInTheDocument();
    expect(within(rail).getByText("Service gate")).toBeInTheDocument();
    expect(within(rail).getByText("Retention")).toBeInTheDocument();
  });

  it("hides investigate-only sections from users without that capability", async () => {
    mockRoles = new Set(["auditor"]);
    setup(`/admin/aml/cases/${CASE_ID}?section=documents`);
    await screen.findByRole("heading", { name: "Avery Client" });
    // Transaction is open, so its sections are listed — but the two behind
    // canInvestigate are absent from the rail entirely.
    expect(screen.getAllByRole("button", { name: /Documents & evidence/ }).length)
      .toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Purchase & counterparty/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Funding & finance/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Monitoring & reviews/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Overview/ }).length).toBeGreaterThan(0);
  });

  it("falls back to the overview when a deep link points at a section the role cannot open", async () => {
    mockRoles = new Set(["auditor"]);
    setup(`/admin/aml/cases/${CASE_ID}?section=finance`);
    await screen.findByRole("heading", { name: "Avery Client" });
    expect(screen.queryByTestId("tab-finance")).not.toBeInTheDocument();
    expect(screen.getByText("Service readiness")).toBeInTheDocument();
  });

  it("redirects to the legacy ?open= deep link while the workspace flag is off", async () => {
    mockWorkspaceFlag = false;
    setup();
    await screen.findByTestId("register-page");
    expect(screen.getByTestId("location").dataset.search).toBe(`?open=${CASE_ID}`);
  });

  it("shows a retryable error state when the case cannot load", async () => {
    get.mockRejectedValue(new Error("No access to this case"));
    setup();
    expect(await screen.findByText("Case unavailable")).toBeInTheDocument();
    expect(screen.getByText("No access to this case")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to case register/ })).toBeInTheDocument();
  });

  it("keeps destructive transitions behind an explicit confirmation with a required reason", async () => {
    transition.mockResolvedValue({ case: baseCase });
    setup();
    await screen.findByRole("heading", { name: "Avery Client" });
    // kyc_complete allows "closed" — a destructive option, separated + confirmed.
    fireEvent.click(screen.getByRole("button", { name: "Closed" }));
    expect(await screen.findByText("Close this case?")).toBeInTheDocument();
    expect(transition).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "Close case" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason (required)"), {
      target: { value: "Duplicate case opened in error" },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(transition).toHaveBeenCalledWith(CASE_ID, "closed", "Duplicate case opened in error"));
  });
});
