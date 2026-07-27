import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import MarkerClusterGroup from 'react-leaflet-cluster';
import { Button } from '@/components/ui/button';
import { Loader2, MapPin } from 'lucide-react';
import { PropertyListing } from '@/lib/airtable';
import { buildFullAddress } from '@/lib/addressUtils';
import { geocodeAddress, type GeoPoint } from '@/lib/geocode';

// Fix default marker icons for bundlers that don't handle Leaflet's asset URLs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const AUSTRALIA_CENTER: [number, number] = [-25.2744, 133.7751];
const AUSTRALIA_ZOOM = 4;

interface ListingsMapViewProps {
  listings: PropertyListing[];
  onSelectListing: (listing: PropertyListing) => void;
}

interface GeocodedMarker {
  listing: PropertyListing;
  point: GeoPoint;
}

function buildGeocodeQuery(listing: PropertyListing): string | null {
  const full = buildFullAddress(listing);
  if (full && full.trim().length > 0) return full;
  const parts = [listing.address, listing.suburb, listing.state].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(', ') : null;
}

function FitBounds({ markers }: { markers: GeocodedMarker[] }) {
  const map = useMap();
  useEffect(() => {
    if (markers.length === 0) return;
    if (markers.length === 1) {
      map.setView([markers[0].point.lat, markers[0].point.lng], 14);
      return;
    }
    const bounds = L.latLngBounds(
      markers.map((m) => [m.point.lat, m.point.lng] as [number, number]),
    );
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [markers, map]);
  return null;
}

export function ListingsMapView({ listings, onSelectListing }: ListingsMapViewProps) {
  const [markers, setMarkers] = useState<GeocodedMarker[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
  const cancelledRef = useRef(false);

  const queries = useMemo(() => {
    return listings
      .map((listing) => ({ listing, query: buildGeocodeQuery(listing) }))
      .filter((row): row is { listing: PropertyListing; query: string } => !!row.query);
  }, [listings]);

  useEffect(() => {
    cancelledRef.current = false;
    setMarkers([]);
    setProgress({ done: 0, total: queries.length, failed: 0 });

    (async () => {
      for (const { listing, query } of queries) {
        if (cancelledRef.current) return;
        try {
          const point = await geocodeAddress(query);
          if (cancelledRef.current) return;
          if (point) {
            setMarkers((prev) => [...prev, { listing, point }]);
            setProgress((p) => ({ ...p, done: p.done + 1 }));
          } else {
            setProgress((p) => ({ ...p, done: p.done + 1, failed: p.failed + 1 }));
          }
        } catch {
          setProgress((p) => ({ ...p, done: p.done + 1, failed: p.failed + 1 }));
        }
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [queries]);

  const isGeocoding = progress.total > 0 && progress.done < progress.total;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 shadow-[0_14px_40px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-background/40">
      <div className="absolute left-4 top-4 z-[500] flex items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-1.5 text-xs font-semibold text-foreground shadow-md backdrop-blur">
        {isGeocoding ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            Geocoding {progress.done}/{progress.total}
          </>
        ) : (
          <>
            <MapPin className="h-3.5 w-3.5 text-primary" />
            {markers.length} of {progress.total} plotted
            {progress.failed > 0 && (
              <span className="text-muted-foreground">· {progress.failed} unmatched</span>
            )}
          </>
        )}
      </div>

      <MapContainer
        center={AUSTRALIA_CENTER}
        zoom={AUSTRALIA_ZOOM}
        scrollWheelZoom
        style={{ height: '70vh', width: '100%', minHeight: 480 }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds markers={markers} />
        {markers.map(({ listing, point }) => (
          <Marker key={listing.id} position={[point.lat, point.lng]}>
            <Popup>
              <div className="min-w-[220px] space-y-1.5">
                <div className="text-sm font-semibold text-foreground">
                  {listing.address || 'Unknown Address'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {[listing.suburb, listing.state, listing.zipCode]
                    .filter(Boolean)
                    .join(' ')}
                </div>
                {listing.price ? (
                  <div className="text-sm font-semibold tabular-nums text-primary">
                    {new Intl.NumberFormat('en-AU', {
                      style: 'currency',
                      currency: 'AUD',
                      maximumFractionDigits: 0,
                    }).format(listing.price)}
                  </div>
                ) : null}
                <Button
                  size="sm"
                  className="mt-1 w-full"
                  onClick={() => onSelectListing(listing)}
                >
                  Open details
                </Button>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

export default ListingsMapView;
