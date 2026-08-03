import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The three stops between signing in and reaching the workspace, shown on the
 * terms and onboarding pages so neither one feels like a dead end.
 *
 * Display only. It reads nothing, decides nothing and routes nowhere — the
 * governance guard is the sole authority on where a user may go, and this strip
 * simply reports which of its stages the current page is. Passing a different
 * `current` changes the picture and nothing else.
 */
const BUILDER_GOVERNANCE_STEPS = ['Terms', 'Workspace setup', 'Portal ready'] as const;
export type BuilderGovernanceStep = (typeof BUILDER_GOVERNANCE_STEPS)[number];

export interface BuilderGovernanceProgressProps {
  current: BuilderGovernanceStep;
  className?: string;
}

export function BuilderGovernanceProgress({ current, className }: BuilderGovernanceProgressProps) {
  const currentIndex = BUILDER_GOVERNANCE_STEPS.indexOf(current);

  return (
    <ol
      className={cn('flex flex-wrap items-center gap-x-2 gap-y-2 text-xs', className)}
      aria-label={`Step ${currentIndex + 1} of ${BUILDER_GOVERNANCE_STEPS.length}: ${current}`}
    >
      {BUILDER_GOVERNANCE_STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li key={step} className="flex items-center gap-2">
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition-colors',
                active && 'border-primary/40 bg-primary/10 text-primary',
                done && 'border-border bg-muted/60 text-muted-foreground',
                !active && !done && 'border-dashed border-border text-muted-foreground',
              )}
              aria-current={active ? 'step' : undefined}
            >
              <span
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                  active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}
                aria-hidden
              >
                {done ? <Check className="h-2.5 w-2.5" /> : index + 1}
              </span>
              {step}
              {/* Never colour alone: the state is spelled out for assistive tech. */}
              <span className="sr-only">
                {done ? ' (completed)' : active ? ' (current step)' : ' (not started)'}
              </span>
            </span>
            {index < BUILDER_GOVERNANCE_STEPS.length - 1 ? (
              <span className="hidden h-px w-4 bg-border sm:block" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
