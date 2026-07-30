import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useSolicitorPortalAuth } from '@/hooks/useSolicitorPortalAuth';
import { invokeSolicitorFunction } from '@/lib/solicitorPortal';

interface OnboardingStep { step_key: string; mandatory: boolean; completed_at: string | null }
interface GovernanceResponse { steps?: OnboardingStep[] }
const labels: Record<string, string> = {
  profile_confirmed: 'Confirm your professional profile is accurate',
  privacy_acknowledged: 'Acknowledge privacy and privileged-data handling',
  security_reviewed: 'Review device and session security',
};

export default function SolicitorOnboarding() {
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const { completeOnboarding } = useSolicitorPortalAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    void invokeSolicitorFunction<GovernanceResponse>('solicitor-portal-verify', { action: 'get_governance' })
      .then(({ data, error }) => {
        if (error) toast({ title: 'Unable to load onboarding', description: error.message, variant: 'destructive' });
        setSteps(data?.steps ?? []);
      });
  }, [toast]);

  const ready = steps.length > 0 && steps
    .filter((step) => step.mandatory && !step.completed_at)
    .every((step) => checked[step.step_key]);

  const complete = async () => {
    setBusy(true);
    try {
      await completeOnboarding();
      navigate('/solicitor', { replace: true });
    } catch (error) {
      toast({ title: 'Onboarding was not completed', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    } finally { setBusy(false); }
  };

  return <main className="min-h-screen bg-background p-6">
    <Card className="mx-auto max-w-2xl">
      <CardHeader><CardTitle>Complete portal onboarding</CardTitle><p className="text-sm text-muted-foreground">Complete each mandatory acknowledgement before accessing legal matters.</p></CardHeader>
      <CardContent className="space-y-4">
        {steps.map((step) => <label key={step.step_key} className="flex items-start gap-3 rounded-lg border p-4">
          <Checkbox checked={Boolean(step.completed_at) || Boolean(checked[step.step_key])} disabled={Boolean(step.completed_at)} onCheckedChange={(value) => setChecked((current) => ({ ...current, [step.step_key]: value === true }))} />
          <span>{labels[step.step_key] || step.step_key}</span>
        </label>)}
        <Button disabled={!ready || busy} onClick={() => void complete()}>{busy ? 'Completing…' : 'Complete onboarding'}</Button>
      </CardContent>
    </Card>
  </main>;
}
