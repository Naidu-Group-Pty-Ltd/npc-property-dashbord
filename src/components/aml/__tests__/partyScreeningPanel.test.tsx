import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PartyScreeningPanel } from "../PartyScreeningPanel";
import type { AmlPartyScreeningSubject } from "@/lib/aml/amlCasesApi";

/**
 * The repaired party screening panel: staff inspect the actual canonical
 * candidate matches before adjudicating, adjudication resolves a specific
 * match through the accessible dialog (no window.prompt), and PEP
 * determination state is visible and actionable.
 */

const listPartyScreening = vi.fn();
const queuePartyScreening = vi.fn();
const adjudicatePartyScreening = vi.fn();
const recordPepDetermination = vi.fn();

vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    listPartyScreening: (...a: unknown[]) => listPartyScreening(...a),
    queuePartyScreening: (...a: unknown[]) => queuePartyScreening(...a),
    adjudicatePartyScreening: (...a: unknown[]) => adjudicatePartyScreening(...a),
    recordPepDetermination: (...a: unknown[]) => recordPepDetermination(...a),
  },
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const CHECK_ID = "33333333-3333-4333-8333-333333333333";
const MATCH_ID = "44444444-4444-4444-8444-444444444444";

const subject = (over: Partial<AmlPartyScreeningSubject> = {}): AmlPartyScreeningSubject => ({
  id: "55555555-5555-4555-8555-555555555555",
  case_id: CASE_ID,
  party_type: "beneficial_owner",
  party_id: null,
  screened_name: "Pat Example",
  required: true,
  state: "possible_match",
  last_screened_at: "2026-08-01T00:00:00.000Z",
  refresh_due_at: null,
  adjudicated_at: null,
  adjudication_note: null,
  screening_check_id: CHECK_ID,
  error_category: null,
  matches: [{
    id: MATCH_ID, screening_check_id: CHECK_ID, match_type: "sanctions",
    list_name: "DFAT Consolidated List (Australia)", matched_name: "Patrik Exampel",
    score: 0.88, jurisdiction: "AU", status: "open",
  }],
  pep_determination: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  listPartyScreening.mockResolvedValue({ subjects: [subject()], case_pep_determination: null });
});

const renderPanel = (props: Partial<Parameters<typeof PartyScreeningPanel>[0]> = {}) =>
  render(
    <PartyScreeningPanel
      caseId={CASE_ID} canWrite canAdjudicate onChanged={() => {}} {...props}
    />,
  );

describe("PartyScreeningPanel — canonical candidate adjudication", () => {
  it("shows the canonical candidate match so staff can inspect before deciding", async () => {
    renderPanel();
    expect(await screen.findByText("Pat Example")).toBeTruthy();
    expect(screen.getByText(/Patrik Exampel/)).toBeTruthy();
    expect(screen.getByText(/DFAT Consolidated List/)).toBeTruthy();
    expect(screen.getByText(/possible match/)).toBeTruthy();
  });

  it("adjudicates the specific match through the dialog — never window.prompt", async () => {
    adjudicatePartyScreening.mockResolvedValue({ subject: subject({ state: "confirmed_match" }) });
    const promptSpy = vi.spyOn(window, "prompt");
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /confirm/i }));
    // The accessible dialog collects the rationale.
    const note = await screen.findByLabelText(/adjudication rationale/i);
    fireEvent.change(note, { target: { value: "Same DOB and listed alias." } });
    fireEvent.click(screen.getByRole("button", { name: /^confirm match$/i }));
    await waitFor(() => expect(adjudicatePartyScreening).toHaveBeenCalledWith(
      subject().id, MATCH_ID, "confirmed_match", "Same DOB and listed alias.",
    ));
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it("dismissing a candidate resolves that match as a false positive", async () => {
    adjudicatePartyScreening.mockResolvedValue({ subject: subject({ state: "false_positive" }) });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /dismiss/i }));
    const note = await screen.findByLabelText(/adjudication rationale/i);
    fireEvent.change(note, { target: { value: "Different person, DOB mismatch." } });
    fireEvent.click(screen.getByRole("button", { name: /dismiss match/i }));
    await waitFor(() => expect(adjudicatePartyScreening).toHaveBeenCalledWith(
      subject().id, MATCH_ID, "false_positive", "Different person, DOB mismatch.",
    ));
  });

  it("hides adjudication from staff without the adjudication role", async () => {
    renderPanel({ canAdjudicate: false });
    expect(await screen.findByText(/awaiting reviewer\/MLRO/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
  });

  it("surfaces the error state with its category, offering a retry", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [subject({ state: "error", error_category: "list_data_unavailable", matches: [] })],
      case_pep_determination: null,
    });
    renderPanel();
    expect(await screen.findByText("error")).toBeTruthy();
    expect(screen.getByText(/list data unavailable/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry screening/i })).toBeTruthy();
  });
});

describe("PartyScreeningPanel — PEP determination", () => {
  it("flags an outstanding PEP determination and records a not-PEP with methods and rationale", async () => {
    recordPepDetermination.mockResolvedValue({ determination: { id: "x" } });
    renderPanel();
    expect(await screen.findByText(/PEP determination outstanding/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /not a pep/i }));
    fireEvent.change(await screen.findByLabelText(/sources and methods/i), {
      target: { value: "DFAT consolidated list — case screening\nPublic register search" },
    });
    fireEvent.change(screen.getByLabelText(/why the conclusion is reasonable/i), {
      target: { value: "No public office found in any consulted source." },
    });
    fireEvent.click(screen.getByRole("button", { name: /record determination/i }));
    await waitFor(() => expect(recordPepDetermination).toHaveBeenCalled());
    const payload = recordPepDetermination.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.result).toBe("not_pep");
    expect(payload.methods).toEqual([
      { source: "DFAT consolidated list — case screening" },
      { source: "Public register search" },
    ]);
    expect(payload.rationale).toBe("No public office found in any consulted source.");
  });

  it("shows a recorded PEP determination instead of the outstanding flag", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [subject({
        state: "completed", matches: [],
        pep_determination: {
          id: "pd1", party_screening_subject_id: subject().id, subject_name: "Pat Example",
          result: "pep", pep_type: "foreign", pep_relationship: "self",
          determined_at: "2026-08-01T00:00:00.000Z", determined_by_label: "reviewer@example.com",
          review_due_at: "2027-08-01T00:00:00.000Z", superseded_at: null,
        },
      })],
      case_pep_determination: null,
    });
    renderPanel();
    expect(await screen.findByText(/PEP · foreign \(self\)/)).toBeTruthy();
    expect(screen.queryByText(/PEP determination outstanding/)).toBeNull();
  });
});
