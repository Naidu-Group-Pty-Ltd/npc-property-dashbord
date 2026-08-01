import { useCallback, useEffect, useState } from 'react';
import { Loader2, Camera, ExternalLink, RefreshCw } from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Button } from '@/components/ui/button';

interface StreetViewPanelProps {
  lat: number;
  lng: number;
  label?: string;
  className?: string;
}

/**
 * Why these are separate states rather than one "unavailable":
 *
 * The panel used to render every failure as "Google has no panorama coverage
 * for this location", which is a claim about Google. When the backend was
 * answering 429 for every request — the shared rate limiter it depends on had
 * never been migrated — the panel dutifully told everyone that Google had no
 * imagery for every address in the country. A wrong explanation is worse than
 * no explanation: it sends people looking in the wrong place.
 */
type Status =
  | 'loading'
  /** Imagery returned. */
  | 'available'
  /** Google genuinely has no panorama here. The only state that may say so. */
  | 'no_coverage'
  /** No API key configured for this workspace — an administrator fixes this. */
  | 'not_configured'
  /** Rate limited or the provider circuit is open. Retrying later works. */
  | 'busy'
  /** Anything else. */
  | 'error';

interface StreetViewState {
  status: Status;
  imageDataUrl?: string;
  panoramaDate?: string | null;
}

function classify(error: unknown, data: Record<string, unknown> | null | undefined): Status {
  const code = String((data as { error?: unknown })?.error ?? '').toLowerCase();
  if (code === 'street_view_not_configured') return 'not_configured';
  if (code === 'rate_limited' || code === 'temporarily_unavailable' || code === 'daily_quota_exceeded') {
    return 'busy';
  }
  if (code === 'invalid_location') return 'error';
  return error ? 'error' : 'error';
}

const MESSAGES: Record<Exclude<Status, 'loading' | 'available'>, { title: string; detail: string }> = {
  no_coverage: {
    title: 'No Street View here',
    detail: 'Google has no panorama coverage for this location.',
  },
  not_configured: {
    title: 'Street View not configured',
    detail: 'No Google Maps key is set for this workspace. An administrator can add one in Settings.',
  },
  busy: {
    title: 'Street View is busy',
    detail: 'Too many requests right now, or the provider is briefly unavailable. Try again shortly.',
  },
  error: {
    title: "Street View didn't load",
    detail: 'Something went wrong fetching the imagery. This is not a coverage problem.',
  },
};

export function StreetViewPanel({ lat, lng, label, className }: StreetViewPanelProps) {
  const [state, setState] = useState<StreetViewState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    (async () => {
      const { data, error } = await invokeSecureFunction<{
        success?: boolean;
        available?: boolean;
        status?: string;
        error?: string;
        imageDataUrl?: string;
        panoramaDate?: string | null;
      }>('street-view', { lat, lng });
      if (cancelled) return;

      if (error || !data?.success) {
        setState({ status: classify(error, data) });
        return;
      }
      if (!data.available) {
        // `success: true, available: false` with ZERO_RESULTS is the one case
        // where blaming Google is accurate. Anything else here is an upstream
        // fault (an image fetch that failed, a quota answer) and should not be
        // reported to the user as missing coverage.
        setState({ status: data.status === 'ZERO_RESULTS' ? 'no_coverage' : 'error' });
        return;
      }
      setState({
        status: 'available',
        imageDataUrl: data.imageDataUrl,
        panoramaDate: data.panoramaDate ?? null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [lat, lng, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const mapsUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
  const failed = state.status !== 'loading' && state.status !== 'available';
  const message = failed ? MESSAGES[state.status as keyof typeof MESSAGES] : null;
  // Retrying a genuine coverage gap or a missing key just repeats the answer.
  const canRetry = state.status === 'busy' || state.status === 'error';

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Camera className="h-3.5 w-3.5 text-primary" />
          Street View
        </span>
        {state.status === 'available' && state.panoramaDate ? (
          <span className="text-[10px] text-muted-foreground">{state.panoramaDate}</span>
        ) : null}
      </div>

      <div className="relative overflow-hidden rounded-lg border border-border/60 bg-muted/30">
        {state.status === 'loading' && (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            <span className="sr-only">Loading Street View imagery</span>
          </div>
        )}

        {state.status === 'available' && state.imageDataUrl && (
          <img
            src={state.imageDataUrl}
            alt={label ? `Street View of ${label}` : 'Street View of the property location'}
            className="h-32 w-full object-cover"
            loading="lazy"
          />
        )}

        {message && (
          <div className="flex h-32 flex-col items-center justify-center gap-1.5 px-3 text-center">
            <p className="text-xs font-medium text-foreground">{message.title}</p>
            <p className="text-[11px] leading-4 text-muted-foreground">{message.detail}</p>
            {canRetry && (
              <Button
                variant="outline"
                size="sm"
                className="mt-1 h-6 gap-1 px-2 text-[10px]"
                onClick={retry}
              >
                <RefreshCw className="h-3 w-3" />
                Try again
              </Button>
            )}
          </div>
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="mt-1 h-7 w-full gap-1.5 text-[11px]"
        onClick={() => window.open(mapsUrl, '_blank', 'noopener,noreferrer')}
      >
        <ExternalLink className="h-3 w-3" />
        Open in Google Maps
      </Button>
    </div>
  );
}

export default StreetViewPanel;
