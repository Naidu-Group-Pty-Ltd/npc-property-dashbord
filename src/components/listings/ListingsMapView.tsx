import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, ScaleControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import MarkerClusterGroup from 'react-leaflet-cluster';
import {
  AlertTriangle,
  Bath,
  BedDouble,
  Building2,
  CalendarClock,
  Car,
  ChevronDown,
  Crosshair,
  Flame,
  Layers,
  LayoutGrid,
  Loader2,
  MapPin,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { PropertyListing } from '@/lib/airtable';
import { useWhiteLabel } from '@/contexts/WhiteLabelContext';
import { useListingCoordinates } from '@/hooks/useListingCoordinates';
import { HeatLayer } from './ListingsHeatLayer';
import { StreetViewPanel } from './StreetViewPanel';
import {
  buildHeatModel,
  computePriceTiers,
  describeHeatLegend,
  escapeHtml,
  formatCompactAud,
  formatFullAud,
  getStoredListingPoint,
  isBasemapId,
  isHeatFocus,
  isHeatMetric,
  isMapMode,
  listingSetSignature,
  priceTier,
  type BasemapId,
  type GeoPoint,
  type HeatFocus,
  type HeatMetric,
  type MapMode,
  type PriceTier,
  type PriceTiers,
} from '@/lib/listingsMap';

export type { GeoPoint } from '@/lib/listingsMap';

// Fix default marker icons for bundlers that don't handle Leaflet's asset URLs.
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const AUSTRALIA_CENTER: [number, number] = [-25.2744, 133.7751];
const AUSTRALIA_ZOOM = 4;
const MIN_ZOOM = 3;
const MAX_ZOOM = 19;
/** Below this zoom the price chips overlap into noise, so pins collapse to dots. */
const CHIP_ZOOM_THRESHOLD = 11;

const STORAGE_KEYS = {
  mode: 'npc.listings.map.mode',
  basemap: 'npc.listings.map.basemap',
  metric: 'npc.listings.map.heatMetric',
  focus: 'npc.listings.map.heatFocus',
} as const;

interface ListingsMapViewProps {
  listings: PropertyListing[];
  onSelectListing: (listing: PropertyListing) => void;
}

interface ListingMarker {
  listing: PropertyListing;
  point: GeoPoint;
}

type PinVariant = 'chip' | 'dot' | 'ghost';

/* -------------------------------------------------------------------------- */
/* Basemaps                                                                    */
/* -------------------------------------------------------------------------- */

interface BasemapDefinition {
  id: Exclude<BasemapId, 'auto'>;
  url: string;
  attribution: string;
  labelsUrl?: string;
  maxNativeZoom: number;
  /** Tiles are dark, so overlays need the inverted treatment. */
  dark: boolean;
}

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CARTO_ATTRIBUTION = '&copy; <a href="https://carto.com/attributions">CARTO</a>';

const BASEMAP_DEFS: Record<Exclude<BasemapId, 'auto'>, BasemapDefinition> = {
  light: {
    id: 'light',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: `${OSM_ATTRIBUTION} ${CARTO_ATTRIBUTION}`,
    maxNativeZoom: 19,
    dark: false,
  },
  dark: {
    id: 'dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: `${OSM_ATTRIBUTION} ${CARTO_ATTRIBUTION}`,
    maxNativeZoom: 19,
    dark: true,
  },
  satellite: {
    id: 'satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    labelsUrl:
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    maxNativeZoom: 18,
    dark: true,
  },
};

const BASEMAP_LABELS: Record<BasemapId, string> = {
  auto: 'Match theme',
  light: 'Street',
  dark: 'Midnight',
  satellite: 'Satellite',
};

function resolveBasemap(preference: BasemapId, isDark: boolean): BasemapDefinition {
  if (preference === 'auto') return isDark ? BASEMAP_DEFS.dark : BASEMAP_DEFS.light;
  return BASEMAP_DEFS[preference];
}

/* -------------------------------------------------------------------------- */
/* Marker icons                                                                */
/* -------------------------------------------------------------------------- */

const CHIP_HEIGHT = 24;
const STEM_HEIGHT = 7;
const DOT_SIZE = 16;
const GHOST_SIZE = 22;

const iconCache = new Map<string, L.DivIcon>();

function cacheIcon(key: string, factory: () => L.DivIcon): L.DivIcon {
  const hit = iconCache.get(key);
  if (hit) return hit;
  // Labels are unbounded (one per distinct price), so keep the cache honest.
  if (iconCache.size > 600) iconCache.clear();
  const icon = factory();
  iconCache.set(key, icon);
  return icon;
}

function pinIcon(variant: PinVariant, tier: PriceTier, label: string | null): L.DivIcon {
  if (variant === 'ghost') {
    return cacheIcon('ghost', () =>
      L.divIcon({
        className: 'listing-pin listing-pin--ghost',
        html: '<span class="listing-pin__dot"></span>',
        iconSize: [GHOST_SIZE, GHOST_SIZE],
        iconAnchor: [GHOST_SIZE / 2, GHOST_SIZE / 2],
        popupAnchor: [0, -GHOST_SIZE / 2],
      }),
    );
  }

  if (variant === 'dot' || !label) {
    return cacheIcon(`dot|${tier}`, () =>
      L.divIcon({
        className: `listing-pin listing-pin--dot listing-pin--${tier}`,
        html: '<span class="listing-pin__dot"></span>',
        iconSize: [DOT_SIZE, DOT_SIZE],
        iconAnchor: [DOT_SIZE / 2, DOT_SIZE / 2],
        popupAnchor: [0, -DOT_SIZE / 2],
      }),
    );
  }

  return cacheIcon(`chip|${tier}|${label}`, () => {
    // Estimated so the icon box matches the rendered chip: Leaflet needs real
    // dimensions for hit-testing, anchoring, and cluster spiderfy geometry.
    const width = Math.max(40, Math.round(22 + label.length * 7.2));
    const height = CHIP_HEIGHT + STEM_HEIGHT;
    return L.divIcon({
      className: `listing-pin listing-pin--chip listing-pin--${tier}`,
      html:
        `<span class="listing-pin__chip">${escapeHtml(label)}</span>` +
        '<span class="listing-pin__stem" aria-hidden="true"></span>',
      iconSize: [width, height],
      iconAnchor: [width / 2, height],
      popupAnchor: [0, -height],
    });
  });
}

function clusterSizeTier(count: number): { tier: string; size: number } {
  if (count < 10) return { tier: 'sm', size: 34 };
  if (count < 50) return { tier: 'md', size: 42 };
  if (count < 250) return { tier: 'lg', size: 50 };
  return { tier: 'xl', size: 58 };
}

function makeClusterIconFactory(ghost: boolean) {
  return (cluster: { getChildCount: () => number }): L.DivIcon => {
    const count = cluster.getChildCount();
    const { tier, size } = clusterSizeTier(count);
    const compact = count > 999 ? `${Math.round(count / 1000)}k` : String(count);
    return L.divIcon({
      className: cn(
        'listings-cluster',
        `listings-cluster--${tier}`,
        ghost && 'listings-cluster--ghost',
      ),
      html: `<span class="listings-cluster__ring" aria-hidden="true"></span><span class="listings-cluster__count">${escapeHtml(compact)}</span>`,
      iconSize: L.point(size, size),
      iconAnchor: [size / 2, size / 2],
    });
  };
}

const clusterRadius = (zoom: number) => (zoom >= 15 ? 24 : zoom >= 12 ? 42 : 62);

/* -------------------------------------------------------------------------- */
/* Persisted preference hook                                                   */
/* -------------------------------------------------------------------------- */

function usePersistedChoice<T extends string>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return fallback;
    try {
      const stored = window.localStorage.getItem(key);
      return isValid(stored) ? stored : fallback;
    } catch {
      return fallback;
    }
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        /* storage can be unavailable (private mode, quota) — preference is optional */
      }
    },
    [key],
  );

  return [value, update];
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* -------------------------------------------------------------------------- */
/* Presentational pieces                                                       */
/* -------------------------------------------------------------------------- */

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: typeof MapPin;
  title?: string;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (next: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 rounded-full border border-border/60 bg-background/85 shadow-md backdrop-blur',
        size === 'md' ? 'p-1' : 'p-0.5',
      )}
      role="group"
      aria-label={label}
    >
      {options.map(({ value: optionValue, label: optionLabel, icon: Icon, title }) => {
        const active = value === optionValue;
        return (
          <button
            key={optionValue}
            type="button"
            onClick={() => onChange(optionValue)}
            aria-pressed={active}
            title={title ?? optionLabel}
            className={cn(
              'flex items-center gap-1.5 rounded-full font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
              size === 'md' ? 'px-3 py-1.5 text-xs' : 'px-2.5 py-1 text-[11px]',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
            {optionLabel}
          </button>
        );
      })}
    </div>
  );
}

