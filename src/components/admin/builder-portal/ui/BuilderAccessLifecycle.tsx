import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * The five-step Builder access lifecycle, shown as a process strip.
 *
 * Display-only and deliberately inert — no step is clickable, because nothing
 * here advances a user's stage. The wording lives with the page that enforces
 * the order; this component only lays it out.
 */
export interface BuilderAccessLifecycleStep {
  label: string;
  icon: LucideIcon;
}

export interface BuilderAccessLifecycleProps {
  steps: ReadonlyArray<BuilderAccessLifecycleStep>;
  footnote?: ReactNode;
}

export function BuilderAccessLifecycle({ steps, footnote }: BuilderAccessLifecycleProps) {
  return (
    <section aria-labelledby="builder-access-lifecycle" className="rounded-lg border border-border bg-muted/30 p-4">
      <h3
        id="builder-access-lifecycle"
        className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Access lifecycle
      </h3>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {steps.map((step, index) => (
          <li
            key={step.label}
            className="flex items-start gap-2.5 rounded-md border border-border bg-card p-3 transition-colors hover:border-primary/40"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <step.icon className="h-3.5 w-3.5 text-primary" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground tabular-nums">
                Step {index + 1}
              </p>
              <p className="text-xs font-medium leading-snug first-letter:uppercase">{step.label}</p>
            </div>
          </li>
        ))}
      </ol>
      {footnote ? <div className="mt-3 text-xs leading-relaxed text-muted-foreground">{footnote}</div> : null}
    </section>
  );
}
