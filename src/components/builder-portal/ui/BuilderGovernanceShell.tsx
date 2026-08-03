import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  BuilderGovernanceProgress, type BuilderGovernanceStep,
} from './BuilderGovernanceProgress';

/**
 * The framed surface the terms and onboarding pages share, so first entry to
 * the Builder Portal reads as one sequence rather than two unrelated forms.
 *
 * Display only: a header, a body and a footer, with the journey strip in the
 * header. It holds no state, makes no request and knows nothing about
 * governance beyond which stage it has been told to mark.
 */
export interface BuilderGovernanceShellProps {
  icon: LucideIcon;
  title: string;
  /** Operator and organisation context, when the caller already has it. */
  eyebrow?: ReactNode;
  intro: ReactNode;
  step: BuilderGovernanceStep;
  children: ReactNode;
  footer: ReactNode;
  className?: string;
}

export function BuilderGovernanceShell({
  icon: Icon, title, eyebrow, intro, step, children, footer, className,
}: BuilderGovernanceShellProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8 sm:py-12">
      <div
        className={cn(
          'w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-card shadow-xl',
          'animate-in duration-300 fade-in zoom-in-95 motion-reduce:animate-none',
          className,
        )}
      >
        <div className="border-b border-border bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-6 py-6 md:px-8 md:py-7">
          <div className="flex items-start gap-4">
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10"
              aria-hidden
            >
              <Icon className="h-6 w-6 text-primary" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">
                {title}
              </h1>
              {eyebrow ? (
                <p className="mt-1 break-words text-sm text-muted-foreground">{eyebrow}</p>
              ) : null}
            </div>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{intro}</p>

          <BuilderGovernanceProgress current={step} className="mt-5" />
        </div>

        <div className="space-y-6 px-6 py-6 md:px-8">{children}</div>

        <div className="border-t border-border bg-muted/30 px-6 py-4 md:px-8 md:py-5">
          {footer}
        </div>
      </div>
    </main>
  );
}
