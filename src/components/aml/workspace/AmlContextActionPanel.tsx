/**
 * The right rail, contextual to the area the operator is in.
 *
 * ── What this does and does not do ────────────────────────────────────
 * It invents no server operation. The only mutation it performs is the
 * case status transition the previous action panel already performed,
 * through the same `amlCasesApi.transition` call, with the same legal
 * transition map (mirrored server-side), the same separation of
 * attention-raising and destructive options, and the same required,
 * confirmed reason for Blocked and Closed.
 *
 * Everything else in the rail is context and navigation: what is
 * outstanding in *this* area, and a way to get to the section where the
 * existing, server-authorised control already lives. Hiding a button was
 * never authorisation and still is not — the server decides.
 */
import { useState } from "react";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";

import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { amlCasesApi, type AmlCase, type AmlCaseStatus } from "@/lib/aml/amlCasesApi";
import { CASE_STATUS_LABELS } from "@/lib/aml/caseDimensions";
import { cn } from "@/lib/utils";
import {
  AREA_LABELS,
  AREA_SECTIONS,
  areaForSection,
  type AmlNextAction,
  type AmlOutstandingItem,
  type AmlServiceReadiness,
  type AmlWorkspaceArea,
  type AmlWorkspaceSection,
} from "@/lib/aml/workspaceViewModel";

import { ATTENTION_EDGE } from "./attentionTone";
import { SECTION_LABELS } from "./workspaceLabels";

/**
 * The legal transition map. Unchanged from the panel this replaces and
 * mirrored by the server, which remains authoritative.
 */
const NEXT_STATUSES: Record<AmlCaseStatus, AmlCaseStatus[]> = {
  draft: ["kyc_in_progress", "closed"],
  kyc_in_progress: ["kyc_complete", "edd_required", "blocked", "closed"],
  kyc_complete: ["under_review", "edd_required", "cleared", "closed"],
  edd_required: ["under_review", "escalated_mlro", "blocked", "closed"],
  under_review: ["cleared", "escalated_mlro", "edd_required", "blocked", "closed"],
  escalated_mlro: ["cleared", "blocked", "closed"],
  cleared: ["under_review", "closed"],
  blocked: ["under_review", "closed"],
  closed: [],
};

const PANEL_ATTENTION_TRANSITIONS = new Set<AmlCaseStatus>(["edd_required"]);
const PANEL_DESTRUCTIVE_TRANSITIONS = new Set<AmlCaseStatus>(["blocked", "closed"]);

const PANEL_DESTRUCTIVE_COPY: Partial<Record<AmlCaseStatus, { title: string; body: string; action: string }>> = {
  blocked: {
    title: "Block this case?",
    body: "Blocking locks the service gate and stops the client's onboarding until the case is re-reviewed. Record why this case is being blocked — the reason is written to the tamper-evident audit trail.",
    action: "Block case",
  },
  closed: {
    title: "Close this case?",
    body: "Closing ends this AML/CTF case. A closed case cannot be advanced further. Record why this case is being closed — the reason is written to the tamper-evident audit trail.",
    action: "Close case",
  },
};

/**
 * Where the work for each area is done. Purely a set of shortcuts into
 * sections that already exist; every control in them is unchanged.
 */
const AREA_SHORTCUTS: Record<AmlWorkspaceArea, Array<{ section: AmlWorkspaceSection; label: string }>> = {
  overview: [
    { section: "requests", label: "Ask the client for something" },
    { section: "risk", label: "Open risk & decision" },
  ],
  customer: [
    { section: "identity", label: "Identity verification & screening" },
    { section: "ownership", label: "Ownership & control" },
    { section: "requests", label: "Request information" },
  ],
  transaction: [
    { section: "documents", label: "Documents & evidence" },
    { section: "finance", label: "Funding & finance" },
    { section: "submission-review", label: "Submission review" },
  ],
  decision: [
    { section: "risk", label: "Risk, decision & service gate" },
    { section: "identity", label: "Check the evidence behind it" },
  ],
  records: [
    { section: "passport", label: "Compliance passport & partners" },
    { section: "monitoring", label: "Monitoring & reviews" },
    { section: "timeline", label: "Timeline & audit" },
  ],
};

export interface AmlContextActionPanelProps {
  caseRow: AmlCase;
  section: AmlWorkspaceSection;
  nextAction: AmlNextAction;
  readiness: AmlServiceReadiness;
  outstanding: AmlOutstandingItem[];
  visibleSections: ReadonlySet<AmlWorkspaceSection>;
  canWrite: boolean;
  isMlro: boolean;
  onChanged: () => void;
  onOpenSection: (section: AmlWorkspaceSection) => void;
}

