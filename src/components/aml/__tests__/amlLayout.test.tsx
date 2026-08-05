import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AmlLayout } from "../AmlLayout";
import type { AmlRole } from "@/hooks/useAmlAccess";

class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: TestResizeObserver });

let mockRoles = new Set<AmlRole>(["analyst", "reviewer", "mlro", "auditor"]);
let mockV3Nav = false;

vi.mock("@/hooks/useAmlAccess", () => ({
  useAmlAccess: () => ({
    loading: false, flagEnabled: true, roles: mockRoles,
    hasAnyRole: mockRoles.size > 0,
    canWrite: true, isMlro: mockRoles.has("mlro"), refresh: vi.fn(),
  }),
}));
vi.mock("@/lib/aml/useAmlTerminology", () => ({
  useAmlTerminology: () => ({ t: (s: string) => s, overrides: {}, refresh: vi.fn() }),
}));
vi.mock("@/lib/aml/useAmlV3Flags", () => ({
  useAmlV3Flags: () => ({
    v3Nav: mockV3Nav, startClientCompliance: false, complianceHome: false,
    caseWorkspace: false, regulatoryHub: false, terminologyEditor: false,
    metricsRelocation: false, orgSettings: false, loading: false,
  }),
}));

function renderShell(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/aml" element={<AmlLayout />}>
          <Route index element={<div data-testid="page-home" />} />
          <Route path="cases" element={<div data-testid="page-cases" />} />
          <Route path="monitoring" element={<div data-testid="page-monitoring" />} />
          <Route path="configuration" element={<div data-testid="page-configuration" />} />
          <Route path="counterparty" element={<div data-testid="page-counterparty" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockRoles = new Set<AmlRole>(["analyst", "reviewer", "mlro", "auditor"]);
  mockV3Nav = false;
});

describe("AmlLayout — legacy (V2) navigation", () => {
  it("renders all five workspaces for a fully-capable user", () => {
    renderShell("/admin/aml");
    const nav = screen.getByRole("navigation", { name: "AML workspaces" });
    for (const label of [
      "Compliance Home", "Customer Compliance", "Transaction Compliance",
      "Regulatory & Assurance", "Organisation Settings",
    ]) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
  });

  it("marks the active workspace and secondary entry with aria-current", () => {
    renderShell("/admin/aml/cases");
    const nav = screen.getByRole("navigation", { name: "AML workspaces" });
    const customer = within(nav).getByText("Customer Compliance").closest("a")!;
    expect(customer).toHaveAttribute("aria-current", "page");
    const secondary = screen.getByRole("navigation", { name: /Customer Compliance sections/ });
    const register = within(secondary).getByText("Register").closest("a")!;
    expect(register).toHaveAttribute("aria-current", "page");
    // Legacy customer workspace still publishes the per-discipline pages.
    expect(within(secondary).getByText("Verification")).toBeInTheDocument();
    expect(within(secondary).getByText("Funding & Finance")).toBeInTheDocument();
  });

  it("shows the workspace › section context trail off the home page", () => {
    renderShell("/admin/aml/monitoring");
    const header = screen.getByRole("banner");
    expect(within(header).getAllByText("Regulatory & Assurance").length).toBeGreaterThan(0);
    expect(within(header).getAllByText("Monitoring").length).toBeGreaterThan(0);
  });

  it("hides capability-restricted entries: auditor sees no Transaction Compliance or Configuration", () => {
    mockRoles = new Set<AmlRole>(["auditor"]);
    renderShell("/admin/aml");
    const nav = screen.getByRole("navigation", { name: "AML workspaces" });
    expect(within(nav).queryByText("Transaction Compliance")).not.toBeInTheDocument();
    expect(within(nav).getByText("Regulatory & Assurance")).toBeInTheDocument();
    // Secondary Configuration entry (aml.configure) never renders for auditors.
    renderShell("/admin/aml/configuration");
    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
  });

  it("exposes labelled mobile selects instead of a horizontally-scrolling nav", () => {
    renderShell("/admin/aml/cases");
    expect(screen.getByRole("combobox", { name: "AML workspace" })).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Customer Compliance section" }),
    ).toBeInTheDocument();
  });

  it("never renders role chips or internal role metadata in the shell", () => {
    renderShell("/admin/aml");
    const header = screen.getByRole("banner");
    expect(within(header).queryByText(/analyst/i)).not.toBeInTheDocument();
    expect(within(header).queryByText(/mlro/i)).not.toBeInTheDocument();
    expect(within(header).queryByText(/aml_v3/)).not.toBeInTheDocument();
  });
});

describe("AmlLayout — V3 navigation (aml_v3_nav)", () => {
  beforeEach(() => { mockV3Nav = true; });

  it("limits Customer Compliance to Cases + My Queue", () => {
    renderShell("/admin/aml/cases");
    const secondary = screen.getByRole("navigation", { name: /Customer Compliance sections/ });
    expect(within(secondary).getByText("Cases")).toBeInTheDocument();
    expect(within(secondary).getByText("My Queue")).toBeInTheDocument();
    expect(within(secondary).queryByText("Verification")).not.toBeInTheDocument();
    expect(within(secondary).queryByText("Screening")).not.toBeInTheDocument();
  });

  it("keeps legacy alias URLs inside the customer workspace for matching", () => {
    // /admin/aml/counterparty belongs to Transaction Compliance in V3.
    renderShell("/admin/aml/counterparty");
    const nav = screen.getByRole("navigation", { name: "AML workspaces" });
    const tx = within(nav).getByText("Transaction Compliance").closest("a")!;
    expect(tx).toHaveAttribute("aria-current", "page");
    const secondary = screen.getByRole("navigation", { name: /Transaction Compliance sections/ });
    const due = within(secondary).getByText("Counterparty Due").closest("a")!;
    expect(due).toHaveAttribute("aria-current", "page");
  });

  it("puts Governance & Contacts first in Organisation Settings", () => {
    renderShell("/admin/aml/configuration");
    const secondary = screen.getByRole("navigation", { name: /Organisation Settings sections/ });
    const labels = within(secondary).getAllByRole("link").map((a) => a.textContent);
    expect(labels[0]).toBe("Governance & Contacts");
    expect(labels).toContain("Configuration");
  });
});
