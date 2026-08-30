/**
 * Compliance Home — what belongs in "Your queues", and how much of the page
 * six single-digit numbers are allowed to take.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const listCases = vi.fn();
const monitoringSummary = vi.fn();

vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: { list: (a: unknown) => listCases(a) },
}));
vi.mock("@/lib/aml/amlMonitoringApi", () => ({
  amlMonitoringApi: { summary: () => monitoringSummary() },
}));
vi.mock("@/hooks/useAmlAccess", () => ({
  useAmlAccess: () => ({
    roles: new Set(["mlro"]), hasAnyRole: true, canWrite: true, isMlro: true, loading: false,
  }),
}));
vi.mock("@/lib/aml/useAmlV3Flags", () => ({
  useAmlV3Flags: () => ({ complianceHomeV3: false, loading: false }),
}));

import AmlOverview from "../AmlOverview";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

beforeEach(() => {
  vi.clearAllMocks();
  listCases.mockResolvedValue({
    cases: [{
      id: "c1", case_reference: "AML-2026-00005", subject_display_name: "Rugesh Naidu",
      status: "cleared", risk_rating: "low", subject_type: "individual",
      opened_at: "2026-08-01T00:00:00Z", created_at: "2026-08-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z", metadata: {},
    }],
    total: 6,
  });
  monitoringSummary.mockResolvedValue({
    open_alerts: 0, critical_alerts: 0, unprocessed_events: 0,
    pending_reviews: 2, overdue_reviews: 0,
  });
});

const renderHome = () => render(<MemoryRouter><AmlOverview /></MemoryRouter>);

describe("the page says each thing once", () => {
  it("draws no second title, strapline or Refresh over the command centre's", () => {
    /* The shell above it already carries all three. This page drew them
       again directly underneath — and the working Refresh was the LOWER of
       the two, because the shell's dispatched an event nothing had ever
       listened for. */
    renderHome();
    const page = read("src/pages/aml/AmlOverview.tsx")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(page).not.toContain("AmlPageHeader");
    expect(page).not.toContain("AmlRefreshButton");
  });

  it("answers the command centre's Refresh, which nothing used to", () => {
    const page = read("src/pages/aml/AmlOverview.tsx");
    expect(page).toContain("addEventListener(AML_COMMAND_REFRESH_EVENT");
    expect(read("src/components/aml/AmlLayout.tsx"))
      .toContain("new CustomEvent(AML_COMMAND_REFRESH_EVENT)");
  });

  it("draws no queue directory, because the navigation carries every entry", () => {
    /* It listed five destinations and every one is in the strip now: the
       register under Customer Compliance, Monitoring, Investigations & EDD
       and Records & Privacy under Compliance Home, and the AUSTRAC Hub as a
       workspace of its own. A card repeating them was a third launcher,
       after the primary strip and the "jump back" card above it. */
    renderHome();
    /* Comments stripped before matching: the page still EXPLAINS what left
       and why, and a test that trips over its own explanation is a test that
       gets weakened rather than a rule that gets kept. */
    const page = read("src/pages/aml/AmlOverview.tsx")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(page).not.toContain("QUEUE_LINKS");
    expect(page).not.toContain("Your queues");
  });

  it("keeps the one launcher that adapts to the reader", () => {
    /* The role-adaptive hint survives: it points at the single queue that
       matters to this operator today, which is not something a static list
       of five can do. */
    renderHome();
    expect(screen.getByText(/Jump back into your queue/i)).toBeInTheDocument();
  });

  it("still leads with the readings, and still deep-links them", async () => {
    renderHome();
    expect(await screen.findByRole("heading", { name: "Customer cases" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Monitoring" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Awaiting decision/i }))
      .toHaveAttribute("href", "/admin/aml/cases?view=awaiting_decision");
  });

  it("never paints a fabricated zero before the fetch settles", async () => {
    /* The dense cell keeps the loading and unavailable readings: a zero that
       has not been measured is a lie about a queue. */
    monitoringSummary.mockReturnValue(new Promise(() => {}));
    renderHome();
    expect(await screen.findByText(/Loading Open alerts/i)).toBeInTheDocument();
  });
});

describe("the page is worked, not read", () => {
  it("opens the case from its row on the latest list", async () => {
    /* The rows were static text — a name, a reference and two badges, with
       no way to act on any of it. The only route off the card was "Open case
       register", which puts an operator back in a list they are already
       looking at a row of. */
    renderHome();
    const row = await screen.findByRole("link", { name: /Open Rugesh Naidu's case/i });
    expect(row).toHaveAttribute("href", "/admin/aml/cases/c1");
  });

  it("names the customer and the reference in the row's accessible name", async () => {
    renderHome();
    const row = await screen.findByRole("link", { name: /Open Rugesh Naidu's case/i });
    expect(row).toHaveAccessibleName(/AML-2026-00005/);
  });
});

describe("nothing was stranded on the way", () => {
  it("every surface the retired workspace held still belongs to one", () => {
    /* The rule this repository records twice: a path belonging to no
       workspace draws no secondary strip and highlights Compliance Home —
       reachable, and looking broken. */
    const shell = read("src/components/aml/AmlLayout.tsx");
    for (const path of [
      "/admin/aml/monitoring", "/admin/aml/investigations",
      "/admin/aml/records", "/admin/aml/austrac",
    ]) {
      expect(shell).toContain(`"${path}"`);
    }
  });

  it("keeps every route declared unconditionally", () => {
    /* Hiding is never deleting: a bookmark and a deep link both still land. */
    const app = read("src/App.tsx");
    for (const path of ["monitoring", "investigations", "records", "austrac", "configuration"]) {
      expect(app).toContain(`path="${path}"`);
    }
  });
});
