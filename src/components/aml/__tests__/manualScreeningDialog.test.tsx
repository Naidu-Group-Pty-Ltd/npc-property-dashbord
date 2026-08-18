import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManualScreeningDialog } from "../ManualScreeningDialog";
import { PartyScreeningPanel } from "../PartyScreeningPanel";
import type { AmlPartyScreeningSubject } from "@/lib/aml/amlCasesApi";

/**
 * The operator side of manual screening.
 *
 * Two things are being pinned. The dialog must not let a "no match" be
 * recorded without the sources checked, the names searched and a rationale —
 * and it must refuse for the SAME reason the server would, because a form
 * that disagrees with the server either blocks legitimate work or promises
 * work the server then rejects.
 *
 * And the control must be offered only to the MLRO, only where there is an
 * obligation to discharge, and never as an alternative to the obligation. It
 * appears when the provider is blocked as well as when it is not: a blocked
 * provider is precisely when screening by hand is the remedy.
 */

const listPartyScreening = vi.fn();
const queuePartyScreening = vi.fn();
const runOptionalScreening = vi.fn();
const adjudicatePartyScreening = vi.fn();
const recordPepDetermination = vi.fn();
const recordManualScreening = vi.fn();

vi.mock("@/lib/aml/amlCasesApi", () => ({
  amlCasesApi: {
    listPartyScreening: (...a: unknown[]) => listPartyScreening(...a),
    queuePartyScreening: (...a: unknown[]) => queuePartyScreening(...a),
    runOptionalScreening: (...a: unknown[]) => runOptionalScreening(...a),
    adjudicatePartyScreening: (...a: unknown[]) => adjudicatePartyScreening(...a),
    recordPepDetermination: (...a: unknown[]) => recordPepDetermination(...a),
    recordManualScreening: (...a: unknown[]) => recordManualScreening(...a),
  },
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const SUBJECT_ID = "55555555-5555-4555-8555-555555555555";

const subject = (over: Partial<AmlPartyScreeningSubject> = {}): AmlPartyScreeningSubject => ({
  id: SUBJECT_ID,
  case_id: CASE_ID,
  party_type: "beneficial_owner",
  party_id: null,
  screened_name: "Pat Example",
  required: true,
  state: "not_started",
  last_screened_at: null,
  refresh_due_at: null,
  adjudicated_at: null,
  adjudication_note: null,
  screening_check_id: null,
  error_category: null,
  matches: [],
  pep_determination: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  listPartyScreening.mockResolvedValue({ subjects: [subject()], case_pep_determination: null });
  recordManualScreening.mockResolvedValue({
    check: { id: "c1" }, outcome: "no_match",
    policy_required: true, voluntary: false, satisfies_obligation: true,
  });
});

const renderDialog = (over: Partial<AmlPartyScreeningSubject> = {}) => {
  const onRecorded = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ManualScreeningDialog
      subject={subject(over)} open onOpenChange={onOpenChange} onRecorded={onRecorded}
    />,
  );
  return { onRecorded, onOpenChange };
};

const submitButton = () =>
  screen.getByRole("button", { name: /record manual screening/i });

const fillEvidence = () => {
  fireEvent.change(screen.getByLabelText(/source 1 name/i), {
    target: { value: "DFAT Consolidated List" },
  });
  fireEvent.change(screen.getByLabelText(/why the conclusion is reasonable/i), {
    target: {
      value: "Searched the published consolidated list against the legal name and both "
        + "recorded transliterations; no listing corresponds.",
    },
  });
};

describe("ManualScreeningDialog — the evidence bar the operator meets", () => {
  it("cannot be submitted with no source checked", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/why the conclusion is reasonable/i), {
      target: { value: "A rationale that is comfortably long enough to pass the minimum." },
    });
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(/at least one source that was actually checked/i)).toBeTruthy();
  });

  it("cannot be submitted with no rationale", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/source 1 name/i), {
      target: { value: "DFAT Consolidated List" },
    });
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(/at least 20 characters/i)).toBeTruthy();
  });

  it("cannot be submitted with no name searched", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/names actually searched/i), { target: { value: "" } });
    fillEvidence();
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(/at least one name that was actually searched/i)).toBeTruthy();
  });

  it("pre-fills the name the case actually screens", () => {
    renderDialog();
    expect((screen.getByLabelText(/names actually searched/i) as HTMLTextAreaElement).value)
      .toBe("Pat Example");
  });

  it("enables submission once the evidence is complete", () => {
    renderDialog();
    fillEvidence();
    expect(submitButton()).not.toBeDisabled();
  });

  it("says plainly that a complete no-match will be recorded as performed by the user", () => {
    renderDialog();
    fillEvidence();
    expect(screen.getByText(/recorded as a completed screening, performed by you/i)).toBeTruthy();
  });

  it("sends the structured evidence, not a blob of prose", async () => {
    const { onRecorded } = renderDialog();
    fillEvidence();
    fireEvent.click(submitButton());
    await waitFor(() => expect(recordManualScreening).toHaveBeenCalled());
    const payload = recordManualScreening.mock.calls[0][0];
    expect(payload.subject_id).toBe(SUBJECT_ID);
    expect(payload.outcome).toBe("no_match");
    expect(payload.sources[0].source_name).toBe("DFAT Consolidated List");
    expect(payload.searched_names).toEqual(["Pat Example"]);
    expect(onRecorded).toHaveBeenCalled();
  });

  it("never sends who performed it, when, or whether policy required it", async () => {
    renderDialog();
    fillEvidence();
    fireEvent.click(submitButton());
    await waitFor(() => expect(recordManualScreening).toHaveBeenCalled());
    const payload = recordManualScreening.mock.calls[0][0];
    for (const forbidden of [
      "performed_by", "performed_at", "policy_required", "voluntary",
      "required", "case_id", "status",
    ]) {
      expect(payload).not.toHaveProperty(forbidden);
    }
  });

  it("reports a server refusal instead of claiming success", async () => {
    recordManualScreening.mockRejectedValueOnce(new Error("MLRO role required"));
    const { onRecorded } = renderDialog();
    fillEvidence();
    fireEvent.click(submitButton());
    await waitFor(() => expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" })));
    expect(onRecorded).not.toHaveBeenCalled();
  });
});

