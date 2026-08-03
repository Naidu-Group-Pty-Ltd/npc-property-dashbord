import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, HardHat, Loader2, Lock } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useBrand } from '@/branding/useBrand';
import { cn } from '@/lib/utils';
import { useBuilderPortalAuth } from '@/hooks/useBuilderPortalAuth';
import { builderLoadGovernance, type BuilderOnboardingStep } from '@/lib/builderPortal';
import { BuilderGovernanceShell } from '@/components/builder-portal/ui/BuilderGovernanceShell';

/**
 * Builder / Developer Portal onboarding checklist.
 *
 * The steps come from the server; the checkboxes are an acknowledgement
 * gesture, and completion is recorded server-side for the authenticated user.
 * Nothing here decides which steps exist, which are mandatory, or which are
 * already done — `builderLoadGovernance()` answers all three, and a step the
 * server marks complete is shown as complete and cannot be unticked.
 *
 * The visual shell is shared with the terms page so first entry reads as one
 * sequence. The journey strip in that shell is display only.
 */
const STEP_LABELS: Record<string, string> = {
  profile_confirmed: 'Confirm your name, job title and contact details are correct',
  organisation_confirmed: 'Confirm the organisation you are acting for',
  contact_confirmed: 'Confirm the best contact address for portal notifications',
  security_reviewed: 'Review device and session security, and how to report a lost device',
};

export default function BuilderOnboarding() {
  const { completeOnboarding, activeOrganisation } = useBuilderPortalAuth();
  const { settings: brandSettings } = useBrand();
  const navigate = useNavigate();

  const [steps, setSteps] = useState<BuilderOnboardingStep[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const companyName = (brandSettings.companyName || '').trim() || 'the Operator';
  const organisationName = activeOrganisation
    ? activeOrganisation.trading_name || activeOrganisation.legal_name
    : null;

  useEffect(() => {
    let cancelled = false;

    void builderLoadGovernance().then(({ data, error: loadError }) => {
      if (cancelled) return;
      if (loadError) setError(loadError.message);
      setSteps(data?.steps ?? []);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  const outstanding = steps.filter((step) => step.mandatory && !step.completed_at);
  const ready = steps.length > 0 && outstanding.every((step) => checked[step.step_key]);

  /** Progress reporting only — it gates nothing. `ready` above is the gate. */
  const acknowledged = outstanding.filter((step) => checked[step.step_key]).length;

  const handleComplete = async () => {
    setError(null);
    setSubmitting(true);
    const result = await completeOnboarding();
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
      title="Prepare Your Builder Workspace"
      eyebrow={
        <>
          {companyName} · Builder / Developer Portal
          {organisationName ? <> · {organisationName}</> : null}
        </>
      }
      intro="Confirm your organisation, profile, contact and security details before entering the project workspace."
      step="Workspace setup"
      footer={
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3 w-3 shrink-0" aria-hidden />
            <span>
              {outstanding.length > 0
                ? `${acknowledged} of ${outstanding.length} required ${outstanding.length === 1 ? 'item' : 'items'} confirmed.`
                : 'Your confirmation is recorded securely against your account.'}
            </span>
          </p>
          <Button
            size="lg"
            disabled={!ready || submitting}
            onClick={() => void handleComplete()}
            className="w-full sm:w-auto sm:min-w-[200px]"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Completing…
              </>
            ) : (
              'Complete onboarding'
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

      {loading ? (
        <div className="space-y-3" role="status" aria-label="Loading onboarding steps">
          <span className="sr-only">Loading onboarding steps…</span>
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-[4.5rem] w-full rounded-xl" aria-hidden />
          ))}
        </div>
      ) : null}

      {!loading && steps.length === 0 ? (
        <Alert>
          <AlertDescription>
            No onboarding steps are configured. Contact your administrator.
          </AlertDescription>
        </Alert>
      ) : null}

      {!loading && steps.length > 0 ? (
        <ol className="space-y-3">
          {steps.map((step, index) => {
            const done = Boolean(step.completed_at);
            const ticked = done || Boolean(checked[step.step_key]);
            return (
              <li key={step.step_key}>
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-sm transition-colors',
                    ticked
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-border hover:border-primary/25 hover:bg-muted/40',
                    done && 'cursor-default',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                      ticked ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                    )}
                    aria-hidden
                  >
                    {ticked ? <Check className="h-3.5 w-3.5" /> : index + 1}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block font-medium leading-snug text-foreground">
                      {STEP_LABELS[step.step_key] || step.step_key.replace(/_/g, ' ')}
                    </span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {/* Never colour alone — required, optional and already
                          done are each spelled out. */}
                      <Badge variant="outline" className="font-normal">
                        {step.mandatory ? 'Required' : 'Optional'}
                      </Badge>
                      {done ? (
                        <Badge variant="outline" className="gap-1 font-normal">
                          <Check className="h-3 w-3 shrink-0" aria-hidden />
                          Already confirmed
                        </Badge>
                      ) : null}
                    </span>
                  </span>

                  <Checkbox
                    checked={ticked}
                    disabled={done}
                    className="mt-0.5 shrink-0"
                    onCheckedChange={(value) =>
                      setChecked((current) => ({ ...current, [step.step_key]: value === true }))}
                  />
                </label>
              </li>
            );
          })}
        </ol>
      ) : null}
    </BuilderGovernanceShell>
  );
}
