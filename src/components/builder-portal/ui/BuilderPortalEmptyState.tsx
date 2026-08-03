import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * What a Builder surface shows when it has nothing to show.
 *
 * Display only. It never decides that a list is empty — the caller does — and
 * it never invents an action; anything in `action` is passed in by a page that
 * already has the permission to offer it.
 */
export interface BuilderPortalEmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function BuilderPortalEmptyState({
  icon: Icon, title, description, action, className,
}: BuilderPortalEmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-10 text-center',
        className,
      )}
    >
      {Icon ? (
        <span
          className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted"
          aria-hidden
        >
          <Icon className="h-5 w-5 text-muted-foreground" />
        </span>
      ) : null}
      <p className="font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
