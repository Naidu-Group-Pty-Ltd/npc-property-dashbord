import { cn } from '@/lib/utils';
import { Check, FileText, ShieldCheck, BadgeCheck, Users } from 'lucide-react';
import type { AmlPortalOverview } from '@/lib/aml/amlPortalApi';

/**
 * The client's view of the five-portal journey — deliberately built from the
 * portal-safe overview payload ALONE. No risk vocabulary, no gate names, no
 * partner detail: the client sees where they are and what happens next, in
 * their own language.
 *
 * The pay-off line ("your whole purchase team reuses this") is the product
 * promise from the owner's flow diagram: verify once, never repeat it for the
 * broker, builder, developer or conveyancer.
 */

type StripState = 'done' | 'active' | 'todo';

const STEPS = [
  { icon: FileText, label: 'Tell us about you', sub: 'a few guided questions' },
  { icon: ShieldCheck, label: 'We check it', sub: 'securely, in-house' },
  { icon: BadgeCheck, label: 'You are verified', sub: 'nothing more to do' },
  { icon: Users, label: 'Your team reuses it', sub: 'broker · builder · conveyancer' },
] as const;

export function ClientJourneyStrip({ overview }: { overview: AmlPortalOverview }) {
  const status = overview.case?.status ?? 'not_started';
  const consented = overview.consent?.satisfied ?? false;

  // Portal-safe status token → journey position. Everything the strip knows
  // comes from fields the client is already shown elsewhere.
  const submitted = ['submitted', 'under_review', 'complete'].includes(status);
  const complete = status === 'complete';
  const sharingConsented = !(overview.consent?.outstanding ?? []).includes('compliance_sharing')
    && consented;

  const states: StripState[] = [
    submitted ? 'done' : 'active',
    complete ? 'done' : submitted ? 'active' : 'todo',
    complete ? 'done' : 'todo',
    complete && sharingConsented ? 'done' : complete ? 'active' : 'todo',
  ];
  const doneCount = states.filter((s) => s === 'done').length;

  return (
    <div
      className="rounded-xl border border-primary/20 bg-primary/5 p-4"
      aria-label="Your compliance journey"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-1">
        <span className="text-sm font-semibold">Your compliance journey</span>
        <span className="text-xs text-muted-foreground">
          Complete this once — everyone helping with your purchase can reuse it.
        </span>
      </div>

      <ol className="relative grid grid-cols-4 gap-1">
        <div aria-hidden className="absolute left-[12.5%] right-[12.5%] top-4 h-0.5 rounded-full bg-border" />
        <div
          aria-hidden
          className="absolute left-[12.5%] top-4 h-0.5 rounded-full bg-primary transition-all duration-700"
          style={{ width: `${(Math.max(doneCount - 0.5, 0) / 4) * 100}%`, maxWidth: '75%' }}
        />
        {STEPS.map((step, i) => {
          const state = states[i];
          const Icon = step.icon;
          return (
            <li key={step.label} className="relative z-10 flex flex-col items-center text-center">
              <span
                aria-hidden
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border-2 bg-background transition-colors',
                  state === 'done' && 'border-primary bg-primary text-primary-foreground',
                  state === 'active' && 'border-primary text-primary',
                  state === 'todo' && 'border-border text-muted-foreground',
                )}
              >
                {state === 'done' ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </span>
              <span className={cn(
                'mt-1.5 text-[11px] font-medium leading-tight',
                state === 'todo' ? 'text-muted-foreground' : 'text-foreground',
              )}>
                {step.label}
              </span>
              <span className="hidden text-[10px] text-muted-foreground sm:block">{step.sub}</span>
              <span className="sr-only">
                {state === 'done' ? 'complete' : state === 'active' ? 'current step' : 'upcoming'}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
