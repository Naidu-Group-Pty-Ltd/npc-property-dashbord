import { Bath, Bed, Calendar, Car, Mail, MapPin, Maximize2, MoreVertical, Phone } from 'lucide-react';
import { Badge, badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { PropertyListing } from '@/lib/airtable';
import type { StoredListingImage } from '@/lib/listingImages';
import { ListingHero } from '@/components/listings/ListingHero';
import { displayPrice, formatArea, formatLocality, qualityCaveat } from '@/lib/listingDisplay';
import { listingContact } from '@/lib/listingContact';

const BADGE = 'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold leading-none tracking-[0.02em] shadow-sm';
const SPEC_CHIP = 'inline-flex items-center gap-1 rounded-full border border-border/50 bg-background/70 px-2 py-1 text-xs font-semibold tabular-nums';

export interface ListingGalleryCardProps {
  listing: PropertyListing;
  images: StoredListingImage[] | undefined;
  imagesResolving: boolean;
  point?: { lat: number; lng: number } | null;
  isSelected: boolean;
  onSelect: (checked: boolean) => void;
  onOpenDetails: () => void;
  onOpenSource?: () => void;
  onEmailAgent?: () => void;
  onFindPhotos?: () => void;
  isFindingPhotos?: boolean;
  formatDate: (value: Date | string) => string;
}

/**
 * A listing as a photo-first card.
 *
 * The list and table views lead with text because they are built for scanning a
 * thousand rows. This one is built for browsing: the photograph is the subject
 * and everything else is annotation, which is how anyone actually shops for
 * property.
 *
 * It states what it does not know. A card that renders a grey box where a photo
 * should be, and nothing where a price should be, reads as broken; one that says
 * "No photo on record" and "Price on request" reads as honest. Given roughly
 * half these records genuinely have no price and photographs are still being
 * harvested, that distinction carries most of the page's credibility.
 */
export function ListingGalleryCard({
  listing,
  images,
  imagesResolving,
  point,
  isSelected,
  onSelect,
  onOpenDetails,
  onOpenSource,
  onEmailAgent,
  onFindPhotos,
  isFindingPhotos = false,
  formatDate,
}: ListingGalleryCardProps) {
  const price = displayPrice(listing);
  const locality = formatLocality(listing);
  const caveat = qualityCaveat(listing);
  const land = formatArea(listing.landSizeSqm);
  const photoCount = images?.length ?? 0;
  const contact = listingContact(listing);

  return (
    <article
      className={cn(
        'group/card relative flex flex-col overflow-hidden rounded-2xl border bg-card/90 shadow-[0_10px_30px_rgba(15,23,42,0.06)] transition-all duration-200',
        'hover:-translate-y-0.5 hover:shadow-[0_16px_40px_rgba(15,23,42,0.10)] focus-within:ring-2 focus-within:ring-primary/35',
        'dark:bg-background/80 dark:shadow-black/30',
        isSelected ? 'border-primary ring-2 ring-primary/30' : 'border-border/70 dark:border-white/10',
      )}
    >
      <div className="relative">
        <ListingHero
          images={images}
          isResolving={imagesResolving}
          label={listing.address ?? listing.suburb ?? undefined}
          point={point}
          aspect="aspect-[4/3]"
          rounded={false}
          onExpand={onOpenDetails}
          onFindPhotos={onFindPhotos}
          isFindingPhotos={isFindingPhotos}
        />

        <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1">
          {listing.listingStatus && (
            <span className={cn(BADGE, 'bg-foreground/75 text-background')}>{listing.listingStatus}</span>
          )}
          {listing.intent && listing.intent !== 'Sale' && (
            <span className={cn(BADGE, 'bg-brand-500/90 text-foreground dark:text-white')}>
              {listing.intent}
            </span>
          )}
          {price.isRent && <span className={cn(BADGE, 'bg-info/85 text-background')}>Rental</span>}
        </div>

        {photoCount > 1 && (
          <span className={cn(BADGE, 'pointer-events-none absolute right-2 top-2 bg-foreground/70 text-background')}>
            {photoCount} photos
          </span>
        )}

        <div className="absolute left-2 bottom-2 opacity-0 transition-opacity group-hover/card:opacity-100 focus-within:opacity-100">
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onSelect(checked === true)}
            className="h-5 w-5 border-border/80 bg-background/90 shadow-sm"
            aria-label={`Select ${listing.address ?? 'listing'}`}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <button
              type="button"
              onClick={onOpenDetails}
              className="block w-full truncate text-left text-[15px] font-semibold leading-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {listing.address ?? listing.fullAddress ?? 'Address not extracted'}
            </button>
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
              {locality ?? 'Location unknown'}
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-label="Listing actions"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onOpenDetails}>Open details</DropdownMenuItem>
              {contact.email && onEmailAgent && (
                <DropdownMenuItem onClick={onEmailAgent}>Email the agent</DropdownMenuItem>
              )}
              {contact.phone && (
                <DropdownMenuItem asChild>
                  <a href={`tel:${contact.phone.replace(/\s/g, '')}`}>Call {contact.phone}</a>
                </DropdownMenuItem>
              )}
              {listing.url && onOpenSource && (
                <DropdownMenuItem onClick={onOpenSource}>Open source listing</DropdownMenuItem>
              )}
              {/*
                Also in the menu, not only in the empty frame: a geocoded listing
                with no photographs shows the Street View slide instead of the
                empty state, so the frame's own button never renders — and that
                is exactly the listing most worth fetching.
              */}
              {photoCount === 0 && onFindPhotos && (
                <DropdownMenuItem onClick={onFindPhotos} disabled={isFindingPhotos}>
                  {isFindingPhotos ? 'Looking for photos…' : 'Find photos'}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex flex-wrap items-baseline gap-2">
          <span
            className={cn(
              'text-lg font-bold leading-none',
              price.known ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            {price.text}
          </span>
          {listing.propertyType && (
            <span className={cn(badgeVariants({ variant: 'outline' }), BADGE, 'shrink-0')}>
              {listing.propertyType}
            </span>
          )}
        </div>

        {(listing.beds || listing.baths || listing.carSpaces || land) && (
          <div className="flex flex-wrap gap-1.5">
            {listing.beds ? (
              <span className={SPEC_CHIP}>
                <Bed className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                {listing.beds}
                <span className="sr-only"> bedrooms</span>
              </span>
            ) : null}
            {listing.baths ? (
              <span className={SPEC_CHIP}>
                <Bath className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                {listing.baths}
                <span className="sr-only"> bathrooms</span>
              </span>
            ) : null}
            {listing.carSpaces ? (
              <span className={SPEC_CHIP}>
                <Car className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                {listing.carSpaces}
                <span className="sr-only"> car spaces</span>
              </span>
            ) : null}
            {land ? (
              <span className={SPEC_CHIP}>
                <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                {land}
              </span>
            ) : null}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-2.5 text-xs">
          <span className="min-w-0 truncate text-muted-foreground">
            {[contact.name, listing.agencyName].filter(Boolean).join(' · ') || 'Agency not extracted'}
          </span>
          {listing.inspectionStart ? (
            <span className="flex shrink-0 items-center gap-1 font-medium text-primary">
              <Calendar className="h-3 w-3" aria-hidden="true" />
              {formatDate(listing.inspectionStart)}
            </span>
          ) : listing.listedAtKnown === false ? (
            // Better than showing today's date for a record that carries none.
            <span className="shrink-0 text-muted-foreground/70">Date unknown</span>
          ) : null}
        </div>

        {/*
          A first-class action rather than a menu item. The whole point of a
          photo-first grid is that someone browses it and wants to ask about one,
          and burying that behind a kebab adds a click to the only thing they
          came to do. It is only rendered when there is somewhere to send it —
          two thirds of these records carry no address at all, and a disabled
          button on most of the page is just noise.
        */}
        {(contact.email || contact.phone) && (
          <div className="flex gap-1.5">
            {contact.email && onEmailAgent && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 flex-1 rounded-full text-xs font-semibold"
                onClick={onEmailAgent}
              >
                <Mail className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Email agent
              </Button>
            )}
            {contact.phone && (
              <Button
                asChild
                size="sm"
                variant="outline"
                className={cn('h-8 rounded-full text-xs font-semibold', !contact.email && 'flex-1')}
              >
                <a href={`tel:${contact.phone.replace(/\s/g, '')}`} aria-label={`Call ${contact.phone}`}>
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  {!contact.email && <span className="ml-1.5">{contact.phone}</span>}
                </a>
              </Button>
            )}
          </div>
        )}

        {caveat && (
          <Badge
            variant="outline"
            title={caveat}
            className={cn(BADGE, 'self-start border-warning/40 text-warning')}
          >
            Check location
          </Badge>
        )}
      </div>
    </article>
  );
}

export default ListingGalleryCard;
