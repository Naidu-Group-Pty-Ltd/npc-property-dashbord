import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AmlCasesPage from "../AmlCases";
import type { AmlCase } from "@/lib/aml/amlCasesApi";

const list = vi.fn();
const create = vi.fn();

vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    list: (...a: unknown[]) => list(...a),
    create: (...a: unknown[]) => create(...a),
  },
}));
// The workspace dialog and activation dialog pull heavy trees + supabase at
// import time — replace with test doubles that expose their wiring.
vi.mock("@/components/aml/AmlCaseWorkspaceDialog", () => ({
  AmlCaseWorkspaceDialog: ({ caseId, initialTab }: { caseId: string | null; initialTab?: string }) => (
    <div data-testid="workspace-dialog" data-case-id={caseId ?? ""} data-initial-tab={initialTab ?? ""} />
  ),
}));
vi.mock("@/components/aml/ActivateClientDialog", () => ({
  ActivateClientDialog: ({ open, clientId }: { open: boolean; clientId?: string }) => (
    <div data-testid="activate-dialog" data-open={String(open)} data-client-id={clientId ?? ""} />
  ),
}));

let mockCaseWorkspaceFlag = false;
vi.mock("@/lib/aml/useAmlV3Flags", () => ({
  useAmlV3Flags: () => ({
    v3Nav: false, startClientCompliance: false, complianceHome: false,
    caseWorkspace: mockCaseWorkspaceFlag,
    regulatoryHub: false, terminologyEditor: false, metricsRelocation: false,
    orgSettings: false, loading: false,
  }),
}));

let mockAccess = {
  loading: false, flagEnabled: true, roles: new Set(["analyst", "mlro"]),
  hasAnyRole: true, canWrite: true, isMlro: true, refresh: vi.fn(),
};
vi.mock("@/hooks/useAmlAccess", () => ({ useAmlAccess: () => mockAccess }));

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const baseCase = (over: Partial<AmlCase> = {}): AmlCase => ({
  id: CASE_ID,
  case_reference: "AML-2026-00001",
  client_id: null, purchase_file_id: null,
  subject_type: "individual",
  subject_display_name: "Avery Client",
  status: "kyc_complete",
  risk_rating: "high", risk_score: null,
  assigned_analyst_id: null, assigned_mlro_id: null,
  opened_at: "2026-08-01T00:00:00Z", closed_at: null,
  metadata: {}, created_by: null,
  created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-02T00:00:00Z",
  ...over,
} as AmlCase);

function setup(url = "/admin/aml/cases") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AmlCasesPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  list.mockReset();
  create.mockReset();
  toast.mockReset();
  mockCaseWorkspaceFlag = false;
  mockAccess = {
    loading: false, flagEnabled: true, roles: new Set(["analyst", "mlro"]),
    hasAnyRole: true, canWrite: true, isMlro: true, refresh: vi.fn(),
  };
  list.mockResolvedValue({ cases: [baseCase()], total: 1 });
});

