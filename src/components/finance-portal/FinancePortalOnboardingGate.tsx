import { useCallback, useEffect, useState } from 'react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { useBrand } from '@/branding/useBrand';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PortalAgreementConsent } from '@/components/portal/PortalAgreementConsent';
import type { PortalAcknowledgementKey, PortalTermsVersion } from '@/lib/portalAgreement';
import { ShieldCheck, Users, Lock, Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const buildWizardSteps = (brand: string) => [
  {
    icon: ShieldCheck,
    title: 'Welcome to the Finance Partner Portal',
    body: `A purpose-built workspace where you can manage the financial profiles of clients ${brand} has assigned to you. Everything you see here is gated by per-client permissions set by ${brand}.`,
  },
  {
    icon: Users,
    title: 'Per-client access',
    body: `Your client list shows only the clients you have been assigned. Inside each client you may see Properties, Income, Expenses, Assets, Liabilities, Employment, Address History, Notes and Contacts depending on the access ${brand} has granted.`,
  },
  {
    icon: Lock,
    title: 'View, Edit, Delete — clearly labelled',
    body: 'Each section displays your access level. If a button is missing, your assignment does not include that permission. Need different access? Contact your account manager.',
  },
];

export function FinancePortalOnboardingGate() {
  const { user, acceptTerms, completeOnboarding, invokeFinanceFunction } = useFinancePortalAuth();
  const { settings: brandSettings } = useBrand();
  const brandName = brandSettings.companyName || 'the operator';
  const WIZARD_STEPS = buildWizardSteps(brandName);
  const [submitting, setSubmitting] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [terms, setTerms] = useState<PortalTermsVersion | null>(null);
  const [termsLoading, setTermsLoading] = useState(true);

  // The agreement is fetched whether or not the gate is currently showing it:
  // the hook order cannot depend on which step is on screen.
  const loadTerms = useCallback(async () => {
    setTermsLoading(true);
    const { data, error } = await invokeFinanceFunction('finance-portal-verify', {
      action: 'get_governance',
    });
    if (error) toast.error(error?.message || 'Unable to load the current terms.');
    setTerms((data?.terms as PortalTermsVersion | undefined) ?? null);
    setTermsLoading(false);
  }, [invokeFinanceFunction]);

  useEffect(() => { void loadTerms(); }, [loadTerms]);

  if (!user) return null;

  // Version-aware where the server can be: a partner who accepted a superseded
  // version has not accepted this one, and `has_accepted_terms` alone would let
  // an amended agreement go unread by everyone already through the door.
  //
  // But absent is not false. `finance-portal-verify` deploys on its own track,
  // so this bundle can be running against a deployment that predates versioned
  // acceptance and sends neither the field nor the agreement. Reading `undefined`
  // as "has not accepted" there blocks every finance partner behind a document
  // the old server cannot serve — which is exactly what happened when the
  // frontend shipped ahead of the function. Fall back to the flag that
  // deployment does send.
  const serverIsVersionAware = typeof user.has_accepted_current_terms === 'boolean';
  const showTerms = serverIsVersionAware
    ? !user.has_accepted_current_terms
    : !user.has_accepted_terms;

  // A partner who has never accepted anything must still be gated, even when
  // the document cannot be fetched. They are told why, and given a way to try
  // again, rather than being shown an empty panel and a dead button.
  const termsUnavailable = !termsLoading && !terms;
  const showWizard = user.has_accepted_terms && !user.has_completed_onboarding;

  if (!showTerms && !showWizard) return null;

  const handleAccept = async (acknowledgements: PortalAcknowledgementKey[]) => {
    setSubmitting(true);
    try {
      await acceptTerms(acknowledgements);
      setWizardStep(0);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to accept terms. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleNext = async () => {
    if (wizardStep < WIZARD_STEPS.length - 1) {
      setWizardStep(s => s + 1);
      return;
    }
    setSubmitting(true);
    try {
      await completeOnboarding();
      toast.success('Welcome aboard. You are all set.');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to complete onboarding.');
    } finally {
      setSubmitting(false);
    }
  };

  if (showTerms) {
    return (
      <Dialog open onOpenChange={() => { /* blocking */ }}>
        <DialogContent
          className="max-h-[92vh] max-w-3xl overflow-y-auto"
          onPointerDownOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Terms &amp; Privileged Data Consent
            </DialogTitle>
            <DialogDescription>
              {brandName} · Finance Partner Portal. Before accessing client financial records,
              review and accept the terms of use below. Your acceptance is recorded against this
              exact version.
            </DialogDescription>
          </DialogHeader>

          {termsUnavailable ? (
            <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-6 text-sm leading-relaxed">
              <p className="text-foreground">
                The current terms could not be loaded, so they cannot be accepted yet. Nothing has
                been recorded against your account.
              </p>
              <p className="text-muted-foreground">
                Please try again in a moment. If this continues, contact {brandName}.
              </p>
              <Button variant="outline" onClick={loadTerms} disabled={termsLoading}>
                {termsLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Try again
              </Button>
            </div>
          ) : (
            <PortalAgreementConsent
              terms={terms}
              loading={termsLoading}
              busy={submitting}
              onAccept={(acknowledgements) => void handleAccept(acknowledgements)}
              scrollHeightClassName="h-64 md:h-80"
            />
          )}
        </DialogContent>
      </Dialog>
    );
  }

  // Wizard
  const step = WIZARD_STEPS[wizardStep];
  const Icon = step.icon;
  const isLast = wizardStep === WIZARD_STEPS.length - 1;
  return (
    <Dialog open onOpenChange={() => { /* blocking */ }}>
      <DialogContent className="max-w-lg" onPointerDownOutside={e => e.preventDefault()} onEscapeKeyDown={e => e.preventDefault()}>
        <DialogHeader>
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mx-auto mb-2">
            <Icon className="h-7 w-7 text-primary" />
          </div>
          <DialogTitle className="text-center">{step.title}</DialogTitle>
          <DialogDescription className="text-center text-base leading-relaxed pt-2">
            {step.body}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center gap-2 py-3">
          {WIZARD_STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === wizardStep ? 'w-8 bg-primary' : 'w-2 bg-muted'
              }`}
            />
          ))}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => setWizardStep(s => Math.max(0, s - 1))}
            disabled={wizardStep === 0 || submitting}
          >
            Back
          </Button>
          <Button onClick={handleNext} disabled={submitting} className="gap-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isLast ? <><Sparkles className="h-4 w-4" /> Get Started</> : 'Next'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
