import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import MarkerClusterGroup from 'react-leaflet-cluster';
import { Button } from '@/components/ui/button';
import { MapPin, Loader2, Flame, LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PropertyListing } from '@/lib/airtable';
import { useListingCoordinates } from '@/hooks/useListingCoordinates';
import { HeatLayer, type HeatPoint } from './ListingsHeatLayer';
import { StreetViewPanel } from './StreetViewPanel';

interface GeoPoint {
  lat: number;
  lng: number;
}

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

type MapMode = 'pins' | 'heat' | 'hybrid';

interface ListingsMapViewProps {
  listings: PropertyListing[];
  onSelectListing: (listing: PropertyListing) => void;
}

interface ListingMarker {
  listing: PropertyListing;
  point: GeoPoint;
}

/** Coordinates already present on the source record — no lookup involved. */
export function getStoredListingPoint(listing: PropertyListing): GeoPoint | null {
  if (listing.latitude === null || listing.latitude === undefined || listing.latitude === '') {
    return null;
  }
  if (listing.longitude === null || listing.longitude === undefined || listing.longitude === '') {
    return null;
  }
  const lat = Number(listing.latitude);
  const lng = Number(listing.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

const currency = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
  notation: 'compact',
});

function priceMarkerIcon(price: number | null | undefined) {
  const label = typeof price === 'number' && price > 0 ? currency.format(price) : '•';
  return L.divIcon({
    className: 'listing-price-marker',
    html: `<span class="listing-price-marker__chip">${label}</span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function FitBounds({ markers }: { markers: ListingMarker[] }) {
  const map = useMap();
  useEffect(() => {
    if (markers.length === 0) return;
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (markers.length === 1) {
      map.setView([markers[0].point.lat, markers[0].point.lng], 14, { animate: !reduceMotion });
      return;
    }
    const bounds = L.latLngBounds(
      markers.map((m) => [m.point.lat, m.point.lng] as [number, number]),
    );
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15, animate: !reduceMotion });
  }, [markers, map]);
  return null;
}

export function ListingsMapView({ listings, onSelectListing }: ListingsMapViewProps) {
  const [mode, setMode] = useState<MapMode>('hybrid');
  const { points, isResolving } = useListingCoordinates(listings);

  const markers = useMemo<ListingMarker[]>(() => {
    return listings
      .map((listing) => {
        const resolved = points[listing.id];
        const point = resolved
          ? { lat: resolved.lat, lng: resolved.lng }
          : getStoredListingPoint(listing);
        return { listing, point };
      })
      .filter((row): row is ListingMarker => row.point !== null);
  }, [listings, points]);

  const heatPoints = useMemo<HeatPoint[]>(() => {
    const prices = markers
      .map((m) => (typeof m.listing.price === 'number' ? m.listing.price : 0))
      .filter((p) => p > 0);
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
    return markers.map(({ listing, point }) => {
      const price = typeof listing.price === 'number' ? listing.price : 0;
      const weight = maxPrice > 0 && price > 0 ? 0.35 + 0.65 * (price / maxPrice) : 0.5;
      return { lat: point.lat, lng: point.lng, intensity: weight };
    });
  }, [markers]);

  const unplotted = listings.length - markers.length;
  const showPins = mode === 'pins' || mode === 'hybrid';
  const showHeat = mode === 'heat' || mode === 'hybrid';

  const modes: Array<{ value: MapMode; label: string; icon: typeof MapPin }> = [
    { value: 'pins', label: 'Pins', icon: MapPin },
    { value: 'heat', label: 'Heat', icon: Flame },
    { value: 'hybrid', label: 'Both', icon: LayoutGrid },
  ];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 shadow-[0_14px_40px_hsl(var(--foreground)/0.08)] dark:border-white/10 dark:bg-background/40">
      <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex flex-wrap items-center justify-between gap-2">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border/60 bg-background/85 px-3 py-1.5 text-xs font-semibold text-foreground shadow-md backdrop-blur">
          <MapPin className="h-3.5 w-3.5 text-primary" />
          {markers.length} of {listings.length} plotted
          {isResolving && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground motion-reduce:animate-none" />
          )}
          {unplotted > 0 && !isResolving && (
            <span className="font-normal text-muted-foreground">· {unplotted} unmapped</span>
          )}
        </div>

        <div
          className="pointer-events-auto flex items-center gap-1 rounded-full border border-border/60 bg-background/85 p-1 shadow-md backdrop-blur"
          role="group"
          aria-label="Map display mode"
        >
          {modes.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                mode === value
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {showHeat && markers.length > 0 && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-[500] rounded-xl border border-border/60 bg-background/85 px-3 py-2 shadow-md backdrop-blur">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Density · price weighted
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Low</span>
            <div className="h-2 w-28 rounded-full bg-gradient-to-r from-success via-primary to-destructive" />
            <span className="text-[10px] text-muted-foreground">High</span>
          </div>
        </div>
      )}

      {listings.length > 0 && markers.length === 0 && !isResolving && (
        <div className="absolute inset-x-4 bottom-4 z-[500] rounded-xl border border-border/60 bg-background/90 p-4 text-sm shadow-md backdrop-blur">
          <p className="font-semibold text-foreground">No listings could be placed on the map</p>
          <p className="mt-1 text-muted-foreground">
            Addresses are resolved securely on the server. Add a street address and suburb to the
            listing records so they can be located.
          </p>
        </div>
      )}

      <MapContainer
        center={AUSTRALIA_CENTER}
        zoom={AUSTRALIA_ZOOM}
        scrollWheelZoom
        style={{ height: '70vh', width: '100%', minHeight: 480 }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />
        <FitBounds markers={markers} />
        <HeatLayer points={heatPoints} visible={showHeat} />

        {showPins && (
          <MarkerClusterGroup
            chunkedLoading
            showCoverageOnHover={false}
            spiderfyOnMaxZoom
            maxClusterRadius={55}
          >
            {markers.map(({ listing, point }) => (
              <Marker
                key={listing.id}
                position={[point.lat, point.lng]}
                icon={priceMarkerIcon(listing.price)}
              >
                <Popup>
                  <div className="min-w-[240px] space-y-2">
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        {listing.address || 'Unknown Address'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {[listing.suburb, listing.state, listing.zipCode].filter(Boolean).join(' ')}
                      </div>
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

                    <StreetViewPanel
                      lat={point.lat}
                      lng={point.lng}
                      label={listing.address || listing.suburb || undefined}
                    />

                    <Button size="sm" className="w-full" onClick={() => onSelectListing(listing)}>
                      Open details
                    </Button>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MarkerClusterGroup>
        )}
      </MapContainer>
    </div>
  );
}

export default ListingsMapView;
