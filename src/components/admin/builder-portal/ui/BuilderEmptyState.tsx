import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * The empty surface shown inside a Builder Portal table container.
 *
 * Display-only. The caller decides which of the two cases it is describing —
 * "nothing has been created yet" or "the search matched nothing" — and supplies
 * the action, so a viewer without edit permission is simply passed no action.
 */
export interface BuilderEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}

export function BuilderEmptyState({ icon: Icon, title, description, action }: BuilderEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted">
        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
      </span>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
