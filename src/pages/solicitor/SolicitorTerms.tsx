import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Loader2, Lock, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useBrand } from '@/branding/useBrand';
import { useToast } from '@/hooks/use-toast';
import { useSolicitorPortalAuth } from '@/hooks/useSolicitorPortalAuth';
import { invokeSolicitorFunction } from '@/lib/solicitorPortal';

interface TermsVersion { title: string; version: string; content_markdown: string }
interface GovernanceResponse { terms?: TermsVersion }

/**
 * Terms & privileged-data consent for the Solicitor Portal. Mirrors the Client
 * Portal consent wall (`PortalConsentWall`) and the Finance Portal terms gate:
 * branded header, scrollable agreement, explicit consent checkboxes, and a
 * footer confirming the acceptance is recorded.
 */
export default function SolicitorTerms() {
  const [terms, setTerms] = useState<TermsVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedPrivilege, setAgreedPrivilege] = useState(false);
  const [busy, setBusy] = useState(false);
  const { acceptTerms } = useSolicitorPortalAuth();
  const { settings: brandSettings } = useBrand();
  const navigate = useNavigate();
  const { toast } = useToast();

  const companyName = (brandSettings.companyName || '').trim() || 'the Operator';

  useEffect(() => {
    void invokeSolicitorFunction<GovernanceResponse>('solicitor-portal-verify', { action: 'get_governance' })
      .then(({ data, error }) => {
        if (error) toast({ title: 'Unable to load terms', description: error.message, variant: 'destructive' });
        setTerms(data?.terms ?? null);
        setLoading(false);
      });
  }, [toast]);

  const canProceed = Boolean(terms) && agreedTerms && agreedPrivilege && !busy;

  const accept = async () => {
    if (!canProceed) return;
    setBusy(true);
    try {
      await acceptTerms();
      navigate('/solicitor/onboarding', { replace: true });
    } catch (error) {
      toast({
        title: 'Acceptance was not recorded',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally { setBusy(false); }
  };

  return (
    <main className="solicitor-portal-theme flex min-h-screen items-center justify-center p-4">
      <div className="relative z-10 w-full max-w-3xl animate-in overflow-hidden rounded-2xl border border-border bg-card shadow-2xl duration-300 fade-in zoom-in-95">
        {/* Header */}
        <div className="border-b border-border bg-primary/5 px-6 py-6 md:px-8 md:py-8">
          <div className="mb-3 flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5">
              <Shield className="h-6 w-6 text-primary" aria-hidden />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground md:text-2xl">Terms &amp; Privileged Data Consent</h1>
              <p className="text-sm text-muted-foreground">{companyName} · Solicitor Portal</p>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Before accessing legal matters, please review and accept the terms of use below. Your acceptance is
            recorded against this exact version.
          </p>
        </div>

        {/* Content */}
        <div className="space-y-6 px-6 py-5 md:px-8 md:py-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" aria-hidden />
                <h2 className="text-sm font-semibold text-foreground">{terms?.title || 'Solicitor Portal Terms'}</h2>
              </div>
              <span className="text-xs text-muted-foreground">Version {terms?.version || 'current'}</span>
            </div>
            <ScrollArea className="h-64 rounded-xl border border-border bg-muted/20 p-4 md:h-72">
              <div
                className="whitespace-pre-wrap pr-4 text-sm leading-relaxed text-muted-foreground"
                aria-live="polite"
              >
                {loading ? (
                  <div className="space-y-2" aria-hidden>
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-11/12" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                ) : (
                  terms?.content_markdown || 'The current terms could not be loaded. Please refresh and try again.'
                )}
              </div>
            </ScrollArea>
          </div>

          <Separator />

          {/* Consent */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id="agree-terms"
                checked={agreedTerms}
                onCheckedChange={(checked) => setAgreedTerms(checked === true)}
                disabled={!terms}
                className="mt-0.5"
              />
              <Label htmlFor="agree-terms" className="cursor-pointer text-sm leading-relaxed text-foreground">
                I have read and agree to the {terms?.title || 'Solicitor Portal Terms'}
                {terms?.version ? ` (version ${terms.version})` : ''} of {companyName}.
              </Label>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id="agree-privilege"
                checked={agreedPrivilege}
                onCheckedChange={(checked) => setAgreedPrivilege(checked === true)}
                disabled={!terms}
                className="mt-0.5"
              />
              <Label htmlFor="agree-privilege" className="cursor-pointer text-sm leading-relaxed text-foreground">
                I acknowledge that matter data in this portal is confidential and may be privileged, that my access is
                limited to matters shared with my practice, and that every action I take here is logged and auditable.
              </Label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col items-center justify-between gap-3 border-t border-border bg-muted/30 px-6 py-4 sm:flex-row md:px-8 md:py-5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
            <Lock className="h-3 w-3" aria-hidden />
            <span>Your consent is recorded securely against version {terms?.version || 'current'}</span>
          </div>
          <Button
            onClick={() => void accept()}
            disabled={!canProceed}
            size="lg"
            className="w-full min-w-[200px] sm:w-auto"
          >
            {busy ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Recording acceptance…</>
            ) : (
              'Accept & Continue'
            )}
          </Button>
        </div>
      </div>
    </main>
  );
}