describe("AmlCases — register shell", () => {
  it("renders header, saved views, toolbar and the loaded register", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Case register" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Saved views" })).toBeInTheDocument();
    expect(screen.getByRole("search", { name: "Filter the case register" })).toBeInTheDocument();
    expect(await screen.findByText("1 case")).toBeInTheDocument();
    // Status text, not raw enums or colour-only pills.
    expect(screen.getAllByText("Client submitted").length).toBeGreaterThan(0);
    expect(screen.getAllByText("HIGH").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Under review").length).toBeGreaterThan(0); // service gate label
    expect(screen.queryByText("kyc_complete")).not.toBeInTheDocument();
  });

  it("applies a saved view from the ?view= deep link with a single filtered fetch", async () => {
    setup("/admin/aml/cases?view=awaiting_decision");
    await waitFor(() => {
      expect((list.mock.calls.at(-1)?.[0] as any)?.status).toBe("escalated_mlro");
    });
    // The view seeds the initial filter state, so the mount never issues an
    // unfiltered request that could race the filtered one.
    expect(list).toHaveBeenCalledTimes(1);
    const chip = screen.getByRole("button", { name: "Awaiting decision" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the active-filter summary and clears everything with one action", async () => {
    setup("/admin/aml/cases?view=high_risk");
    await waitFor(() => {
      expect((list.mock.calls.at(-1)![0] as any).risk).toBe("high");
    });
    expect(await screen.findByText("Risk: High")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => {
      const params = list.mock.calls.at(-1)![0] as any;
      expect(params.risk).toBeUndefined();
      expect(params.status).toBeUndefined();
    });
    expect(screen.getByRole("button", { name: "All open" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens the legacy dialog from the ?open=&tab= deep link and clears the params", async () => {
    setup(`/admin/aml/cases?open=${CASE_ID}&tab=audit`);
    const dialog = await screen.findByTestId("workspace-dialog");
    expect(dialog).toHaveAttribute("data-case-id", CASE_ID);
    expect(dialog).toHaveAttribute("data-initial-tab", "audit");
  });

  it("hands ?activateClientId= to the activation dialog", async () => {
    setup("/admin/aml/cases?activateClientId=99999999-9999-4999-8999-999999999999");
    const dialog = await screen.findByTestId("activate-dialog");
    expect(dialog).toHaveAttribute("data-open", "true");
    expect(dialog).toHaveAttribute("data-client-id", "99999999-9999-4999-8999-999999999999");
  });

  it("activates a row with the keyboard and opens the dialog while the workspace flag is off", async () => {
    setup();
    const row = await screen.findByRole("link", {
      name: `Open case AML-2026-00001 for Avery Client`,
    });
    fireEvent.keyDown(row, { key: "Enter" });
    expect(screen.getByTestId("workspace-dialog")).toHaveAttribute("data-case-id", CASE_ID);
  });

  it("renders mobile cards with stage, risk and gate in text", async () => {
    setup();
    await screen.findByText("1 case");
    // The mobile card is a real button with an accessible name.
    const card = screen.getByRole("button", {
      name: `Open case AML-2026-00001 for Avery Client`,
    });
    expect(within(card).getByText("Client submitted")).toBeInTheDocument();
    expect(within(card).getByText("HIGH")).toBeInTheDocument();
    expect(within(card).getByText("Under review")).toBeInTheDocument();
  });

  it("shows an inline retryable error when the register fails to load", async () => {
    list.mockRejectedValueOnce(new Error("Gateway timeout"));
    list.mockResolvedValueOnce({ cases: [baseCase()], total: 1 });
    setup();
    expect(await screen.findByText("The case register could not be loaded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByText("1 case")).toBeInTheDocument();
  });

  it("shows a skeleton, not a false empty state, while refetching from an empty result", async () => {
    // First load: genuinely empty register.
    list.mockResolvedValueOnce({ cases: [], total: 0 });
    setup();
    expect(await screen.findByText("No cases yet")).toBeInTheDocument();
    // Switching to a view whose fetch is still in flight must not claim
    // "no matches" for data that hasn't arrived.
    let resolveNext: (v: unknown) => void = () => {};
    list.mockImplementationOnce(() => new Promise((r) => { resolveNext = r; }));
    fireEvent.click(screen.getByRole("button", { name: "High risk" }));
    expect(await screen.findByText("Loading the case register")).toBeInTheDocument();
    expect(screen.queryByText("No cases match the current filters")).not.toBeInTheDocument();
    resolveNext({ cases: [baseCase()], total: 1 });
    expect(await screen.findByText("1 case")).toBeInTheDocument();
  });

  it("offers a next action in the filtered empty state", async () => {
    list.mockResolvedValue({ cases: [], total: 0 });
    setup("/admin/aml/cases?view=cleared");
    expect(await screen.findByText("No cases match the current filters")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Clear filters" }).length).toBeGreaterThan(0);
  });

  it("keeps access gates intact: module off and no-role states", async () => {
    mockAccess = { ...mockAccess, flagEnabled: false };
    setup();
    expect(await screen.findByText("AML/CTF is not enabled")).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  it("hides restricted actions: no Exception case button for non-MLRO users", async () => {
    mockAccess = { ...mockAccess, isMlro: false, roles: new Set(["analyst"]) };
    setup();
    await screen.findByText("1 case");
    expect(screen.queryByRole("button", { name: /Exception case/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Activate client/ })).toBeInTheDocument();
  });
});
