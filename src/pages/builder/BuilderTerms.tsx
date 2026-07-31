import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useBuilderPortalAuth } from '@/hooks/useBuilderPortalAuth';
import { builderLoadGovernance, type BuilderTermsVersion } from '@/lib/builderPortal';

/**
 * Builder / Developer Portal terms acceptance.
 *
 * Mirrors `SolicitorTerms`. Acceptance is recorded server-side against the exact
 * terms version that was served, for the authenticated user — this page cannot
 * nominate whose acceptance is being recorded.
 */
export default function BuilderTerms() {
  const { acceptTerms } = useBuilderPortalAuth();
  const navigate = useNavigate();

  const [terms, setTerms] = useState<BuilderTermsVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  const handleAccept = async () => {
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
    <main className="min-h-screen bg-background px-4 py-10">
      <Card className="mx-auto max-w-3xl">
        <CardHeader>
          <CardTitle>{terms?.title || 'Builder / Developer Portal terms'}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {terms
              ? `Version ${terms.version} · Your acceptance is recorded against this exact version.`
              : 'Your acceptance is recorded against the exact version shown here.'}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div
            className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/30 p-4 text-sm text-foreground"
            aria-live="polite"
            aria-busy={loading}
            tabIndex={0}
          >
            {loading
              ? 'Loading the current terms…'
              : terms?.content_markdown
                || 'No current terms are published for this portal. Contact your administrator — access cannot continue until terms are available.'}
          </div>

          <Button disabled={!terms || submitting} onClick={() => void handleAccept()}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            Accept current terms
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
