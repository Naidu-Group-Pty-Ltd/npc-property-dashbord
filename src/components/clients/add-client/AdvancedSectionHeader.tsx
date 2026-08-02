import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export const premiumSectionClass = 'overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm transition-[border-color,box-shadow] duration-150 focus-within:border-brand-300/30 focus-within:shadow-md motion-reduce:transition-none';

export function AdvancedSectionHeader({ icon: Icon, title, description, trailing, className }: { icon: LucideIcon; title: string; description?: string; trailing?: React.ReactNode; className?: string }) {
  return <header className={cn('flex flex-col gap-3 border-b border-border/60 bg-muted/20 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5',className)}><div className="flex min-w-0 items-center gap-3"><span className="dashboard-luxury-icon-tile flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-inner"><Icon className="h-4 w-4" aria-hidden="true"/></span><div className="min-w-0"><h3 className="font-semibold tracking-tight text-foreground">{title}</h3>{description&&<p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>}</div></div>{trailing}</header>;
}
