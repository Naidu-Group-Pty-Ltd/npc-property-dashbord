/**
 * The five-phase macro rail: COLLECT · VERIFY · ASSESS · DECIDE · MONITOR.
 *
 * It replaces a wrapping row of fourteen pills that gave every step the same
 * visual weight. The detailed fourteen-step rail is unchanged and still
 * canonical — it lives in `caseDimensions.progressRail` and is rendered in
 * Records → Timeline, where the granularity is what you want.
 *
 * Presentation only: the phases come from `deriveAmlMacroPhase`, which reads
 * `case_stage` and `service_gate_status` and stores nothing.
 */
import { AlertTriangle, Check, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AmlMacroPhase, AmlMacroProgress as MacroProgress } from "@/lib/aml/workspaceViewModel";

const STATE_DESCRIPTION: Record<AmlMacroPhase["state"], string> = {
  complete: "complete",
  current: "in progress",
  attention: "needs attention",
  blocked: "blocked",
  not_started: "not started",
};

function PhaseMarker({ state }: { state: AmlMacroPhase["state"] }) {
  if (state === "complete") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success text-success-foreground">
        <Check aria-hidden className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (state === "blocked") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
        <Lock aria-hidden className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (state === "attention") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-warning text-warning">
        <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-primary">
        <span aria-hidden className="h-2 w-2 rounded-full bg-primary" />
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
    </span>
  );
}

export function AmlMacroProgress({
  macro,
  className,
}: {
  macro: MacroProgress;
  className?: string;
}) {
  const currentIndex = macro.phases.findIndex((p) => p.key === macro.phase);
  const current = macro.phases[currentIndex];

  return (
    <>
      {/* ── Phones: five columns leaves ~40px of text per phase, which is
          "CO… VE… AS…" and tells nobody anything. Name the current phase
          in full and reduce the rest to a five-segment bar. ────────── */}
      <div
        className={cn("rounded-lg border border-border/60 bg-card/60 px-3 py-2 sm:hidden", className)}
      >
        <p className="text-xs">
          <span className="font-semibold uppercase tracking-wide">{current?.label}</span>
          <span className="text-muted-foreground">
            {" "}
            · phase {currentIndex + 1} of {macro.phases.length}
          </span>
        </p>
        {/* The line above already names the phase and its position, so the
            bar itself is decoration — announcing five segments as well
            would just be noise. */}
        <ol className="mt-1.5 flex gap-1" aria-hidden>
          {macro.phases.map((phase) => (
            <li
              key={phase.key}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                phase.state === "complete" && "bg-success",
                phase.state === "current" && "bg-primary",
                phase.state === "attention" && "bg-warning",
                phase.state === "blocked" && "bg-destructive",
                phase.state === "not_started" && "bg-muted",
              )}
            />
          ))}
        </ol>
      </div>

      <FullMacroRail macro={macro} className={cn("hidden sm:grid", className)} />
    </>
  );
}

function FullMacroRail({ macro, className }: { macro: MacroProgress; className?: string }) {
  return (
    <ol
      aria-label="Case phase"
      className={cn(
        "grid grid-cols-5 gap-px overflow-hidden rounded-lg border border-border/60 bg-border/40",
        className,
      )}
    >
      {macro.phases.map((phase) => {
        const active = phase.state !== "not_started" && phase.state !== "complete";
        return (
          <li
            key={phase.key}
            aria-current={phase.key === macro.phase ? "step" : undefined}
            title={phase.description}
            className={cn(
              "flex min-w-0 items-center gap-2 bg-card/60 px-2 py-2 sm:px-3",
              active && "bg-card",
            )}
          >
            <PhaseMarker state={phase.state} />
            <span className="min-w-0">
              <span
                className={cn(
                  "block truncate text-[11px] font-semibold uppercase tracking-wide sm:text-xs",
                  phase.state === "not_started" ? "text-muted-foreground/70" : "text-foreground",
                  phase.state === "blocked" && "text-destructive",
                  phase.state === "attention" && "text-warning",
                )}
              >
                {phase.label}
              </span>
              <span className="sr-only">{STATE_DESCRIPTION[phase.state]}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
