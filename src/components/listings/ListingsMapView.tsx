import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import MarkerClusterGroup from 'react-leaflet-cluster';
import { Button } from '@/components/ui/button';
import { MapPin } from 'lucide-react';
import { PropertyListing } from '@/lib/airtable';

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
  point: { lat: number; lng: number };
}

function markerFromListing(listing: PropertyListing): GeocodedMarker | null {
  if (
    listing.latitude === null ||
    listing.latitude === undefined ||
    listing.latitude === '' ||
    listing.longitude === null ||
    listing.longitude === undefined ||
    listing.longitude === ''
  ) {
    return null;
  }
  const lat = Number(listing.latitude);
  const lng = Number(listing.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { listing, point: { lat, lng } };
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
  const markers = useMemo(() => {
    return listings
      .map(markerFromListing)
      .filter((marker): marker is GeocodedMarker => marker !== null);
  }, [listings]);
  const missingCoordinates = listings.length - markers.length;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 shadow-[0_14px_40px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-background/40">
      <div className="absolute left-4 top-4 z-[500] flex items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-1.5 text-xs font-semibold text-foreground shadow-md backdrop-blur">
        <MapPin className="h-3.5 w-3.5 text-primary" />
        {markers.length} of {listings.length} plotted
        {missingCoordinates > 0 && (
          <span className="text-muted-foreground">· {missingCoordinates} need coordinates</span>
        )}
      </div>

      {listings.length > 0 && markers.length === 0 && (
        <div className="absolute inset-x-4 bottom-4 z-[500] rounded-xl border border-border/60 bg-background/90 p-4 text-sm shadow-md backdrop-blur">
          <p className="font-semibold text-foreground">No listings have map coordinates</p>
          <p className="mt-1 text-muted-foreground">
            Add latitude and longitude to listing records to plot them without sharing private
            addresses with an external geocoding service.
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
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds markers={markers} />
        <MarkerClusterGroup
          chunkedLoading
          showCoverageOnHover={false}
          spiderfyOnMaxZoom
          maxClusterRadius={55}
        >
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
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  );
}

export default ListingsMapView;