describe("ManualScreeningDialog — unable to complete", () => {
  const chooseUnable = () =>
    fireEvent.click(screen.getByRole("radio", { name: /^unable to complete/i }));

  it("drops the evidence fields and asks why instead", () => {
    renderDialog();
    chooseUnable();
    expect(screen.queryByLabelText(/source 1 name/i)).toBeNull();
    expect(screen.getByText(/why it could not be concluded/i)).toBeTruthy();
  });

  it("is submittable with a reason and no evidence", async () => {
    recordManualScreening.mockResolvedValueOnce({
      check: { id: "c1" }, outcome: "unable_to_complete",
      policy_required: true, voluntary: false, satisfies_obligation: false,
    });
    renderDialog();
    chooseUnable();
    expect(submitButton()).not.toBeDisabled();
    fireEvent.click(submitButton());
    await waitFor(() => expect(recordManualScreening).toHaveBeenCalled());
    expect(recordManualScreening.mock.calls[0][0].unable_reason).toBe("insufficient_identity");
  });

  it("tells the operator the obligation is still outstanding", () => {
    renderDialog();
    chooseUnable();
    expect(screen.getByText(/does not discharge the screening obligation/i)).toBeTruthy();
  });
});

describe("ManualScreeningDialog — a match goes to the shared adjudication", () => {
  it("asks what matched, and refuses until it is named", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: /^possible match/i }));
    fillEvidence();
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(/record the listed name that matched/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/candidate 1 listed name/i), {
      target: { value: "Patrik Exampel" },
    });
    expect(submitButton()).not.toBeDisabled();
  });

  it("does not claim the obligation is discharged by a finding", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: /^possible match/i }));
    fillEvidence();
    fireEvent.change(screen.getByLabelText(/candidate 1 listed name/i), {
      target: { value: "Patrik Exampel" },
    });
    expect(screen.getByText(/does not discharge the screening obligation/i)).toBeTruthy();
  });
});

