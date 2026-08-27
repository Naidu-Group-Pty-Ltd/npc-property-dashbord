/**
 * Stage 8's guided path — the same facts the cards below carry, arranged
 * as numbered steps with one of them open. Derives nothing new: every
 * state comes from `decisionPath.pure.ts`, and the audited actions stay on
 * the cards beneath (this card never records anything).
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CheckCircle2, ChevronRight, CircleDashed, Lock, Minus } from "lucide-react";
import type { DecisionStep } from "@/lib/aml/decisionPath.pure";

function StepIcon({ state }: { state: DecisionStep["state"] }) {
  if (state === "done") return <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />;
  if (state === "settled") return <Minus className="h-4 w-4 text-muted-foreground" aria-hidden />;
  if (state === "blocked") return <Lock className="h-4 w-4 text-warning" aria-hidden />;
  if (state === "current") return <ChevronRight className="h-4 w-4 text-primary" aria-hidden />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground/60" aria-hidden />;
}

const STATE_LABEL: Record<DecisionStep["state"], string> = {
  done: "Done",
  current: "Next",
  outstanding: "Later",
  blocked: "Blocked",
  settled: "—",
};

export function DecisionPathCard({ steps }: { steps: DecisionStep[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">The decision, in order</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-1.5">
          {steps.map((step, i) => (
            <li
              key={step.key}
              className={cn(
                "flex items-start gap-2.5 rounded-md border p-2.5",
                step.state === "current"
                  ? "border-primary/40 bg-primary/5"
                  : step.state === "blocked"
                    ? "border-warning/40 bg-warning/5"
                    : "border-border/50",
              )}
            >
              <span className="mt-0.5 shrink-0"><StepIcon state={step.state} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium">{i + 1}. {step.label}</span>
                  <span className={cn(
                    "text-[11px] uppercase tracking-wide",
                    step.state === "current" ? "text-primary"
                      : step.state === "blocked" ? "text-warning"
                        : "text-muted-foreground",
                  )}>
                    {STATE_LABEL[step.state]}
                  </span>
                </span>
                <span className="block text-xs text-muted-foreground">{step.detail}</span>
                {step.blockedBy && (
                  <span className="block text-xs text-warning">{step.blockedBy}.</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
