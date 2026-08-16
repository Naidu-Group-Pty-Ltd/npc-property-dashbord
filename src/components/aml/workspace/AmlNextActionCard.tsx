/**
 * The one dominant thing on the Overview: what to do next.
 *
 * It is guidance, and it says so. The value is recomputed from canonical
 * state on every render by `deriveAmlNextAction`; it is not stored, it is
 * not an authority, and following it changes nothing on its own — the
 * button routes to the section where the existing, server-authorised action
 * lives.
 *
 * When the reading is partial (an evidence read failed, or a role may not
 * make it) the card says which facts are missing rather than presenting a
 * confident answer built on a hole.
 */
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AmlAttentionLevel, AmlNextAction, AmlWorkspaceSection } from "@/lib/aml/workspaceViewModel";

import { ATTENTION_SURFACE, ATTENTION_TEXT } from "./attentionTone";

const HEADINGS: Record<AmlAttentionLevel, string> = {
  critical: "Action required",
  attention: "Action required",
  waiting: "Waiting on",
  steady: "Up to date",
  none: "Nothing outstanding",
};

const ICONS: Record<AmlAttentionLevel, typeof Info> = {
  critical: AlertTriangle,
  attention: AlertTriangle,
  waiting: Clock,
  steady: CheckCircle2,
  none: CheckCircle2,
};

/** The ten stages, by their position. Labels only — routing is the action's. */
const STAGE_NAMES: Record<number, string> = {
  1: "Activation", 2: "Client intake", 3: "Identity verification",
  4: "Documents & evidence", 5: "Screening & ownership", 6: "Funding & transaction",
  7: "Submission review", 8: "Decision", 9: "Gate & passport",
  10: "Distribution & monitoring",
};

export function AmlNextActionCard({
  action,
  onOpenSection,
  className,
  currentStageOrder,
}: {
  action: AmlNextAction;
  onOpenSection: (section: AmlWorkspaceSection) => void;
  className?: string;
  /** Where the operator is standing, so a jump forward can be named. */
  currentStageOrder?: number;
  /**
   * Reopen a closed case. Provided only where the caller can authorise it —
   * a closed case is otherwise a dead end, because `closed` is terminal in
   * the transition table by design.
   */
  onReopen?: () => void;
}) {
  const Icon = ICONS[action.attention];
  const actionable = action.key !== "none" && action.key !== "review_case";

  return (
    <Card className={cn("border", ATTENTION_SURFACE[action.attention], className)}>
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <Icon aria-hidden className={cn("h-4 w-4", ATTENTION_TEXT[action.attention])} />
          <p
            className={cn(
              "text-[11px] font-semibold uppercase tracking-[0.08em]",
              ATTENTION_TEXT[action.attention],
            )}
          >
            {HEADINGS[action.attention]}
          </p>
          {action.blocking && (
            <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Blocking
            </span>
          )}
        </div>

        <h2 className="mt-2 text-lg font-semibold tracking-tight sm:text-xl">{action.label}</h2>
        <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">{action.explanation}</p>

        {/*
          Where this action lives, always. "Go to it" used to move the
          operator without saying where — and because the winner was picked in
          rule-authorship order rather than journey order, it could land five
          stages ahead of the work that was actually outstanding. The stage is
          named on the button now, so a move is never unlabelled.
        */}
        {action.actionType === "reopen_case" && onReopen && (
          <div className="mt-4">
            <Button size="sm" onClick={onReopen}>
              Reopen case <ArrowRight aria-hidden className="ml-1.5 h-3.5 w-3.5" />
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Documents, verifications, determinations and the questionnaire are kept.
              A terminated service gate stays terminated.
            </p>
          </div>
        )}

        {actionable && (
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button size="sm" onClick={() => onOpenSection(action.section)}>
              Go to stage {action.stageOrder}
              {STAGE_NAMES[action.stageOrder] ? ` · ${STAGE_NAMES[action.stageOrder]}` : ""}
              <ArrowRight aria-hidden className="ml-1.5 h-3.5 w-3.5" />
            </Button>
            {typeof currentStageOrder === "number"
              && action.stageOrder > currentStageOrder + 1 && (
              <span className="text-xs text-muted-foreground">
                Stages {currentStageOrder + 1}–{action.stageOrder - 1} have nothing
                outstanding on this reading.
              </span>
            )}
          </div>
        )}

        {action.partial && (
          <p className="mt-4 border-t border-border/50 pt-3 text-xs text-muted-foreground">
            This reading is partial — {action.unavailableFacts.join(", ")}{" "}
            {action.unavailableFacts.length === 1 ? "was" : "were"} not available. Work through the
            sections directly to confirm.
          </p>
        )}

        {!action.partial && action.sourceFacts.length > 0 && actionable && (
          <p className="mt-4 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
            <span className="font-medium">Based on:</span> {action.sourceFacts.join(" · ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