describe("PartyScreeningPanel — who is offered manual screening, and when", () => {
  const renderPanel = (props: Partial<Parameters<typeof PartyScreeningPanel>[0]> = {}) =>
    render(
      <PartyScreeningPanel
        caseId={CASE_ID} canWrite canAdjudicate onChanged={() => {}} {...props}
      />,
    );

  it("is not offered to a reviewer who is not the MLRO", async () => {
    renderPanel({ isMlro: false });
    await screen.findByText("Pat Example");
    expect(screen.queryByRole("button", { name: /screen manually/i })).toBeNull();
  });

  it("is offered to the MLRO", async () => {
    renderPanel({ isMlro: true });
    expect(await screen.findByRole("button", { name: /screen manually/i })).toBeTruthy();
  });

  it("is offered even when the provider blocks the automated path", async () => {
    renderPanel({ isMlro: true, screeningBlocked: "Screening cannot run — see the action above" });
    expect(await screen.findByRole("button", { name: /screen manually/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /start screening/i })).toBeNull();
  });

  it("is NOT offered where the policy requires no screening at all", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [subject({ state: "not_required" })], case_pep_determination: null,
    });
    renderPanel({ isMlro: true });
    await screen.findByText("Pat Example");
    expect(screen.queryByRole("button", { name: /screen manually/i })).toBeNull();
  });

  it("is NOT offered while an automated run is in flight", async () => {
    for (const state of ["queued", "processing"]) {
      listPartyScreening.mockResolvedValue({
        subjects: [subject({ state })], case_pep_determination: null,
      });
      const view = renderPanel({ isMlro: true });
      await screen.findByText("Pat Example");
      expect(screen.queryByRole("button", { name: /screen manually/i })).toBeNull();
      view.unmount();
    }
  });

  it("opens the dialog in one click", async () => {
    renderPanel({ isMlro: true });
    fireEvent.click(await screen.findByRole("button", { name: /screen manually/i }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(within(screen.getByRole("dialog"))
      .getByText(/not a way of\s+standing it down/i)).toBeTruthy();
  });

  it("says on the row that the current position was reached by hand", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [subject({ state: "completed", screening_method: "manual" })],
      case_pep_determination: null,
    });
    renderPanel({ isMlro: true });
    expect(await screen.findByText(/screened manually by the MLRO/i)).toBeTruthy();
  });

  it("renders one history, with the sources and names a manual attempt carries", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [subject({
        state: "completed", screening_method: "manual",
        manual_checks: [{
          id: "c1", scope: ["sanctions"], status: "clear", manual_outcome: "no_match",
          unable_reason: null,
          rationale: "No listing corresponds to this party.",
          sources_checked: [{ source_type: "sanctions_list", source_name: "DFAT Consolidated List" }],
          searched_names: ["Pat Example"],
          performed_at: "2026-08-18T00:00:00.000Z",
          policy_required: true, voluntary: false,
        }],
      })],
      case_pep_determination: null,
    });
    renderPanel({ isMlro: true });
    expect(await screen.findByText(/sources: DFAT Consolidated List/i)).toBeTruthy();
    expect(screen.getByText(/names searched: Pat Example/i)).toBeTruthy();
    expect(screen.getByText(/No listing corresponds to this party\./i)).toBeTruthy();
  });

  it("marks a voluntary manual check as not required under policy", async () => {
    listPartyScreening.mockResolvedValue({
      subjects: [subject({
        state: "completed",
        manual_checks: [{
          id: "c1", scope: ["sanctions"], status: "clear", manual_outcome: "no_match",
          unable_reason: null, rationale: null, sources_checked: [], searched_names: [],
          performed_at: "2026-08-18T00:00:00.000Z", policy_required: false, voluntary: true,
        }],
      })],
      case_pep_determination: null,
    });
    renderPanel({ isMlro: true });
    expect(await screen.findByText(/not required under policy/i)).toBeTruthy();
  });
});
