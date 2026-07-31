import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useBuilderPortalAuth } from '@/hooks/useBuilderPortalAuth';
import { builderLoadGovernance, type BuilderOnboardingStep } from '@/lib/builderPortal';

/**
 * Builder / Developer Portal onboarding checklist.
 *
 * Mirrors `SolicitorOnboarding`. The steps come from the server; the checkboxes
 * are an acknowledgement gesture, and completion is recorded server-side for the
 * authenticated user.
 */
const STEP_LABELS: Record<string, string> = {
  profile_confirmed: 'Confirm your name, job title and contact details are correct',
  organisation_confirmed: 'Confirm the organisation you are acting for',
  contact_confirmed: 'Confirm the best contact address for portal notifications',
  security_reviewed: 'Review device and session security, and how to report a lost device',
};

export default function BuilderOnboarding() {
  const { completeOnboarding } = useBuilderPortalAuth();
  const navigate = useNavigate();

  const [steps, setSteps] = useState<BuilderOnboardingStep[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    <main className="min-h-screen bg-background px-4 py-10">
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>Complete portal onboarding</CardTitle>
          <p className="text-sm text-muted-foreground">
            Confirm each item before your workspace opens.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {loading ? (
            <div className="flex justify-center py-6" role="status" aria-label="Loading onboarding steps">
              <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
            </div>
          ) : null}

          {!loading && steps.length === 0 ? (
            <Alert>
              <AlertDescription>
                No onboarding steps are configured. Contact your administrator.
              </AlertDescription>
            </Alert>
          ) : null}

          {steps.map((step) => {
            const done = Boolean(step.completed_at);
            return (
              <label
                key={step.step_key}
                className="flex items-start gap-3 rounded-lg border border-border/60 p-4 text-sm"
              >
                <Checkbox
                  checked={done || Boolean(checked[step.step_key])}
                  disabled={done}
                  onCheckedChange={(value) =>
                    setChecked((current) => ({ ...current, [step.step_key]: value === true }))}
                />
                <span className="min-w-0">
                  <span className="block text-foreground">
                    {STEP_LABELS[step.step_key] || step.step_key.replace(/_/g, ' ')}
                  </span>
                  {step.mandatory ? null : (
                    <span className="mt-0.5 block text-xs text-muted-foreground">Optional</span>
                  )}
                </span>
              </label>
            );
          })}

          <Button disabled={!ready || submitting} onClick={() => void handleComplete()}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            Complete onboarding
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
