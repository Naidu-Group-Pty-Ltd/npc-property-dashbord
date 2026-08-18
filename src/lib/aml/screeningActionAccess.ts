/**
 * Who may actually perform Stage 5's one offered action.
 *
 * ── The mismatch this closes ──────────────────────────────────────────
 * The card took a single `canAct` boolean, and the workspace passed
 * `canWrite` — analyst, reviewer or MLRO. That was right for most actions
 * and wrong for the two that are compliance acts rather than data entry:
 * classifying the sanctions perimeter and adjudicating a match are both
 * reviewer-or-MLRO on the server, so an analyst was shown a prominent
 * button for work the server would refuse.
 *
 * A CTA that cannot succeed is worse than no CTA: it reads as the step that
 * unblocks the case, and the person who presses it learns otherwise only
 * from an error — or, when the click merely scrolls, learns nothing at all.
 *
 * ── What this is not ──────────────────────────────────────────────────
 * It is presentation. The server enforces every one of these independently
 * and is unchanged; nothing here grants anything. Its only job is to stop
 * the interface offering work the caller cannot do, and to say who can.
 */
import type { AmlScreeningNextAction } from "./amlCasesApi";

export interface ScreeningActor {
  /** analyst, reviewer or MLRO — the existing Stage 5 write rule. */
  canWrite: boolean;
  isReviewer: boolean;
  isMlro: boolean;
}

/** Actions that are a compliance determination, not case work. */
const REVIEWER_OR_MLRO: ReadonlyArray<AmlScreeningNextAction["key"]> = [
  // Standing down a sanctions obligation, or deciding it applies.
  "classify_perimeter",
  // Confirming or dismissing a candidate against a sanctions listing.
  "adjudicate_match",
] as const;

export function canPerformScreeningAction(
  key: AmlScreeningNextAction["key"],
  actor: ScreeningActor,
): boolean {
  if (REVIEWER_OR_MLRO.includes(key)) return actor.isReviewer || actor.isMlro;
  return actor.canWrite;
}

/**
 * What to tell somebody who cannot perform it — so the stage still says what
 * has to happen, and by whom, instead of going quiet.
 */
export function screeningActionDeniedNote(
  key: AmlScreeningNextAction["key"],
): string | null {
  if (!REVIEWER_OR_MLRO.includes(key)) return null;
  return key === "classify_perimeter"
    ? "A reviewer or the MLRO must classify this case."
    : "A reviewer or the MLRO must adjudicate this match.";
}

/** The headline an unauthorised viewer sees instead of the action's own. */
export function screeningActionDeniedHeadline(
  key: AmlScreeningNextAction["key"],
): string | null {
  return key === "classify_perimeter" ? "Classification required" : null;
}