function MapIconButton({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-9 w-9 items-center justify-center border-b border-border/50 bg-background/90 text-foreground transition-colors',
        'first:rounded-t-xl last:rounded-b-xl last:border-b-0',
        'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50',
        'disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      {children}
    </button>
  );
}

const PIN_TIER_LEGEND: Array<{ tier: PriceTier; label: string }> = [
  { tier: 'low', label: 'Lower quartile' },
  { tier: 'mid', label: 'Below median' },
  { tier: 'high', label: 'Upper mid' },
  { tier: 'top', label: 'Top quartile' },
];

/* -------------------------------------------------------------------------- */
/* Markers layer                                                               */
/* -------------------------------------------------------------------------- */

interface ListingMarkersProps {
  markers: ListingMarker[];
  tiers: PriceTiers | null;
  variant: PinVariant;
  onSelect: (id: string) => void;
}

const ListingMarkers = memo(function ListingMarkers({
  markers,
  tiers,
  variant,
  onSelect,
}: ListingMarkersProps) {
  const ghost = variant === 'ghost';
  const iconFactory = useMemo(() => makeClusterIconFactory(ghost), [ghost]);

  if (markers.length === 0) return null;

  return (
    <MarkerClusterGroup
      // The cluster group only reads its options once, so switching between the
      // solid and ghost cluster styles has to remount it. Chip ↔ dot only
      // changes the child markers, so it deliberately shares a key.
      key={ghost ? 'ghost' : 'solid'}
      chunkedLoading
      showCoverageOnHover={false}
      spiderfyOnMaxZoom
      removeOutsideVisibleBounds
      maxClusterRadius={clusterRadius}
      iconCreateFunction={iconFactory}
      polygonOptions={{ opacity: 0, fillOpacity: 0 }}
    >
      {markers.map(({ listing, point }) => {
        const label = formatCompactAud(listing.price);
        const tier = priceTier(listing.price, tiers);
        const title = [listing.address || listing.suburb || 'Listing', formatFullAud(listing.price)]
          .filter(Boolean)
          .join(' · ');
        return (
          <Marker
            key={listing.id}
            position={[point.lat, point.lng]}
            icon={pinIcon(variant, tier, label)}
            title={title}
            alt={title}
            riseOnHover
            keyboard
            eventHandlers={{ click: () => onSelect(listing.id) }}
          />
        );
      })}
    </MarkerClusterGroup>
  );
});

