import type { ReactNode } from 'react';

/** Page-level heading/content used inside the single BuilderPortalLayout.
 *  Mirrors `SolicitorPortalShell`.
 *
 *  Every Builder page routes its title, description and actions through here,
 *  so the header hierarchy, the action alignment and the mobile button layout
 *  are decided once rather than thirteen times. Actions go full width on a
 *  phone and back to their intrinsic width from `sm` up. */
export function BuilderPortalShell({
  title, description, actions, children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center [&>*]:w-full sm:[&>*]:w-auto">
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
