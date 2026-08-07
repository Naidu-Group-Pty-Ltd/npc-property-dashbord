import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Loader2, Lock, Shield } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useBrand } from '@/branding/useBrand';
import { useToast } from '@/hooks/use-toast';
import { useSolicitorPortalAuth } from '@/hooks/useSolicitorPortalAuth';
import {
  SOLICITOR_TERMS_ACKNOWLEDGEMENTS,
  invokeSolicitorFunction,
  type SolicitorAcknowledgementKey,
} from '@/lib/solicitorPortal';

interface TermsVersion { title: string; version: string; content_markdown: string; document_hash?: string | null }
interface GovernanceResponse { terms?: TermsVersion }

/**
 * Terms & privileged-data consent for the Solicitor Portal. Mirrors the Client
 * Portal consent wall (`PortalConsentWall`) and the Finance Portal terms gate:
 * branded header, scrollable agreement, explicit consent checkboxes, and a
 * footer confirming the acceptance is recorded.
 *
 * The agreement is the Portal Access, Confidentiality, Privacy and AML/CTF
 * Compliance Passport Agreement, stored as Markdown against a version row and
 * rendered here — it is never restated in this file. A consent wall that
 * carried its own copy of the words would eventually disagree with the version
 * the acceptance is recorded against, and the acceptance record would then name
 * a document nobody read.
 *
 * The five acknowledgments are not an interface gate. Each is a contractual
 * statement in its own right — authority to bind, the section 37A arrangement,
 * and the Partner Organisation's own AML/CTF responsibility among them — so
 * which ones were asserted travels with the acceptance and is recorded. The
 * server requires all five regardless of what this page sends.
 */
export default function SolicitorTerms() {
  const [terms, setTerms] = useState<TermsVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
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

  const acceptedKeys = useMemo(
    () => SOLICITOR_TERMS_ACKNOWLEDGEMENTS.filter((item) => acknowledged[item.key]).map((item) => item.key),
    [acknowledged],
  );
  const allAcknowledged = acceptedKeys.length === SOLICITOR_TERMS_ACKNOWLEDGEMENTS.length;
  const canProceed = Boolean(terms) && allAcknowledged && !busy;

  const accept = async () => {
    if (!canProceed) return;
    setBusy(true);
    try {
      await acceptTerms(acceptedKeys as SolicitorAcknowledgementKey[]);
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
                <h2 className="text-sm font-semibold text-foreground">
                  {terms?.title || 'Portal Access, Confidentiality, Privacy and AML/CTF Compliance Passport Agreement'}
                </h2>
              </div>
              <span className="text-xs text-muted-foreground">Version {terms?.version || 'current'}</span>
            </div>
            <ScrollArea className="h-80 rounded-xl border border-border bg-muted/20 p-4 md:h-[28rem]">
              <div className="pr-4 text-sm leading-relaxed text-muted-foreground" aria-live="polite">
                {loading ? (
                  <div className="space-y-2" aria-hidden>
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-11/12" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                ) : terms?.content_markdown ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={agreementMarkdownComponents}>
                    {terms.content_markdown}
                  </ReactMarkdown>
                ) : (
                  'The current terms could not be loaded. Please refresh and try again.'
                )}
              </div>
            </ScrollArea>
          </div>

          <Separator />

          {/* Mandatory acknowledgments — presented in the order the agreement sets. */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Mandatory acknowledgments</h3>
            {SOLICITOR_TERMS_ACKNOWLEDGEMENTS.map((item, index) => (
              <div key={item.key} className="flex items-start gap-3">
                <Checkbox
                  id={`acknowledge-${item.key}`}
                  checked={Boolean(acknowledged[item.key])}
                  onCheckedChange={(checked) =>
                    setAcknowledged((prev) => ({ ...prev, [item.key]: checked === true }))
                  }
                  disabled={!terms}
                  className="mt-0.5"
                />
                <Label
                  htmlFor={`acknowledge-${item.key}`}
                  className="cursor-pointer text-sm leading-relaxed text-foreground"
                >
                  <span className="font-semibold">{index + 1}. {item.heading}. </span>
                  {item.statement}
                </Label>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="space-y-4 border-t border-border bg-muted/30 px-6 py-4 md:px-8 md:py-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            By proceeding, you confirm that you are authorised to bind the Partner Organisation and accept this
            Portal Access, Confidentiality, Privacy and AML/CTF Compliance Passport Agreement on its behalf.
            Statutory reliance is available only where the applicable eligibility, assessment, information-access
            and record-keeping requirements are satisfied.
          </p>
          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground/60">
              <Lock className="h-3 w-3 shrink-0" aria-hidden />
              <span>Your consent is recorded securely against version {terms?.version || 'current'}</span>
              {terms?.document_hash ? (
                <span className="font-mono">· document hash {terms.document_hash.slice(0, 12)}</span>
              ) : null}
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
                'Accept Binding Agreement & Continue'
              )}
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * The agreement is a legal instrument, so its structure has to survive the
 * render: numbered sections stay numbered, the conditional lists in sections 7
 * and 9 stay ordered, and nothing collapses into undifferentiated prose. Body
 * copy is `foreground` rather than `muted-foreground` — this is the document a
 * solicitor is being asked to be bound by, not supporting text.
 */
const agreementMarkdownComponents = {
  h1: ({ children }: { children?: ReactNode }) => (
    <h1 className="mb-3 mt-6 text-base font-bold text-foreground first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className="mb-2 mt-6 text-sm font-semibold text-primary first:mt-0">{children}</h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className="mb-2 mt-4 text-sm font-semibold text-foreground">{children}</h3>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="mb-3 leading-relaxed text-foreground">{children}</p>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="mb-3 list-outside list-disc space-y-1 pl-5">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="mb-3 list-outside list-decimal space-y-1 pl-5">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="leading-relaxed text-foreground">{children}</li>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  a: ({ children, href }: { children?: ReactNode; href?: string }) => (
    <a href={href} className="underline underline-offset-2" rel="noreferrer noopener" target="_blank">{children}</a>
  ),
};
