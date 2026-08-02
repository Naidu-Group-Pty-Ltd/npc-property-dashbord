import { airtableService, PropertyListing } from '@/lib/airtable';
import {
  clearListingCache,
  isCacheUsable,
  mergeIncremental,
  mergeRawFields,
  pageIsFullyKnown,
  planRefresh,
  readListingCache,
  readListingRawFields,
  writeListingCache,
  type CachedListingSet,
  type RefreshMode,
} from '@/lib/listingCache';

export interface PropertyDataOptions {
  maxRecords?: number;
  includeDebugInfo?: boolean;
  bypassCache?: boolean;
  tableName?: string;
}


export interface PropertyDataResult {
  listings: PropertyListing[];
  debugInfo: {
    totalFetched: number;
    duplicatesRemoved: number;
    fetchTime: number;
    sources: Record<string, number>;
    dataQuality: {
      withPrice: number;
      withLocation: number;
      withBedrooms: number;
      withPropertyType: number;
    };
    fromCache: boolean;
  };
}

/** Notified when a background revalidation replaces the set the caller was given. */
export type RevalidateListener = (result: PropertyDataResult) => void;

interface MemoryEntry {
  listings: PropertyListing[];
  savedAt: number;
  fullReadAt: number;
}

/**
 * Unified property data service: one fetch path, one cache, shared by Overview,
 * Listings and the report generators.
 *
 * A cold read is `ceil(N/100)` **sequential** trips through `airtable-proxy` —
 * the offset for page N+1 only exists once page N has come back, so there is no
 * parallelism to find. The wins therefore have to come from not doing the walk:
 *
 *  1. **Coalescing.** Overview and Listings mount within milliseconds of each
 *     other and both asked for everything, so the whole walk ran twice, in
 *     parallel, against the same rate limit. Concurrent callers now share one
 *     promise per table.
 *  2. **Persistence.** The cache used to be a field on this singleton, so it
 *     died with the page. A reload, a new tab, or a restored session each paid
 *     full price. It now lives in IndexedDB and is handed back on the first call
 *     while the network work happens behind the render.
 *  3. **Incremental revalidation.** Airtable is read newest-first, so a warm
 *     session only needs to walk until it recognises a page — one request rather
 *     than twenty. `planRefresh` decides when that is safe and when a full
 *     reconcile is due (see `listingCache.ts` for why both exist).
 */
class PropertyDataService {
  private memory = new Map<string, MemoryEntry>();
  /** One in-flight network walk per table, shared by every concurrent caller. */
  private inFlight = new Map<string, Promise<PropertyListing[]>>();
  /** Set once per table so hydration from disk is attempted exactly once. */
  private hydrated = new Map<string, Promise<MemoryEntry | null>>();
  private listeners = new Map<string, Set<RevalidateListener>>();

  /**
   * Subscribe to background revalidations for a table.
   *
   * Stale-while-revalidate means the first caller is answered from disk before
   * the network has been touched; this is how it finds out the fresh set landed.
   */
  subscribe(tableName: string | undefined, listener: RevalidateListener): () => void {
    const key = tableName || '__default__';
    const set = this.listeners.get(key) ?? new Set();
    set.add(listener);
    this.listeners.set(key, set);
    return () => set.delete(listener);
  }

  private emit(tableKey: string, listings: PropertyListing[]): void {
    const set = this.listeners.get(tableKey);
    if (!set?.size) return;
    const result = this.buildResult(listings, Date.now(), true, false);
    for (const listener of set) {
      try {
        listener(result);
      } catch (error) {
        console.warn('[propertyDataService] revalidate listener threw', error);
      }
    }
  }

  /** Whatever is already in memory for this table, with no I/O of any kind. */
  peek(tableName?: string): PropertyListing[] | null {
    return this.memory.get(tableName || '__default__')?.listings ?? null;
  }

