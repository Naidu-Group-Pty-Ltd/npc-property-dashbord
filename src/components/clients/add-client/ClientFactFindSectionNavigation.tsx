import type { KeyboardEvent } from 'react';
import { BriefcaseBusiness, CreditCard, Landmark, MapPin, Users } from 'lucide-react';

export type ClientFactFindSection = 'applicants' | 'addresses' | 'employment' | 'assets' | 'liabilities';

const SECTIONS = [
  { value: 'applicants', label: 'Applicants', description: 'Personal details', icon: Users },
  { value: 'addresses', label: 'Address History', description: 'Current & previous', icon: MapPin },
  { value: 'employment', label: 'Employment & Income', description: 'Work & earnings', icon: BriefcaseBusiness },
  { value: 'assets', label: 'Assets', description: 'Portfolio position', icon: Landmark },
  { value: 'liabilities', label: 'Liabilities', description: 'Other commitments', icon: CreditCard },
] as const;

export function ClientFactFindSectionNavigation({ value, onChange }: { value: ClientFactFindSection; onChange: (section: ClientFactFindSection) => void }) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = SECTIONS.findIndex(section => section.value === value);
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % SECTIONS.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + SECTIONS.length) % SECTIONS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = SECTIONS.length - 1;
    else return;
    event.preventDefault();
    const section = SECTIONS[next].value;
    onChange(section);
    requestAnimationFrame(() => document.getElementById(`fact-find-section-${section}`)?.focus());
  };

  return <div
    role="tablist"
    aria-label="Client Fact Find sections"
    onKeyDown={handleKeyDown}
    className="grid grid-cols-2 gap-1.5 rounded-xl border border-border/80 bg-card p-1.5 shadow-md sm:grid-cols-3 lg:grid-cols-5"
  >
    {SECTIONS.map(section => {
      const Icon = section.icon;
      const selected = value === section.value;
      return <button
        key={section.value}
        id={`fact-find-section-${section.value}`}
        type="button"
        role="tab"
        aria-label={section.label}
        title={`${section.label} — ${section.description}`}
        aria-selected={selected}
        tabIndex={selected ? 0 : -1}
        onClick={() => onChange(section.value)}
        className="group flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-transparent bg-muted/30 px-2.5 py-1.5 text-left text-foreground transition-[background-color,border-color,color,box-shadow,transform] duration-150 hover:border-brand-300/30 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[0.98] motion-reduce:transition-none aria-selected:border-brand-300/50 aria-selected:bg-primary/20 aria-selected:text-foreground aria-selected:shadow-sm"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground shadow-inner group-hover:text-foreground group-aria-selected:border-brand-300/40 group-aria-selected:bg-primary/20 group-aria-selected:text-brand-200">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block break-words text-xs font-bold leading-4 sm:text-[13px]">{section.label}</span>
        </span>
      </button>;
    })}
  </div>;
}
