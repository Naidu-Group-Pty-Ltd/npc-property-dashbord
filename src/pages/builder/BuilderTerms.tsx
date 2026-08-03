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
import { BuilderGovernanceShell } from '@/components/builder-portal/ui/BuilderGovernanceShell';

/**
 * Builder / Developer Portal terms and project-data consent.
 *
 * Acceptance is recorded server-side against the exact terms version that was
 * served, for the authenticated user — this page cannot nominate whose
 * acceptance is being recorded, nor which version it is against.
 *
 * The two checkboxes are an interface gate, not a second contract: they decide
 * when the button becomes usable and nothing more. `acceptTerms()` remains the
 * single authoritative acceptance call, made once, and the page only leaves for
 * the portal when it succeeds. Where it goes next is unchanged: `/builder`,
 * which the governance guard sends on to onboarding if onboarding is
 * outstanding — this page never bypasses that.
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
    <BuilderGovernanceShell
      icon={HardHat}
      title="Terms & Project Data Consent"
      eyebrow={
        <>
          {companyName} · Builder / Developer Portal
          {organisationName ? <> · {organisationName}</> : null}
        </>
      }
      intro="Before accessing projects, inventory, transactions, construction records and shared documents, review and accept the current portal terms. Your acceptance is recorded against this exact version."
      step="Terms"
      footer={
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3 w-3 shrink-0" aria-hidden />
            <span>Your consent will be recorded securely against version {versionLabel}.</span>
          </p>
          <Button
            size="lg"
            disabled={!canProceed}
            onClick={() => void handleAccept()}
            className="w-full sm:w-auto sm:min-w-[200px]"
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
      }
    >
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="space-y-3" aria-labelledby="builder-terms-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <h2 id="builder-terms-heading" className="truncate text-sm font-semibold text-foreground">
              {terms?.title || 'Builder / Developer Portal terms'}
            </h2>
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">Version {versionLabel}</span>
        </div>

        <ScrollArea className="h-64 rounded-xl border border-border bg-muted/20 md:h-72">
          <div
            className="whitespace-pre-wrap p-4 pr-6 text-sm leading-relaxed text-muted-foreground"
            aria-live="polite"
            aria-busy={loading}
            tabIndex={0}
          >
            {loading ? (
              <div className="space-y-2.5">
                <span className="sr-only">Loading the current terms…</span>
                <Skeleton className="h-4 w-2/3" aria-hidden />
                <Skeleton className="h-4 w-full" aria-hidden />
                <Skeleton className="h-4 w-11/12" aria-hidden />
                <Skeleton className="h-4 w-5/6" aria-hidden />
                <Skeleton className="h-4 w-full" aria-hidden />
                <Skeleton className="h-4 w-4/5" aria-hidden />
              </div>
            ) : (
              terms?.content_markdown
              || 'No current terms are published for this portal. Contact your administrator — access cannot continue until terms are available.'
            )}
          </div>
        </ScrollArea>
      </section>

      <Separator />

      {/* Both acknowledgements are required before the footer button is usable.
          Neither one is sent anywhere: the server records the acceptance of the
          version it served, exactly as it did before. */}
      <section className="space-y-4" aria-label="Consent acknowledgements">
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
      </section>
    </BuilderGovernanceShell>
  );
}