  private async hydrate(tableKey: string): Promise<MemoryEntry | null> {
    const existing = this.hydrated.get(tableKey);
    if (existing) return existing;

    const promise = (async () => {
      const entry: CachedListingSet | null = await readListingCache(tableKey);
      if (!isCacheUsable(entry, Date.now())) return null;
      const loaded: MemoryEntry = {
        listings: entry!.listings,
        savedAt: entry!.savedAt,
        fullReadAt: entry!.fullReadAt,
      };
      // Only adopt the disk copy if nothing fresher arrived while we were reading.
      if (!this.memory.has(tableKey)) this.memory.set(tableKey, loaded);

      // The raw Airtable mirror is stored apart from the listings because it is
      // two thirds of the bytes and feeds one on-demand panel. Fold it back in
      // once the page already has something to draw.
      void readListingRawFields(tableKey).then((rawById) => {
        if (!rawById) return;
        const current = this.memory.get(tableKey);
        if (!current) return;
        const merged = mergeRawFields(current.listings, rawById);
        if (merged !== current.listings) this.memory.set(tableKey, { ...current, listings: merged });
      });

      return loaded;
    })();

    this.hydrated.set(tableKey, promise);
    return promise;
  }

  /**
   * Walks Airtable pages newest-first.
   *
   * `stopWhenKnown` turns the walk into an incremental one: it ends at the first
   * page holding nothing new, which for an append-heavy table is page one.
   */
  private async walk(
    tableName: string | undefined,
    opts: { maxRecords?: number; stopWhenKnown?: ReadonlySet<string> } = {},
  ): Promise<PropertyListing[]> {
    const { maxRecords, stopWhenKnown } = opts;
    const collected: PropertyListing[] = [];
    let offset: string | undefined;
    let pageCount = 0;
    const maxPages = maxRecords ? Math.ceil(maxRecords / 100) : Infinity;

    do {
      const response = await airtableService.getRecords({
        pageSize: 100,
        offset,
        sortField: 'Created',
        sortDirection: 'desc',
        tableName,
      });

      const page = this.processAndDeduplicateListings(response.records);
      collected.push(...page);
      offset = response.offset;
      pageCount += 1;

      if (stopWhenKnown && pageIsFullyKnown(page, stopWhenKnown)) break;
      if (maxRecords && collected.length >= maxRecords) return collected.slice(0, maxRecords);
      if (pageCount >= maxPages) break;
    } while (offset);

    return collected;
  }

  /** Runs a refresh, sharing one in-flight promise across concurrent callers. */
  private refresh(
    tableKey: string,
    tableName: string | undefined,
    mode: Exclude<RefreshMode, 'none'>,
  ): Promise<PropertyListing[]> {
    const running = this.inFlight.get(tableKey);
    if (running) return running;

    const promise = (async () => {
      const cached = this.memory.get(tableKey);
      const now = Date.now();

      if (mode === 'incremental' && cached?.listings.length) {
        const knownIds = new Set(cached.listings.map((l) => l.id));
        const fetched = await this.walk(tableName, { stopWhenKnown: knownIds });
        const merged = mergeIncremental(cached.listings, fetched);
        const entry: MemoryEntry = { listings: merged, savedAt: now, fullReadAt: cached.fullReadAt };
        this.memory.set(tableKey, entry);
        void writeListingCache(tableKey, merged, { savedAt: now, fullReadAt: cached.fullReadAt });
        return merged;
      }

      const listings = await this.walk(tableName);
      this.memory.set(tableKey, { listings, savedAt: now, fullReadAt: now });
      void writeListingCache(tableKey, listings, { savedAt: now, fullReadAt: now });
      return listings;
    })().finally(() => {
      this.inFlight.delete(tableKey);
    });

    this.inFlight.set(tableKey, promise);
    return promise;
  }

