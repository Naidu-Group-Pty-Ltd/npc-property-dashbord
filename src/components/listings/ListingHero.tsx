import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Expand, ImageOff, Loader2, MapPin, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StoredListingImage } from '@/lib/listingImages';
import { StreetViewPanel } from '@/components/listings/StreetViewPanel';
import { ListingCover, type ListingCoverProps } from '@/components/listings/ListingCover';

/** Small action sitting over imagery — legible on a photo or a drawn cover. */
const PILL =
  'inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/90 px-2 py-1 text-[10px] font-semibold text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

export interface ListingHeroProps {
  images: StoredListingImage[] | undefined;
  isResolving?: boolean;
  /** Alt text and the Street View label. Use the address where you have one. */
  label?: string;
  /**
   * Coordinates, when the listing has been geocoded. Supplying them adds Street
   * View as a final slide rather than replacing the photographs with it.
   */
  point?: { lat: number; lng: number } | null;
  className?: string;
  /** Frame aspect. The grid uses 4:3; the popup a shorter letterbox. */
  aspect?: string;
  /** Called when the frame is clicked, e.g. to open a lightbox. */
  onExpand?: (index: number) => void;
  /** Thumbnail strip beneath the frame. Only worth it at large sizes. */
  showThumbnails?: boolean;
  /** Rounded corners. Off for a full-bleed hero. */
  rounded?: boolean;
  /**
   * Fetch this listing's photos from its source page now. Supplying it turns the
   * empty state from a statement into an action.
   */
  onFindPhotos?: () => void;
  /** A fetch is in flight for this listing. */
  isFindingPhotos?: boolean;
  /**
   * Enough of the record to draw a cover when there is no photograph. Without
   * it the empty frame falls back to a plain panel.
   */
  listing?: ListingCoverProps['listing'];
  /**
   * How the Street View slide is loaded.
   *
   * `'slide'` — always present as the last slide. Right where one listing is on
   * screen: the property page, the map popup.
   *
   * `'on-demand'` — the frame draws a cover, and Street View loads only when the
   * reader asks for it. Required anywhere many listings render at once. Each
   * panel costs the `street-view` function two Google calls against a global
   * 5,000/day quota and it caches nothing, so a 48-card grid auto-loading them
   * spends ~96 calls per page view and exhausts the day inside an afternoon.
   */
  streetViewMode?: 'slide' | 'on-demand';
}

/**
 * A listing's photographs, as a carousel.
 *
 * Shared by the gallery grid, the property page and the map popup so that a
 * listing looks the same wherever it appears, and so that the awkward parts —
 * what to show when there are no photos, what to do when a signed URL has
 * expired mid-session, how Street View relates to the real imagery — are decided
 * once.
 *
 * **Street View is a slide, not an alternative.** The map popup used to show
 * *either* one photo *or* Street View in a single 112px frame, with a toggle
 * that only appeared when a photo existed — so with the image pipeline broken it
 * silently showed Street View and gave no hint a photograph was ever expected.
 * Making it the last slide keeps it available without letting it stand in for
 * the property.
 *
 * Deliberately not embla, despite embla being available. This needs about thirty
 * lines of index state, and a carousel library brings pointer-drag handling that
 * fights Leaflet for the same gestures inside a map popup — the exact conflict
 * that makes popup controls unresponsive.
 */