/* -------------------------------------------------------------------------- */
/* Popup card                                                                  */
/* -------------------------------------------------------------------------- */

function MetaChip({ icon: Icon, value }: { icon: typeof BedDouble; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground">
      <Icon className="h-3 w-3 text-muted-foreground" />
      {value}
    </span>
  );
}

function ListingPopupCard({
  listing,
  point,
  onOpenDetails,
}: {
  listing: PropertyListing;
  point: GeoPoint;
  onOpenDetails: () => void;
}) {
  const locality = [listing.suburb, listing.state, listing.zipCode].filter(Boolean).join(' ');
  const price = formatFullAud(listing.price);
  const beds = listing.beds ?? listing.bedrooms;
  const baths = listing.baths ?? listing.bathrooms;

  return (
    <div className="min-w-[248px] max-w-[280px] space-y-2.5">
      <div>
        <h3 className="text-sm font-semibold leading-snug text-foreground">
          {listing.address || listing.title || 'Unknown address'}
        </h3>
        {locality ? <p className="text-xs text-muted-foreground">{locality}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {price ? (
          <span className="text-sm font-semibold tabular-nums text-primary">{price}</span>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">Price undisclosed</span>
        )}
        {listing.propertyType ? (
          <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {listing.propertyType}
          </span>
        ) : null}
      </div>

      {(beds || baths || listing.carSpaces || listing.landSize) && (
        <div className="flex flex-wrap gap-1.5">
          {beds ? <MetaChip icon={BedDouble} value={`${beds} bed`} /> : null}
          {baths ? <MetaChip icon={Bath} value={`${baths} bath`} /> : null}
          {listing.carSpaces ? <MetaChip icon={Car} value={`${listing.carSpaces} car`} /> : null}
          {listing.landSize ? (
            <MetaChip icon={Building2} value={`${listing.landSize}`} />
          ) : null}
        </div>
      )}

      <StreetViewPanel
        lat={point.lat}
        lng={point.lng}
        label={listing.address || listing.suburb || undefined}
      />

      <Button size="sm" className="w-full" onClick={onOpenDetails}>
        Open details
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main view                                                                   */
/* -------------------------------------------------------------------------- */

export function ListingsMapView({ listings, onSelectListing }: ListingsMapViewProps) {
  const { isDark } = useWhiteLabel();
  const [mode, setMode] = usePersistedChoice<MapMode>(STORAGE_KEYS.mode, 'hybrid', isMapMode);
  const [basemapPref, setBasemapPref] = usePersistedChoice<BasemapId>(
    STORAGE_KEYS.basemap,
    'auto',
    isBasemapId,
  );
  const [heatMetric, setHeatMetric] = usePersistedChoice<HeatMetric>(
    STORAGE_KEYS.metric,
    'density',
    isHeatMetric,
  );
  const [heatFocus, setHeatFocus] = usePersistedChoice<HeatFocus>(
    STORAGE_KEYS.focus,
    'balanced',
    isHeatFocus,
  );

  const [map, setMap] = useState<L.Map | null>(null);
  const [zoom, setZoom] = useState(AUSTRALIA_ZOOM);
  const [inViewCount, setInViewCount] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);

  const shellRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<L.Popup | null>(null);
  const markersRef = useRef<ListingMarker[]>([]);
  const userMovedRef = useRef(false);
  const programmaticUntilRef = useRef(0);
  const reducedMotion = useMemo(prefersReducedMotion, []);

  const { points, isResolving } = useListingCoordinates(listings);

  const markers = useMemo<ListingMarker[]>(() => {
    const rows: ListingMarker[] = [];
    for (const listing of listings) {
      const resolved = points[listing.id];
      const point = resolved
        ? { lat: resolved.lat, lng: resolved.lng }
        : getStoredListingPoint(listing);
      if (point) rows.push({ listing, point });
    }
    return rows;
  }, [listings, points]);

  markersRef.current = markers;

  const unmappedListings = useMemo(() => {
    if (markers.length === listings.length) return [];
    const plotted = new Set(markers.map((m) => m.listing.id));
    return listings.filter((l) => !plotted.has(l.id));
  }, [listings, markers]);

  const tiers = useMemo(
    () =>
      computePriceTiers(
        markers.map((m) => (typeof m.listing.price === 'number' ? m.listing.price : 0)),
      ),
    [markers],
  );

  const heatModel = useMemo(() => buildHeatModel(markers, heatMetric), [markers, heatMetric]);
  const heatLegend = useMemo(() => describeHeatLegend(heatModel), [heatModel]);

  const showPins = mode === 'pins' || mode === 'hybrid';
  const showHeat = mode === 'heat' || mode === 'hybrid';
  const pinVariant: PinVariant = !showPins
    ? 'ghost'
    : zoom >= CHIP_ZOOM_THRESHOLD
      ? 'chip'
      : 'dot';

  const basemap = resolveBasemap(basemapPref, isDark);
  const selected = useMemo(
    () => markers.find((m) => m.listing.id === selectedId) ?? null,
    [markers, selectedId],
  );

  const markerSignature = useMemo(
    () => listingSetSignature(markers.map((m) => ({ id: m.listing.id }))),
    [markers],
  );
  const listingSignature = useMemo(() => listingSetSignature(listings), [listings]);

  /* ---------------------------------------------------------------------- */
  /* Map wiring                                                              */
  /* ---------------------------------------------------------------------- */

  const markProgrammatic = useCallback(() => {
    programmaticUntilRef.current =
      (typeof performance !== 'undefined' ? performance.now() : 0) + 600;
  }, []);

  const fitToMarkers = useCallback(
    (animate: boolean) => {
      const instance = map;
      const rows = markersRef.current;
      if (!instance || rows.length === 0) return;
      markProgrammatic();
      if (rows.length === 1) {
        instance.setView([rows[0].point.lat, rows[0].point.lng], 15, { animate });
        return;
      }
      const bounds = L.latLngBounds(
        rows.map((m) => [m.point.lat, m.point.lng] as [number, number]),
      );
      instance.fitBounds(bounds, { padding: [56, 56], maxZoom: 15, animate });
    },
    [map, markProgrammatic],
  );

  const recount = useCallback(() => {
    const instance = map;
    if (!instance) return;
    const bounds = instance.getBounds();
    let count = 0;
    for (const m of markersRef.current) {
      if (bounds.contains([m.point.lat, m.point.lng])) count += 1;
    }
    setInViewCount(count);
    setZoom(instance.getZoom());
  }, [map]);

  // Track user navigation so automatic re-framing never fights the user.
  useEffect(() => {
    if (!map) return;
    const onMoveStart = () => {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      if (now > programmaticUntilRef.current) userMovedRef.current = true;
    };
    const onMoveEnd = () => recount();
    map.on('movestart', onMoveStart);
    map.on('moveend', onMoveEnd);
    map.on('zoomend', onMoveEnd);
    recount();
    return () => {
      map.off('movestart', onMoveStart);
      map.off('moveend', onMoveEnd);
      map.off('zoomend', onMoveEnd);
    };
  }, [map, recount]);

  // A new filter result set is a new question — always re-frame it.
  useEffect(() => {
    userMovedRef.current = false;
  }, [listingSignature]);

  // Re-frame as coordinates resolve, unless the user has taken over.
  useEffect(() => {
    if (!map || markers.length === 0) return;
    if (userMovedRef.current) return;
    fitToMarkers(false);
  }, [map, markerSignature, markers.length, fitToMarkers]);

  // Leaflet renders grey tiles when its container resizes underneath it.
  useEffect(() => {
    if (!map || !shellRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    observer.observe(shellRef.current);
    return () => observer.disconnect();
  }, [map]);

  // Single shared popup: clear the selection only when *our* popup closes, not
  // when it is torn down to make way for the next one.
  useEffect(() => {
    if (!map) return;
    const onPopupClose = (event: L.PopupEvent) => {
      if (popupRef.current && event.popup === popupRef.current) setSelectedId(null);
    };
    map.on('popupclose', onPopupClose);
    return () => {
      map.off('popupclose', onPopupClose);
    };
  }, [map]);

  // Drop a selection that has been filtered off the map.
  useEffect(() => {
    if (selectedId && !markers.some((m) => m.listing.id === selectedId)) setSelectedId(null);
  }, [markers, selectedId]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => {
      const active = document.fullscreenElement === shellRef.current;
      setIsFullscreen(active);
      window.setTimeout(() => map?.invalidateSize({ animate: false }), 60);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [map]);

  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (!shell || typeof document === 'undefined') return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void shell.requestFullscreen?.();
    }
  }, []);

  const handleSelect = useCallback((id: string) => setSelectedId(id), []);

  const openSelectedDetails = useCallback(() => {
    if (!selected) return;
    map?.closePopup();
    onSelectListing(selected.listing);
  }, [map, onSelectListing, selected]);

  /* ---------------------------------------------------------------------- */
  /* Render                                                                  */
  /* ---------------------------------------------------------------------- */

  const modeOptions: SegmentedOption<MapMode>[] = [
    { value: 'pins', label: 'Pins', icon: MapPin, title: 'Show individual listing pins' },
    { value: 'heat', label: 'Heat', icon: Flame, title: 'Show the density surface only' },
    { value: 'hybrid', label: 'Both', icon: LayoutGrid, title: 'Overlay pins on the heat surface' },
  ];

  const metricOptions: SegmentedOption<HeatMetric>[] = [
    { value: 'density', label: 'Density', title: 'Every listing weighted equally' },
    { value: 'price', label: 'Price', title: 'Weighted by price on a log scale' },
    { value: 'recency', label: 'Fresh', title: 'Weighted by how recently it was listed' },
  ];

  const focusOptions: SegmentedOption<HeatFocus>[] = [
    { value: 'tight', label: 'Tight', title: 'Small radius, only true hotspots saturate' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'wide', label: 'Wide', title: 'Broad radius, regional patterns' },
  ];

  const plottedSummary = `${markers.length} of ${listings.length} plotted`;

  return (
    <div
      ref={shellRef}
      role="region"
      aria-label="Listings map"
      className={cn(
        'listings-map',
        'relative overflow-hidden border border-border/60 bg-card/60 shadow-[0_14px_40px_hsl(var(--foreground)/0.08)] dark:border-white/10 dark:bg-background/40',
        isFullscreen ? 'rounded-none' : 'rounded-2xl',
        basemap.dark && 'listings-map--dark-tiles',
      )}
      data-basemap={basemap.id}
    >
      <div
        className={cn(
          'relative w-full',
          isFullscreen ? 'h-screen' : 'h-[70vh] min-h-[480px] max-h-[860px]',
        )}
      >
        <MapContainer
          ref={setMap}
          center={AUSTRALIA_CENTER}
          zoom={AUSTRALIA_ZOOM}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          scrollWheelZoom
          zoomControl={false}
          worldCopyJump
          zoomAnimation={!reducedMotion}
          fadeAnimation={!reducedMotion}
          markerZoomAnimation={!reducedMotion}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            key={basemap.id}
            attribution={basemap.attribution}
            url={basemap.url}
            maxNativeZoom={basemap.maxNativeZoom}
            maxZoom={MAX_ZOOM}
            detectRetina
          />
          {basemap.labelsUrl ? (
            <TileLayer
              key={`${basemap.id}-labels`}
              url={basemap.labelsUrl}
              maxNativeZoom={basemap.maxNativeZoom}
              maxZoom={MAX_ZOOM}
              opacity={0.9}
            />
          ) : null}

          <ScaleControl position="bottomleft" imperial={false} />

          <HeatLayer
            points={heatModel.points}
            visible={showHeat}
            focus={heatFocus}
            minCeiling={heatModel.minCeiling}
            themeKey={`${isDark ? 'dark' : 'light'}:${basemap.id}`}
          />

          <ListingMarkers
            markers={markers}
            tiers={tiers}
            variant={pinVariant}
            onSelect={handleSelect}
          />

          {selected ? (
            <Popup
              key={selected.listing.id}
              ref={popupRef}
              position={[selected.point.lat, selected.point.lng]}
              maxWidth={300}
              minWidth={248}
              autoPanPadding={L.point(48, 72)}
              className="listings-map__popup"
            >
              <ListingPopupCard
                listing={selected.listing}
                point={selected.point}
                onOpenDetails={openSelectedDetails}
              />
            </Popup>
          ) : null}
        </MapContainer>
      </div>

      {/* Top bar --------------------------------------------------------- */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex flex-wrap items-start justify-between gap-2">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
          <div
            className="flex items-center gap-2 rounded-full border border-border/60 bg-background/85 px-3 py-1.5 text-xs font-semibold text-foreground shadow-md backdrop-blur"
            role="status"
            aria-live="polite"
          >
            <MapPin className="h-3.5 w-3.5 text-primary" />
            <span className="tabular-nums">{plottedSummary}</span>
            {isResolving && (
              <Loader2
                className="h-3 w-3 animate-spin text-muted-foreground motion-reduce:animate-none"
                aria-label="Resolving addresses"
              />
            )}
            {inViewCount !== null && markers.length > 0 && (
              <span className="font-normal text-muted-foreground">
                · <span className="tabular-nums">{inViewCount}</span> in view
              </span>
            )}
          </div>

          {unmappedListings.length > 0 && !isResolving && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-full border border-warning/40 bg-background/85 px-3 py-1.5 text-xs font-semibold text-foreground shadow-md backdrop-blur transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                  <span className="tabular-nums">{unmappedListings.length}</span> unmapped
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-0">
                <div className="border-b border-border/60 px-3 py-2">
                  <p className="text-xs font-semibold text-foreground">
                    Listings without coordinates
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Addresses resolve server-side. Add a street address, suburb and state so these
                    records can be located.
                  </p>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <ul className="divide-y divide-border/50">
                    {unmappedListings.slice(0, 50).map((listing) => (
                      <li key={listing.id}>
                        <button
                          type="button"
                          onClick={() => onSelectListing(listing)}
                          className="w-full px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
                        >
                          <span className="block truncate text-xs font-medium text-foreground">
                            {listing.address || listing.title || 'Untitled listing'}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {[listing.suburb, listing.state].filter(Boolean).join(' ') ||
                              'No locality on record'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                {unmappedListings.length > 50 && (
                  <p className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
                    +{unmappedListings.length - 50} more
                  </p>
                )}
              </PopoverContent>
            </Popover>
          )}
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
          <Segmented
            value={mode}
            options={modeOptions}
            onChange={setMode}
            label="Map display mode"
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Basemap: ${BASEMAP_LABELS[basemapPref]}`}
                className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/85 px-3 py-2 text-xs font-medium text-foreground shadow-md backdrop-blur transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <Layers className="h-3.5 w-3.5 text-primary" />
                <span className="hidden sm:inline">{BASEMAP_LABELS[basemapPref]}</span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs">Basemap</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={basemapPref}
                onValueChange={(next) => {
                  if (isBasemapId(next)) setBasemapPref(next);
                }}
              >
                {(['auto', 'light', 'dark', 'satellite'] as BasemapId[]).map((id) => (
                  <DropdownMenuRadioItem key={id} value={id} className="text-xs">
                    {BASEMAP_LABELS[id]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs"
                onSelect={(event) => {
                  event.preventDefault();
                  userMovedRef.current = false;
                  fitToMarkers(!reducedMotion);
                }}
              >
                <Crosshair className="mr-2 h-3.5 w-3.5" />
                Fit to results
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Heat legend ------------------------------------------------------ */}
      {showHeat && heatModel.points.length > 0 && (
        <div className="pointer-events-auto absolute left-3 top-16 z-[500] w-[min(19rem,calc(100%-1.5rem))] rounded-xl border border-border/60 bg-background/90 shadow-md backdrop-blur">
          <button
            type="button"
            onClick={() => setLegendOpen((open) => !open)}
            aria-expanded={legendOpen}
            className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
          >
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Flame className="h-3.5 w-3.5 text-primary" />
              {heatLegend.title}
            </span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground transition-transform motion-reduce:transition-none',
                legendOpen && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </button>

          {legendOpen && (
            <div className="space-y-2.5 px-3 pb-3">
              <div>
                <div className="listings-heat-ramp" aria-hidden="true" />
                <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span className="truncate">{heatLegend.lowLabel}</span>
                  {heatLegend.midLabel ? (
                    <span className="truncate font-medium">{heatLegend.midLabel}</span>
                  ) : null}
                  <span className="truncate">{heatLegend.highLabel}</span>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{heatLegend.hint}</p>
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Weight by
                </p>
                <Segmented
                  value={heatMetric}
                  options={metricOptions}
                  onChange={setHeatMetric}
                  label="Heat weighting metric"
                  size="sm"
                />
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Focus
                </p>
                <Segmented
                  value={heatFocus}
                  options={focusOptions}
                  onChange={setHeatFocus}
                  label="Heat focus"
                  size="sm"
                />
              </div>

              {showPins && tiers && (
                <div className="space-y-1.5 border-t border-border/50 pt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Pin price band
                  </p>
                  <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {PIN_TIER_LEGEND.map(({ tier, label }) => (
                      <li
                        key={tier}
                        className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                      >
                        <span
                          className={`listings-tier-swatch listings-tier-swatch--${tier}`}
                          aria-hidden="true"
                        />
                        {label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Right-hand control stack ---------------------------------------- */}
      <div className="pointer-events-auto absolute right-3 bottom-10 z-[500] flex flex-col overflow-hidden rounded-xl border border-border/60 shadow-md backdrop-blur">
        <MapIconButton
          label="Zoom in"
          onClick={() => map?.zoomIn()}
          disabled={!map || zoom >= MAX_ZOOM}
        >
          <Plus className="h-4 w-4" />
        </MapIconButton>
        <MapIconButton
          label="Zoom out"
          onClick={() => map?.zoomOut()}
          disabled={!map || zoom <= MIN_ZOOM}
        >
          <Minus className="h-4 w-4" />
        </MapIconButton>
        <MapIconButton
          label="Fit map to results"
          onClick={() => {
            userMovedRef.current = false;
            fitToMarkers(!reducedMotion);
          }}
          disabled={markers.length === 0}
        >
          <Crosshair className="h-4 w-4" />
        </MapIconButton>
        <MapIconButton
          label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen map'}
          onClick={toggleFullscreen}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </MapIconButton>
      </div>

      {/* Empty state ------------------------------------------------------ */}
      {listings.length > 0 && markers.length === 0 && !isResolving && (
        <div className="pointer-events-none absolute inset-x-4 bottom-16 z-[500] rounded-xl border border-border/60 bg-background/90 p-4 text-sm shadow-md backdrop-blur">
          <p className="flex items-center gap-2 font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4 text-warning" />
            No listings could be placed on the map
          </p>
          <p className="mt-1 text-muted-foreground">
            Addresses are resolved securely on the server. Add a street address and suburb to the
            listing records so they can be located.
          </p>
        </div>
      )}

      {listings.length === 0 && (
        <div className="pointer-events-none absolute inset-x-4 bottom-16 z-[500] rounded-xl border border-border/60 bg-background/90 p-4 text-sm shadow-md backdrop-blur">
          <p className="flex items-center gap-2 font-semibold text-foreground">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            Nothing to map
          </p>
          <p className="mt-1 text-muted-foreground">
            No listings match the active filters. Clear a filter to bring stock back onto the map.
          </p>
        </div>
      )}
    </div>
  );
}

export default ListingsMapView;