  /**
   * Fetch all property listings.
   *
   * Returns as soon as there is something usable to draw. When that came from
   * cache and a refresh is warranted, the refresh runs behind the render and
   * `subscribe` callers are told when it lands.
   */
  async fetchAllListings(options: PropertyDataOptions = {}): Promise<PropertyDataResult> {
    const startTime = Date.now();
    const { maxRecords, includeDebugInfo = false, bypassCache = false, tableName } = options;
    const tableKey = tableName || '__default__';

    // A bounded read is a different question from "the whole table" and must not
    // be answered from, or written to, the full-table cache.
    if (maxRecords) {
      const listings = await this.walk(tableName, { maxRecords });
      return this.buildResult(listings, startTime, includeDebugInfo, false);
    }

    if (bypassCache) {
      const listings = await this.refresh(tableKey, tableName, 'full');
      return this.buildResult(listings, startTime, includeDebugInfo, false);
    }

    let entry = this.memory.get(tableKey) ?? null;
    if (!entry) entry = await this.hydrate(tableKey);
    // Hydration may have merged rawFields in behind us; take the current copy.
    entry = this.memory.get(tableKey) ?? entry;

    const mode = planRefresh({
      savedAt: entry?.savedAt ?? null,
      fullReadAt: entry?.fullReadAt ?? null,
      now: Date.now(),
    });

    if (entry && mode === 'none') {
      return this.buildResult(entry.listings, startTime, includeDebugInfo, true);
    }

    if (entry && mode !== 'none') {
      // Stale-while-revalidate: answer from cache now, catch up behind the render.
      void this.refresh(tableKey, tableName, mode)
        .then((listings) => this.emit(tableKey, listings))
        .catch((error) => console.warn('[propertyDataService] background refresh failed', error));
      return this.buildResult(entry.listings, startTime, includeDebugInfo, true);
    }

    if (entry) return this.buildResult(entry.listings, startTime, includeDebugInfo, true);

    const listings = await this.refresh(tableKey, tableName, 'full');
    return this.buildResult(listings, startTime, includeDebugInfo, false);
  }

  /** Clear both halves of the cache so the next read goes to the network. */
  clearCache(tableName?: string): void {
    if (tableName) {
      const key = tableName || '__default__';
      this.memory.delete(key);
      this.hydrated.delete(key);
    } else {
      this.memory.clear();
      this.hydrated.clear();
    }
    void clearListingCache(tableName);
  }

  /**
   * Minimal processing - server already handles deduplication
   */
  private processAndDeduplicateListings(rawListings: PropertyListing[]): PropertyListing[] {
    const standardized = rawListings.map(listing => this.standardizeListing(listing));
    return standardized;
  }

  /**
   * Standardize listing data for consistent processing
   */
  private standardizeListing(listing: PropertyListing): PropertyListing {
    // Cast to any to check alternate field names from raw API responses
    const raw = listing as any;

    // Resolve images from multiple possible field names (case-insensitive edge function responses)
    const resolvedImages = listing.images 
      || raw.Images || raw.Property_Images || raw.property_images 
      || raw.Attachments || raw.attachments || raw.Photos || raw.photos || [];

    // Resolve floorplans from multiple possible field names
    const resolvedFloorplans = listing.floorplans 
      || raw.Floorplans || raw.Floor_Plans || raw.floor_plans 
      || raw.FloorPlan || raw.floorplan || [];

    return {
      ...listing,
      propertyType: this.standardizePropertyType(listing.propertyType),
      suburb: this.standardizeSuburb(listing.suburb || listing.location),
      price: this.standardizePrice(listing.price),
      beds: this.standardizeBedBath(listing.beds || listing.bedrooms),
      baths: this.standardizeBedBath(listing.baths || listing.bathrooms),
      receivedAt: listing.receivedAt || listing.createdAt || listing.createdTime,
      // Normalize images/floorplans - Airtable returns attachment objects or URL strings
      images: this.normalizeAttachments(resolvedImages),
      floorplans: this.normalizeAttachments(resolvedFloorplans),
      dataQuality: this.calculateDataQualityScore(listing),
      isValidPrice: this.isValidPrice(listing.price),
      isValidLocation: this.isValidLocation(listing.address || listing.location),
      completenessScore: this.calculateCompletenessScore(listing)
    };
  }

  /**
   * Normalize Airtable attachment fields - handles both attachment objects and URL strings
   */
  private normalizeAttachments(attachments: any): string[] {
    if (!attachments) return [];
    if (!Array.isArray(attachments)) return [];
    if (attachments.length === 0) return [];
    
    return attachments.map((att: any) => {
      if (typeof att === 'string') return att;
      if (att && typeof att === 'object') {
        // Airtable attachment object: { id, url, filename, ... }
        return att.url || att.thumbnails?.large?.url || att.thumbnails?.small?.url || '';
      }
      return '';
    }).filter((url: string) => url.length > 0);
  }

