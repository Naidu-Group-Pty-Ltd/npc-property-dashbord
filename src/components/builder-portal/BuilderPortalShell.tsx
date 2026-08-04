import type { ReactNode } from 'react';
import { HardHat } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BuilderPortalShellProps {
  title: string;
  description?: string;
  /** Small uppercase label above the title. Defaults to the portal name. */
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * Page-level heading/content used inside the single BuilderPortalLayout.
 *
 * Uses the `builder-portal-page-header` treatment, which is the Builder copy of
 * the formula the Client, Finance and Solicitor portals share — so every
 * Builder page opens with the same gradient hero as the rest of the family.
 *
 * The eyebrow icon is a hard hat because that is Builder *domain* iconography,
 * not brand identity: the configured operator logo is rendered by the layout's
 * `BrandLockup`, never here.
 */
export function BuilderPortalShell({
  title,
  description,
  eyebrow = 'Builder / Developer Portal',
  actions,
  className,
  children,
}: BuilderPortalShellProps) {
  return (
    <div className={cn('space-y-6 md:space-y-8', className)}>
      <header className="builder-portal-page-header">
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            {eyebrow ? (
              <div className="mb-1 flex items-center gap-2">
                <HardHat className="h-4 w-4 text-primary/60" aria-hidden />
                <span className="text-xs font-medium uppercase tracking-widest text-primary/70">
                  {eyebrow}
                </span>
              </div>
            ) : null}
            <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">{title}</h1>
            {description ? (
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center [&>*]:w-full sm:[&>*]:w-auto">
              {actions}
            </div>
          ) : null}
        </div>
      </header>
      {children}
    </div>
  );
}
