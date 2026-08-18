/**
 * Stage 5's one card: what happens next, and why.
 *
 * ── What it replaces ──────────────────────────────────────────────────
 * Three panels that each said a different kind of nothing. "No screening
 * subjects recorded." "Screening has not been run." "No screening checks yet
 * for this case", over a **Run screening** button that had nobody to run
 * against. Beside them, a panel telling the operator to go resolve declared
 * parties — on a case that declared none. The reasonable conclusion from
 * that screen was "this client must not need screening", and it was wrong:
 * nobody had ever been enrolled.
 *
 * So this card leads with exactly ONE action, chosen server-side by what
 * actually blocks the stage, with the button that performs it. Everything
 * else — scope, parties, determinations — is evidence underneath it.
 *
 * ── What it will not do ───────────────────────────────────────────────
 * It never says PEP or sanctions are waived, exempt or not required: those
 * are mandatory determinations that get established. It never renders
 * "clear" or "no match" — it states no outcome it was not given. And
 * completing the stage is not a service-gate approval, which it says on the
 * page rather than leaving to be assumed.
 */
import { useState } from "react";
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock, Info, Loader2, ShieldAlert,
  ShieldCheck, Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AmlScreeningNextAction } from "@/lib/aml/amlCasesApi";
import type { AmlScreeningStageReading } from "@/lib/aml/useScreeningStage";
import { deriveScreeningStatus } from "@/lib/aml/screeningStatus.pure";

const OWNER_LABEL: Record<string, string> = {
  system: "Handled automatically",
  analyst: "You",
  reviewer: "A reviewer or the MLRO",
  administrator: "An administrator",
  client: "The client",
  none: "Nobody — this stage is settled",
};

/** Tone follows urgency, not sentiment: nothing here is decorative. */
const TONE: Record<string, { surface: string; text: string; Icon: typeof Info }> = {
  escalate: { surface: "border-destructive/40 bg-destructive/10", text: "text-destructive", Icon: ShieldAlert },
  adjudicate_match: { surface: "border-destructive/40 bg-destructive/10", text: "text-destructive", Icon: ShieldAlert },
  fix_provider: { surface: "border-warning/40 bg-warning/10", text: "text-warning", Icon: AlertTriangle },
  screening_stalled: { surface: "border-warning/40 bg-warning/10", text: "text-warning", Icon: AlertTriangle },
  await_submission: { surface: "border-border bg-muted/40", text: "text-muted-foreground", Icon: Clock },
  await_provider_result: { surface: "border-border bg-muted/40", text: "text-muted-foreground", Icon: Loader2 },
  enrol_subjects: { surface: "border-border bg-muted/40", text: "text-muted-foreground", Icon: Users },
  none: { surface: "border-success/40 bg-success/10", text: "text-success", Icon: CheckCircle2 },
};
const DEFAULT_TONE = { surface: "border-primary/40 bg-primary/5", text: "text-primary", Icon: ArrowRight };

/** The five statuses, toned by whether they hold the journey. */
const STATUS_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "secondary",
  not_required: "secondary",
  in_progress: "outline",
  required: "outline",
  manual_review: "destructive",
};

const SCOPE_LABEL: Record<string, string> = {
  sanctions: "Targeted financial sanctions",
  pep: "Politically exposed person",
  adverse_media: "Adverse media",
  watchlist: "Internal watchlists",
};

