/**
 * Stage 5, explained: what it requires, whether it can run, and what happens
 * next. Placed above the screening panels because an operator who cannot run
 * a check needs to know why before they press the button that refuses.
 *
 * Three things this card is careful about, each of which was a real defect:
 *
 *  • It never says PEP screening is "not required", "waived" or "exempt".
 *    PEP and targeted financial sanctions are mandatory determinations that
 *    get ESTABLISHED. A client's declaration is evidence that may support the
 *    determination; it is never the determination.
 *
 *  • It separates "the check can execute" from "the stage is complete". Those
 *    fail independently — a healthy provider with no results is executable and
 *    not complete — and showing one in place of the other is how a case with
 *    no screening evidence came to look finished.
 *
 *  • It states no outcome it has not been given. It never renders "clear", it
 *    never renders "no match", and a blocked provider produces a blocker, not
 *    a blank.
 *
 * It is a reading. Every action it points at lives in the panels below and is
 * authorised by the server, which fails closed on its own freshness gate
 * whatever this card says.
 */
import {
  AlertTriangle, CheckCircle2, Clock, Info, Loader2, ShieldAlert, ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AmlScreeningStageReading } from "@/lib/aml/useScreeningStage";

const OWNER_LABEL: Record<string, string> = {
  system: "the screening engine",
  analyst: "a compliance analyst",
  reviewer: "a reviewer or the MLRO",
  administrator: "an administrator",
  none: "nobody — this stage is settled",
};

function DeterminationRow({
  label, detail, resolved, basis,
}: { label: string; detail: string; resolved: boolean; basis?: string }) {
  const Icon = resolved ? CheckCircle2 : Clock;
  return (
    <li className="flex items-start gap-2.5 border-b border-border/50 py-2 last:border-0">
      <Icon
        aria-hidden
        className={cn("mt-0.5 h-4 w-4 shrink-0",
          resolved ? "text-success" : "text-muted-foreground")}
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          <Badge variant={resolved ? "secondary" : "outline"} className="text-[10px]">
            {resolved ? "determined" : "outstanding"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{detail}</p>
        {basis && <p className="mt-0.5 text-[11px] text-muted-foreground/80">{basis}</p>}
      </div>
    </li>
  );
}

export function ScreeningStageCard({ reading }: { reading: AmlScreeningStageReading }) {
  const { readiness, scope, position, stage, loading } = reading;

  return (
    <Card className={cn("border", scope.escalation && "border-destructive/40 bg-destructive/5")}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              {scope.escalation
                ? <ShieldAlert aria-hidden className="h-4 w-4 text-destructive" />
                : <ShieldCheck aria-hidden className="h-4 w-4 text-primary" />}
              {stage.headline}
            </CardTitle>
            <CardDescription>{stage.detail}</CardDescription>
          </div>
          {loading && <Loader2 aria-label="Loading screening position" className="h-4 w-4 animate-spin" />}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/*
          Executing and completing, side by side and never conflated. The
          labels say which question each answers.
        */}
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-md border border-border/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Can the checks run?
            </p>
            <p className="mt-1 text-sm font-medium">
              {scope.canExecute ? "Yes — the provider is live and its lists are current"
                : readiness.label}
            </p>
            {!scope.canExecute && readiness.blockers.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {readiness.blockers.map((b) => (
                  <li key={b} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-md border border-border/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Is Stage 5 complete?
            </p>
            <p className="mt-1 text-sm font-medium">
              {scope.canAdvance
                ? "Yes — every required determination is recorded"
                : scope.outstanding.length === 1
                  ? "No — one determination is outstanding"
                  : `No — ${scope.outstanding.length} determinations are outstanding`}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Waiting on {OWNER_LABEL[scope.owner] ?? scope.owner}.
            </p>
          </div>
        </div>

        {scope.escalation && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
            <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{scope.escalation}</p>
          </div>
        )}

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Required determinations
          </p>
          <ul className="mt-1">
            {scope.determinations.map((d) => (
              <DeterminationRow
                key={d.scope} label={d.label} detail={d.detail}
                resolved={d.resolved} basis={d.basis}
              />
            ))}
          </ul>
        </div>

        {/*
          A control the risk policy stood down is shown with the basis it was
          stood down on — never as "the client said no", and never for PEP or
          sanctions, which cannot appear here.
        */}
        {scope.notRequiredByPolicy.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Not proportionate for this case
            </p>
            <ul className="mt-1 space-y-1">
              {scope.notRequiredByPolicy.map((w) => (
                <li key={w.scope} className="flex items-start gap-2 py-1">
                  <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {w.scope === "adverse_media" ? "Adverse media" : "Internal watchlists"}
                    </span>
                    {" — "}{w.basis}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Who is being screened — the server's own subject list, not one
            this browser maintains. */}
        {position.read && position.subjects.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Parties in scope
            </p>
            <ul className="mt-1">
              {position.subjects.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 py-1.5 last:border-0">
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
          </div>
        )}

        <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 p-3">
          <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              What happens next
            </p>
            <p className="mt-0.5 text-sm">{stage.whatHappensNext}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
