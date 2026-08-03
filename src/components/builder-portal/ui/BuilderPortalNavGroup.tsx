import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * One labelled band of the Builder Portal sidebar.
 *
 * Display only: it draws a heading and a list, and the caller supplies the
 * items. It knows nothing about routes, permissions or which item is active —
 * grouping is a way of reading the navigation, not a way of gating it.
 */
export interface BuilderPortalNavGroupProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function BuilderPortalNavGroup({ title, children, className }: BuilderPortalNavGroupProps) {
  return (
    <div className={cn('px-3 py-1.5', className)} role="group" aria-label={title}>
      <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
        {title}
      </p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}