export function ListingHero({
  images,
  isResolving = false,
  label,
  point,
  className,
  aspect = 'aspect-[4/3]',
  onExpand,
  showThumbnails = false,
  rounded = true,
  onFindPhotos,
  isFindingPhotos = false,
  listing,
  streetViewMode = 'slide',
}: ListingHeroProps) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  // Only meaningful in 'on-demand' mode: the reader has asked for the panorama,
  // so it may now cost a Google call.
  const [streetViewAsked, setStreetViewAsked] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const photos = useMemo(
    () => (images ?? []).filter((image) => image.url && !failed.has(image.url)),
    [images, failed],
  );
  const hasStreetView = Boolean(point) && (streetViewMode === 'slide' || streetViewAsked);
  const slideCount = photos.length + (hasStreetView ? 1 : 0);

  // A listing change hands us a different set under the same component. Without
  // this, slide 5 of the previous listing becomes slide 5 of a two-photo one.
  const signature = photos.map((p) => p.url).join('|');
  useEffect(() => setIndex(0), [signature]);
  // A recycled card showing a different property must not inherit the previous
  // reader's request and silently spend a call on the new one.
  useEffect(() => setStreetViewAsked(false), [listing?.address, listing?.suburb]);

  const go = useCallback(
    (delta: number) => {
      setIndex((current) => {
        if (slideCount === 0) return 0;
        return (current + delta + slideCount) % slideCount;
      });
    },
    [slideCount],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(1);
    }
  };

  const frame = cn(
    'group relative w-full overflow-hidden bg-muted',
    rounded && 'rounded-xl',
    aspect,
    className,
  );

  if (slideCount === 0) {
    if (isFindingPhotos) {
      return (
        <div
          className={cn(frame, 'flex items-center justify-center border border-border/60 bg-muted/60')}
          aria-busy="true"
        >
          <span className="flex flex-col items-center gap-1.5">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />
            <span className="text-[11px] font-medium text-muted-foreground">Looking for photos…</span>
          </span>
        </div>
      );
    }
    // Only a blank skeleton when there is genuinely nothing to draw. The first
    // version blanked the frame for the whole resolution pass — and a pass over
    // a thousand listings runs for minutes, so entire screenfuls of cards sat
    // as white rectangles while their covers waited behind a spinner nobody
    // could see. If the record can describe itself, draw the cover immediately
    // and let a photograph replace it whenever one arrives.
    if (isResolving && !listing) {
      return (
        <div
          className={cn(frame, 'animate-pulse border border-border/60 bg-muted/60 motion-reduce:animate-none')}
          aria-busy="true"
        >
          <span className="sr-only">Loading photos</span>
        </div>
      );
    }
    // A drawn cover rather than a grey rectangle. At four cards across, a page
    // of blank tiles reads as a broken product; a page of covers reads as a
    // catalogue whose photography has not landed yet — which is the truth.
    //
    // The caption still says so plainly, and where the caller can do something
    // about it the caption carries the remedy: the sweep works worst-first
    // through 1,441 records, so this listing may be hours from its turn.
    return (
      <div className={cn(frame, 'border border-border/60')}>
        {listing ? (
          <ListingCover listing={listing} />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <ImageOff className="h-5 w-5 text-muted-foreground/50" aria-hidden="true" />
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-background/85 to-transparent px-2.5 pb-2 pt-6">
          {isResolving ? (
            // The pass has not reached this listing yet, so "no photo on
            // record" would be a claim we cannot make. Say what is true.
            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground" aria-busy="true">
              <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Checking for photos…
            </span>
          ) : (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
            <ImageOff className="h-3 w-3" aria-hidden="true" />
            No photo on record
          </span>
          )}
          {!isResolving && (
          <span className="flex shrink-0 items-center gap-1.5">
            {/*
              Geocoded but unphotographed is the largest group on this page —
              811 of 1,441. There is a real picture of the street frontage one
              click away, and this is that click. It is a button rather than an
              automatic slide because loading it costs a metered Google call;
              see `streetViewMode`.
            */}
            {point && streetViewMode === 'on-demand' && (
              <button
                type="button"
                onClick={() => setStreetViewAsked(true)}
                className={PILL}
              >
                <MapPin className="h-3 w-3" aria-hidden="true" />
                Street View
              </button>
            )}
            {onFindPhotos && (
              <button type="button" onClick={onFindPhotos} className={PILL}>
                <Search className="h-3 w-3" aria-hidden="true" />
                Find photos
              </button>
            )}
          </span>
          )}
        </div>
      </div>
    );
  }

  const onStreetViewSlide = hasStreetView && index === photos.length;
  const current = photos[index];

  return (
    <div className="space-y-1.5">
      <div
        ref={containerRef}
        className={cn(frame, 'border border-border/60')}
        role="group"
        aria-roledescription="carousel"
        aria-label={label ? `${label} — photos` : 'Listing photos'}
        tabIndex={slideCount > 1 ? 0 : -1}
        onKeyDown={onKeyDown}
      >
        {onStreetViewSlide && point ? (
          <StreetViewPanel
            lat={point.lat}
            lng={point.lng}
            label={label}
            variant="inline"
            frameClassName="h-full w-full"
          />
        ) : current ? (
          <img
            src={current.url}
            alt={label ? `${label} — photo ${index + 1}` : `Listing photo ${index + 1}`}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            // A signed URL that expired mid-session drops out of the set rather
            // than leaving a broken frame behind.
            onError={() =>
              setFailed((prior) => {
                const next = new Set(prior);
                next.add(current.url);
                return next;
              })
            }
          />
        ) : null}

        {onExpand && !onStreetViewSlide && (
          <button
            type="button"
            onClick={() => onExpand(index)}
            className="absolute inset-0 cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
            aria-label={label ? `Enlarge ${label}` : 'Enlarge photo'}
          >
            <Expand className="absolute right-2 top-2 h-4 w-4 text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-90" aria-hidden="true" />
          </button>
        )}

        {slideCount > 1 && (
          <>
            <CarouselButton side="left" onClick={() => go(-1)} />
            <CarouselButton side="right" onClick={() => go(1)} />
            <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-foreground/70 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-background">
              {onStreetViewSlide ? 'Street View' : `${index + 1}/${photos.length}`}
            </span>
          </>
        )}

        {/* Bottom-right, deliberately: callers put their own badge top-right
            (the gallery card shows a photo count there) and two absolutely
            positioned pills in one corner overlap. */}
        {hasStreetView && slideCount > 1 && !onStreetViewSlide && (
          <button
            type="button"
            onClick={() => setIndex(photos.length)}
            className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-foreground/70 px-2 py-1 text-[10px] font-semibold text-background transition-opacity hover:bg-foreground/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <MapPin className="h-3 w-3" aria-hidden="true" />
            Street
          </button>
        )}
      </div>

      {showThumbnails && photos.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {photos.map((photo, i) => (
            <button
              key={photo.url}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Photo ${i + 1}`}
              aria-current={i === index}
              className={cn(
                'h-12 w-16 shrink-0 overflow-hidden rounded-md border transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                i === index ? 'border-primary opacity-100' : 'border-border/60 opacity-60 hover:opacity-90',
              )}
            >
              <img src={photo.url} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
          {hasStreetView && (
            <button
              type="button"
              onClick={() => setIndex(photos.length)}
              aria-label="Street View"
              aria-current={onStreetViewSlide}
              className={cn(
                'flex h-12 w-16 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                onStreetViewSlide
                  ? 'border-primary text-foreground'
                  : 'border-border/60 text-muted-foreground opacity-70 hover:opacity-100',
              )}
            >
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CarouselButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous photo' : 'Next photo'}
      className={cn(
        'absolute top-1/2 z-10 -translate-y-1/2 rounded-full bg-foreground/60 p-1 text-background opacity-0 transition-opacity',
        'hover:bg-foreground/80 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        'group-hover:opacity-100 group-focus-within:opacity-100',
        side === 'left' ? 'left-1.5' : 'right-1.5',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

export default ListingHero;
