import { useEffect, useState } from 'react';
import { Loader2, Camera, ExternalLink } from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Button } from '@/components/ui/button';

interface StreetViewPanelProps {
  lat: number;
  lng: number;
  label?: string;
  className?: string;
}

interface StreetViewState {
  status: 'loading' | 'available' | 'unavailable' | 'error';
  imageDataUrl?: string;
  panoramaDate?: string | null;
  copyright?: string | null;
}

export function StreetViewPanel({ lat, lng, label, className }: StreetViewPanelProps) {
  const [state, setState] = useState<StreetViewState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    (async () => {
      const { data, error } = await invokeSecureFunction('street-view', { lat, lng });
      if (cancelled) return;
      if (error || !data?.success) {
        setState({ status: 'error' });
        return;
      }
      if (!data.available) {
        setState({ status: 'unavailable' });
        return;
      }
      setState({
        status: 'available',
        imageDataUrl: data.imageDataUrl,
        panoramaDate: data.panoramaDate ?? null,
        copyright: data.copyright ?? null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  const mapsUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;

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

        {(state.status === 'unavailable' || state.status === 'error') && (
          <div className="flex h-32 flex-col items-center justify-center gap-1.5 px-3 text-center">
            <p className="text-xs font-medium text-foreground">
              {state.status === 'error' ? 'Street View unavailable' : 'No street imagery here'}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Google has no panorama coverage for this location.
            </p>
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