export function AmlContextActionPanel({
  caseRow,
  section,
  nextAction,
  readiness,
  outstanding,
  visibleSections,
  canWrite,
  isMlro,
  onChanged,
  onOpenSection,
}: AmlContextActionPanelProps) {
  const [reason, setReason] = useState("");
  const [transitioning, setTransitioning] = useState(false);
  const [pendingDestructive, setPendingDestructive] = useState<AmlCaseStatus | null>(null);
  const [destructiveReason, setDestructiveReason] = useState("");

  const area = areaForSection(section);
  const areaSectionSet = new Set<string>(AREA_SECTIONS[area]);
  const inThisArea = outstanding.filter((item) => areaSectionSet.has(item.section));
  const shortcuts = AREA_SHORTCUTS[area].filter((s) => visibleSections.has(s.section));

  const nextOptions = NEXT_STATUSES[caseRow.status] ?? [];
  const progressOptions = nextOptions.filter(
    (s) => !PANEL_ATTENTION_TRANSITIONS.has(s) && !PANEL_DESTRUCTIVE_TRANSITIONS.has(s),
  );
  const attentionOptions = nextOptions.filter((s) => PANEL_ATTENTION_TRANSITIONS.has(s));
  const destructiveOptions = nextOptions.filter((s) => PANEL_DESTRUCTIVE_TRANSITIONS.has(s));
  const destructiveCopy = pendingDestructive ? PANEL_DESTRUCTIVE_COPY[pendingDestructive] : null;

  const transition = async (to: AmlCaseStatus, reasonText?: string) => {
    setTransitioning(true);
    try {
      await amlCasesApi.transition(caseRow.id, to, reasonText || undefined);
      toast({
        title: "Status updated",
        description: `${CASE_STATUS_LABELS[caseRow.status]} → ${CASE_STATUS_LABELS[to]}`,
      });
      setReason("");
      setPendingDestructive(null);
      setDestructiveReason("");
      onChanged();
    } catch (e: any) {
      toast({ title: "Transition failed", description: e.message, variant: "destructive" });
    } finally {
      setTransitioning(false);
    }
  };

  return (
    <>
      {/* ── What is outstanding here ───────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {AREA_LABELS[area]}
          </p>

          {area !== "overview" && (
            <div className="mt-2 rounded-md border border-border/60 bg-muted/30 p-2.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Next on this case
              </p>
              <p className="mt-0.5 text-sm font-medium leading-snug">{nextAction.label}</p>
              {nextAction.section !== section && nextAction.key !== "none" && (
                <Button
                  variant="link"
                  size="sm"
                  className="mt-0.5 h-auto p-0 text-xs"
                  onClick={() => onOpenSection(nextAction.section)}
                >
                  Go to {SECTION_LABELS[nextAction.section]}
                  <ArrowRight aria-hidden className="ml-1 h-3 w-3" />
                </Button>
              )}
            </div>
          )}

          {inThisArea.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {inThisArea.map((item) => (
                <li
                  key={item.key}
                  className={cn("border-l-2 pl-2.5", ATTENTION_EDGE[item.attention])}
                >
                  <button
                    type="button"
                    onClick={() => onOpenSection(item.section)}
                    className="text-left text-xs hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Nothing outstanding in this area.
            </p>
          )}

          {shortcuts.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-border/50 pt-3">
              {shortcuts.map((shortcut) => (
                <Button
                  key={shortcut.section}
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full justify-start px-2 text-xs"
                  onClick={() => onOpenSection(shortcut.section)}
                >
                  {shortcut.label}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Service gate, restated compactly away from the Overview ── */}
      {area !== "overview" && (
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Service gate
            </p>
            <p className="mt-1 text-sm font-medium leading-snug">{readiness.label}</p>
            {readiness.reasons.length > 0 && readiness.level !== "ready" && (
              <p className="mt-1 text-xs text-muted-foreground">{readiness.reasons[0]}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Case status transitions ────────────────────────────────── */}
      {canWrite && nextOptions.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Advance status
            </p>
            <Input
              aria-label="Reason for the status change"
              placeholder="Reason (optional)…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={transitioning}
              className="h-8 text-xs"
            />
            <div className="flex flex-wrap gap-1.5">
              {progressOptions.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={transitioning}
                  onClick={() => transition(s, reason)}
                >
                  {CASE_STATUS_LABELS[s]}
                </Button>
              ))}
              {attentionOptions.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant="outline"
                  className="h-7 border-warning/40 text-xs text-warning hover:bg-warning/10 hover:text-warning"
                  disabled={transitioning}
                  onClick={() => transition(s, reason)}
                >
                  {CASE_STATUS_LABELS[s]}
                </Button>
              ))}
            </div>
            {destructiveOptions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
                {destructiveOptions.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant="outline"
                    className="h-7 border-destructive/40 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={transitioning}
                    onClick={() => {
                      setDestructiveReason(reason);
                      setPendingDestructive(s);
                    }}
                  >
                    {CASE_STATUS_LABELS[s]}
                  </Button>
                ))}
              </div>
            )}
            {caseRow.status === "escalated_mlro" && !isMlro && (
              <p className="text-xs text-muted-foreground">
                Escalated decisions can only be recorded by authorised decision-makers.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Destructive transitions keep their confirmed, required reason. */}
      <AlertDialog
        open={!!pendingDestructive}
        onOpenChange={(o) => {
          if (!o) {
            setPendingDestructive(null);
            setDestructiveReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle aria-hidden="true" className="h-5 w-5 text-destructive" />
              {destructiveCopy?.title ?? "Confirm action"}
            </AlertDialogTitle>
            <AlertDialogDescription>{destructiveCopy?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="aml-workspace-destructive-reason">Reason (required)</Label>
            <Textarea
              id="aml-workspace-destructive-reason"
              value={destructiveReason}
              onChange={(e) => setDestructiveReason(e.target.value)}
              rows={3}
              placeholder="Why is this case being blocked or closed?"
              disabled={transitioning}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={transitioning}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={transitioning || !destructiveReason.trim()}
              onClick={() => pendingDestructive && transition(pendingDestructive, destructiveReason.trim())}
            >
              {transitioning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {destructiveCopy?.action ?? "Confirm"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
