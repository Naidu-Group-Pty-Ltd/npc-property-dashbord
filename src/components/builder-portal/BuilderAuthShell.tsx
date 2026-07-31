import { ReactNode } from 'react';
import { BrandLogo } from '@/components/branding/BrandAssets';
import { useBrand } from '@/branding/useTokens';

/**
 * Shared chrome for the unauthenticated Builder Portal surfaces
 * (login, invite acceptance, password reset). Mirrors `SolicitorAuthShell`:
 * aurora backdrop + glass shell, semantic tokens only.
 */
export function BuilderAuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { settings } = useBrand();

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div
        aria-hidden
        className="builder-auth-aurora pointer-events-none absolute inset-0 opacity-70"
      />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="mb-4 flex justify-center">
              <BrandLogo
                slot="auth"
                alt={settings.companyName || 'Builder / Developer Portal'}
                className="h-14 max-w-[220px] object-contain"
                fallbackClassName="h-14 w-14 rounded-2xl border border-primary/30"
              />
            </div>
            <p className="text-base font-semibold tracking-tight text-foreground">{settings.companyName}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.35em] text-primary">
              Builder / Developer Portal
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-foreground">{title}</h1>
            {description ? (
              <p className="mt-2 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/80 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
            {children}
          </div>

          {footer ? <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}
