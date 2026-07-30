import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useSolicitorPortalAuth } from '@/hooks/useSolicitorPortalAuth';
import { invokeSolicitorFunction } from '@/lib/solicitorPortal';

interface TermsVersion { title: string; version: string; content_markdown: string }
interface GovernanceResponse { terms?: TermsVersion }

export default function SolicitorTerms() {
  const [terms, setTerms] = useState<TermsVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const { acceptTerms } = useSolicitorPortalAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    void invokeSolicitorFunction<GovernanceResponse>('solicitor-portal-verify', { action: 'get_governance' })
      .then(({ data, error }) => {
        if (error) toast({ title: 'Unable to load terms', description: error.message, variant: 'destructive' });
        setTerms(data?.terms ?? null);
      });
  }, [toast]);

  const accept = async () => {
    setBusy(true);
    try {
      await acceptTerms();
      navigate('/solicitor/onboarding', { replace: true });
    } catch (error) {
      toast({ title: 'Acceptance was not recorded', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    } finally { setBusy(false); }
  };

  return <main className="min-h-screen bg-background p-6">
    <Card className="mx-auto max-w-3xl">
      <CardHeader>
        <CardTitle>{terms?.title || 'Solicitor Portal Terms'}</CardTitle>
        <p className="text-sm text-muted-foreground">Version {terms?.version || 'current'} · Acceptance is recorded against this exact version.</p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-4 text-sm text-foreground" aria-live="polite">
          {terms?.content_markdown || 'Loading current terms…'}
        </div>
        <Button disabled={!terms || busy} onClick={() => void accept()}>{busy ? 'Recording acceptance…' : 'Accept current terms'}</Button>
      </CardContent>
    </Card>
  </main>;
}
