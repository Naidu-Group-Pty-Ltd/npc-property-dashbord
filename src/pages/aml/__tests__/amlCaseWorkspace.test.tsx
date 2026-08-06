import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("renders the persistent case header with stage, gate and risk in text", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Avery Client" })).toBeInTheDocument();
    expect(screen.getByText("AML-2026-00001")).toBeInTheDocument();
    // Stage/gate/risk appear in the header badges (and again in the
    // overview summary) — always as text, never colour alone.
    expect(screen.getAllByText("Client submitted").length).toBeGreaterThan(0);
    expect(screen.getByText(/Service gate: Under review/)).toBeInTheDocument();
    expect(screen.getByText(/Risk: MEDIUM/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to case register" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Client record/ })).toBeInTheDocument();
  });

  it("selecting a section writes it to the URL so refresh and sharing keep it", async () => {
    setup();
    await screen.findByRole("heading", { name: "Avery Client" });
    fireEvent.click(screen.getByRole("button", { name: /Identity & Screening/ }));
    expect(screen.getByTestId("location").dataset.search).toBe("?section=identity");
    expect(screen.getByTestId("tab-screening")).toBeInTheDocument();
    // Overview is the clean default — no parameter.
    fireEvent.click(screen.getByRole("button", { name: /Overview/ }));
    expect(screen.getByTestId("location").dataset.search).toBe("");
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
    expect(screen.getByTestId("journey-map")).toBeInTheDocument();
  });

  it("hides investigate-only sections from users without that capability", async () => {
    mockRoles = new Set(["auditor"]);
    setup();
    await screen.findByRole("heading", { name: "Avery Client" });
    expect(screen.queryByRole("button", { name: /Purchase & Counterparty/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Funding & Finance/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Overview/ })).toBeInTheDocument();
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
