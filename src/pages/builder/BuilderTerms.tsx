import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, HardHat, Loader2, Lock } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useBrand } from '@/branding/useBrand';
import { useBuilderPortalAuth } from '@/hooks/useBuilderPortalAuth';
import { builderLoadGovernance, type BuilderTermsVersion } from '@/lib/builderPortal';

/**
 * Builder / Developer Portal terms and project-data consent.
 *
 * Structurally the Solicitor consent wall — same centred surface, max width,
 * radius, border, shadow, entry animation, header proportions, scroll height,
 * separator placement and secure footer — with Builder's own content.
 *
 * Acceptance is recorded server-side against the exact terms version that was
 * served, for the authenticated user: this page cannot nominate whose
 * acceptance is being recorded, nor which version it is against.
 *
 * The two checkboxes are an interface gate, not a second contract. They decide
 * when the button becomes usable and nothing more. `acceptTerms()` remains the
 * single authoritative acceptance call, made once, and the page only leaves for
 * the portal when it succeeds. Where it goes next is unchanged: `/builder`,
 * which the governance guard sends on to onboarding when onboarding is
 * outstanding — this page never bypasses that.
 *
 * BRANDING. The company name is the configured white-label operator. The active
 * organisation is shown beside it as context, never in place of it.
 */
export default function BuilderTerms() {
  const { acceptTerms, activeOrganisation } = useBuilderPortalAuth();
  const { settings: brandSettings } = useBrand();
  const navigate = useNavigate();

  const [terms, setTerms] = useState<BuilderTermsVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedData, setAgreedData] = useState(false);

  const companyName = (brandSettings.companyName || '').trim() || 'the Operator';
  const organisationName = activeOrganisation
    ? activeOrganisation.trading_name || activeOrganisation.legal_name
    : null;
  const versionLabel = terms?.version || 'current';

  useEffect(() => {
    let cancelled = false;

    void builderLoadGovernance().then(({ data, error: loadError }) => {
      if (cancelled) return;
      if (loadError) setError(loadError.message);
      setTerms(data?.terms ?? null);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  const canProceed = Boolean(terms) && agreedTerms && agreedData && !submitting;

  const handleAccept = async () => {
    if (!canProceed) return;
    setError(null);
    setSubmitting(true);
    const result = await acceptTerms();
    setSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    navigate('/builder', { replace: true });
  };

  return (
    <main className="builder-portal-theme flex min-h-screen items-center justify-center p-4">
      <div className="relative z-10 w-full max-w-3xl animate-in overflow-hidden rounded-2xl border border-border bg-card shadow-2xl duration-300 fade-in zoom-in-95 motion-reduce:animate-none">
        {/* Header */}
        <div className="border-b border-border bg-primary/5 px-6 py-6 md:px-8 md:py-8">
          <div className="mb-3 flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5">
              <HardHat className="h-6 w-6 text-primary" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-foreground md:text-2xl">
                Terms &amp; Project Data Consent
              </h1>
              <p className="truncate text-sm text-muted-foreground">
                {companyName} · Builder / Developer Portal
                {organisationName ? ` · ${organisationName}` : ''}
              </p>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Before accessing projects, inventory, transactions, construction records and shared
            documents, review and accept the current portal terms. Your acceptance is recorded
            against this exact version.
          </p>
        </div>

        {/* Content */}
        <div className="space-y-6 px-6 py-5 md:px-8 md:py-6">
          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                <h2 className="truncate text-sm font-semibold text-foreground">
                  {terms?.title || 'Builder / Developer Portal Terms'}
                </h2>
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">
                Version {versionLabel}
              </span>
            </div>

            <ScrollArea className="h-64 rounded-xl border border-border bg-muted/20 p-4 md:h-72">
              <div
                className="whitespace-pre-wrap pr-4 text-sm leading-relaxed text-muted-foreground"
                aria-live="polite"
                aria-busy={loading}
                tabIndex={0}
              >
                {loading ? (
                  <div className="space-y-2">
                    <span className="sr-only">Loading the current terms…</span>
                    <Skeleton className="h-4 w-2/3" aria-hidden />
                    <Skeleton className="h-4 w-full" aria-hidden />
                    <Skeleton className="h-4 w-11/12" aria-hidden />
                    <Skeleton className="h-4 w-5/6" aria-hidden />
                    <Skeleton className="h-4 w-full" aria-hidden />
                  </div>
                ) : (
                  terms?.content_markdown
                  || 'No current terms are published for this portal. Contact your administrator — access cannot continue until terms are available.'
                )}
              </div>
            </ScrollArea>
          </div>

          <Separator />

          {/* Consent. Neither box is sent anywhere: the server records the
              acceptance of the version it served, exactly as it did before. */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id="builder-agree-terms"
                checked={agreedTerms}
                onCheckedChange={(checked) => setAgreedTerms(checked === true)}
                disabled={!terms}
                className="mt-0.5"
              />
              <Label
                htmlFor="builder-agree-terms"
                className="cursor-pointer text-sm font-normal leading-relaxed text-foreground"
              >
                I have read and agree to the {terms?.title || 'Builder / Developer Portal Terms'}
                {terms?.version ? ` (version ${terms.version})` : ''} of {companyName}.
              </Label>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id="builder-agree-project-data"
                checked={agreedData}
                onCheckedChange={(checked) => setAgreedData(checked === true)}
                disabled={!terms}
                className="mt-0.5"
              />
              <Label
                htmlFor="builder-agree-project-data"
                className="cursor-pointer text-sm font-normal leading-relaxed text-foreground"
              >
                I acknowledge that project, inventory, transaction, construction, document and
                communication data may be commercially sensitive or confidential; that my access is
                limited to authorised organisation and project records; and that actions performed
                through the portal may be logged and audited.
              </Label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col items-center justify-between gap-3 border-t border-border bg-muted/30 px-6 py-4 sm:flex-row md:px-8 md:py-5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
            <Lock className="h-3 w-3 shrink-0" aria-hidden />
            <span>Your consent is recorded securely against version {versionLabel}</span>
          </div>
          <Button
            onClick={() => void handleAccept()}
            disabled={!canProceed}
            size="lg"
            className="w-full min-w-[200px] sm:w-auto"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Recording acceptance…
              </>
            ) : (
              'Accept & Continue'
            )}
          </Button>
        </div>
      </div>
    </main>
  );
}