export function ScreeningStageCard({
  reading, onAct, canAct,
}: {
  reading: AmlScreeningStageReading;
  /** Performs the one action. The card never mutates anything itself. */
  onAct: (action: AmlScreeningNextAction) => void | Promise<void>;
  canAct: boolean;
}) {
  const { sync, readiness, scope, position, loading, unavailable } = reading;
  const [busy, setBusy] = useState(false);

  if (loading && !sync) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          Reading this case&rsquo;s screening position…
        </CardContent>
      </Card>
    );
  }

  // An unread position is not a settled one. It says so, and offers a retry
  // rather than an action built on a hole.
  if (unavailable || !sync) {
    return (
      <Card className="border-warning/40 bg-warning/5">
        <CardContent className="space-y-2 p-5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle aria-hidden className="h-4 w-4 text-warning" />
            This case&rsquo;s screening position could not be read
          </p>
          <p className="text-sm text-muted-foreground">
            Nothing about the stage can be reported from a failed read — it is not
            evidence that screening is complete, and it is not evidence that it is
            outstanding.
          </p>
          <Button size="sm" variant="outline" onClick={reading.reload}>Try again</Button>
        </CardContent>
      </Card>
    );
  }

  const action = sync.next_action;
  const status = deriveScreeningStatus(sync.subjects);
  const tone = TONE[action.key] ?? DEFAULT_TONE;
  const { Icon } = tone;
  const stoodDown = sync.policy.notRequired ?? [];
  const answers = Object.entries(sync.policy.evidence ?? {});

  const act = async () => {
    setBusy(true);
    try { await onAct(action); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {/* ── The one action ──────────────────────────────────────────── */}
      <Card className={cn("border", tone.surface)}>
        <CardContent className="p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <Icon aria-hidden className={cn("h-4 w-4", tone.text,
              action.key === "await_provider_result" && "animate-spin motion-reduce:animate-none")} />
            <p className={cn("text-[11px] font-semibold uppercase tracking-[0.08em]", tone.text)}>
              {action.key === "none" ? "Stage complete" : "Next action"}
            </p>
          </div>
          {/*
            The status vocabulary the compliance team actually uses, stated
            explicitly. Three surfaces used to describe this stage and none
            agreed — an MLRO reading three answers to one question cannot tell
            whether screening happened. It is derived once, in
            `screeningStatus.pure.ts`, and rendered identically everywhere.
          */}
          <div className="mt-2">
            <Badge
              variant={STATUS_TONE[status.status] ?? "outline"}
              className="text-[11px]"
            >
              {status.label}
            </Badge>
          </div>
          <h3 className="mt-1.5 text-lg font-semibold">{action.headline}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{action.detail}</p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {action.label && canAct && (
              <Button size="sm" onClick={() => void act()} disabled={busy}>
                {busy && <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />}
                {action.label}
                {!busy && <ArrowRight aria-hidden className="ml-1.5 h-4 w-4" />}
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {OWNER_LABEL[action.owner] ?? action.owner}
              {action.owner === "client" && " — no staff action is required"}
            </span>
          </div>

          {/* The blockers behind a provider fault: an operator cannot act on
              one boolean. */}
          {action.key === "fix_provider" && readiness.blockers.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-border/50 pt-3">
              {readiness.blockers.map((b) => (
                <li key={b} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}

          {scope.escalation && action.key !== "escalate" && (
            <p className="mt-3 flex items-start gap-2 border-t border-destructive/30 pt-3 text-sm text-destructive">
              <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              {scope.escalation}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── The scope, and the answers that produced it ──────────────── */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Screening scope
              </p>
              <p className="mt-0.5 text-sm font-medium">{sync.policy.summary}</p>
            </div>
            <Badge variant="outline" className="text-[10px]">
              policy {sync.policy.policyVersion}
            </Badge>
          </div>

          {/*
            Rendered from the SERVER's per-scope decision, not from a
            derivation here. Three states, and the difference between the
            last two is the whole point of this screen:

              required      an obligation exists
              not required  no obligation arose — nobody was screened
              (never)       screened and clear, which is a RESULT and lives
                            with the subject below, not in this list
          */}
          <ul className="space-y-1.5">
            {(sync.scopes ?? []).map((sc) => (
              <li key={sc.scope} className="flex items-start gap-2 text-sm">
                {sc.required ? (
                  <ShieldCheck aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                ) : (
                  <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span>
                  <span className="font-medium">{SCOPE_LABEL[sc.scope] ?? sc.scope}</span>
                  <span className="text-muted-foreground">
                    {sc.required ? " — required" : " — not required"}
                  </span>
                  {!sc.required && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {sc.reason}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {/*
            The perimeter finding that produced an exemption, named with the
            person who recorded it. An exemption nobody can attribute is not
            one anybody can defend.
          */}
          {sync.perimeter?.classification === "outside_perimeter" && (
            <p className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Outside the sanctions perimeter.</span>{" "}
              Recorded{sync.perimeter.recorded_by_label
                ? ` by ${sync.perimeter.recorded_by_label}` : ""}
              {sync.perimeter.recorded_at
                ? ` on ${new Date(sync.perimeter.recorded_at).toLocaleDateString()}` : ""}
              {sync.perimeter.reason_code ? ` (${sync.perimeter.reason_code})` : ""}.
              This is a statement about obligation, not a screening result.
            </p>
          )}

          {/*
            The answers the decision rests on, on the page rather than in a
            log. This is the audit trail an operator can check without
            leaving the case — and the thing that makes a reduced scope
            reviewable rather than mysterious.
          */}
          {answers.length > 0 && (
            <details className="rounded-md border border-border/60 p-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                The client&rsquo;s answers this decision was made on
              </summary>
              <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                {answers.map(([field, value]) => (
                  <div key={field} className="flex items-baseline justify-between gap-2 text-xs">
                    <dt className="text-muted-foreground">{field}</dt>
                    <dd className="font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Recorded on the case audit trail under AML/CTF policy {sync.policy.policyVersion}.
                A declaration is evidence that supports a determination; it is never the
                determination and never an exemption from making one.
              </p>
            </details>
          )}
        </CardContent>
      </Card>

      {/* ── Who is in scope ─────────────────────────────────────────── */}
      {position.subjects.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Parties in scope
            </p>
            {sync.enrolled > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {sync.enrolled} enrolled automatically from this case&rsquo;s own record.
              </p>
            )}
            <ul className="mt-2">
              {position.subjects.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 py-1.5 last:border-0"
                >
                  <span className="min-w-0 text-sm">
                    {s.name}
                    <span className="text-xs text-muted-foreground">
                      {" · "}{s.partyType.replace(/_/g, " ")}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {!s.required
                      ? <Badge variant="secondary" className="text-[10px]">not in scope</Badge>
                      : (
                        <>
                          <Badge variant={s.sanctions.resolved ? "secondary" : "outline"} className="text-[10px]">
                            sanctions · {s.sanctions.state.replace(/_/g, " ")}
                          </Badge>
                          <Badge variant={s.pep.resolved ? "secondary" : "outline"} className="text-[10px]">
                            PEP · {s.pep.resolved ? "determined" : "outstanding"}
                          </Badge>
                        </>
                      )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