  /**
   * Calculate data quality score for a listing
   */
  private calculateDataQualityScore(listing: PropertyListing): number {
    let score = 0;
    const weights = {
      price: 25, address: 20, bedrooms: 15, bathrooms: 10,
      propertyType: 10, suburb: 10, agent: 5, description: 5
    };

    if (this.isValidPrice(listing.price)) score += weights.price;
    if (this.isValidLocation(listing.address || listing.location)) score += weights.address;
    if ((listing.beds || listing.bedrooms) && (listing.beds || listing.bedrooms)! > 0) score += weights.bedrooms;
    if ((listing.baths || listing.bathrooms) && (listing.baths || listing.bathrooms)! > 0) score += weights.bathrooms;
    if (listing.propertyType && listing.propertyType !== 'Unknown') score += weights.propertyType;
    if (listing.suburb && listing.suburb !== 'Unknown') score += weights.suburb;
    if (listing.agent || listing.agentName) score += weights.agent;
    if (listing.description && listing.description.length > 20) score += weights.description;

    return score;
  }

  private standardizePropertyType(type?: string): string {
    if (!type) return 'Unknown';
    const normalized = type.toLowerCase().trim();
    if (normalized.includes('house') || normalized.includes('home')) return 'House';
    if (normalized.includes('apartment') || normalized.includes('unit')) return 'Apartment';
    if (normalized.includes('townhouse') || normalized.includes('town house')) return 'Townhouse';
    if (normalized.includes('villa')) return 'Villa';
    if (normalized.includes('duplex')) return 'Duplex';
    if (normalized.includes('land') || normalized.includes('lot')) return 'Land';
    return type;
  }

  private standardizeSuburb(suburb?: string): string {
    if (!suburb) return 'Unknown';
    return suburb.trim().replace(/\s+/g, ' ')
      .split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
  }

  private standardizePrice(price?: number | null): number | null {
    if (!price || price <= 0 || price > 50000000) return null;
    return Math.round(price);
  }

  private standardizeBedBath(count?: number | null): number | null {
    if (!count || count < 0 || count > 20) return null;
    return Math.round(count);
  }

  private isValidPrice(price?: number | null): boolean {
    return !!(price && price > 0 && price <= 50000000);
  }

  private isValidLocation(location?: string): boolean {
    return !!(location && location.trim().length > 3);
  }

  private calculateCompletenessScore(listing: PropertyListing): number {
    const fields = ['price', 'address', 'beds', 'baths', 'propertyType', 'suburb', 'agent', 'description', 'images', 'source'];
    let filledFields = 0;
    fields.forEach(field => {
      const value = (listing as any)[field];
      if (value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) {
        filledFields++;
      }
    });
    return (filledFields / fields.length) * 100;
  }

  private buildResult(listings: PropertyListing[], startTime: number, includeDebugInfo: boolean, fromCache: boolean): PropertyDataResult {
    const debugInfo = includeDebugInfo ? {
      totalFetched: listings.length,
      duplicatesRemoved: 0,
      fetchTime: Date.now() - startTime,
      sources: this.calculateSourceDistribution(listings),
      dataQuality: {
        withPrice: listings.filter(l => this.isValidPrice(l.price)).length,
        withLocation: listings.filter(l => this.isValidLocation(l.address || l.location)).length,
        withBedrooms: listings.filter(l => (l.beds || l.bedrooms) && (l.beds || l.bedrooms)! > 0).length,
        withPropertyType: listings.filter(l => l.propertyType && l.propertyType !== 'Unknown').length,
      },
      fromCache,
    } : {
      totalFetched: 0, duplicatesRemoved: 0, fetchTime: 0, sources: {},
      dataQuality: { withPrice: 0, withLocation: 0, withBedrooms: 0, withPropertyType: 0 },
      fromCache,
    };

    return { listings, debugInfo };
  }

  private calculateSourceDistribution(listings: PropertyListing[]): Record<string, number> {
    return listings.reduce((acc, listing) => {
      const source = listing.source || 'Unknown';
      acc[source] = (acc[source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }
}

export const propertyDataService = new PropertyDataService();
