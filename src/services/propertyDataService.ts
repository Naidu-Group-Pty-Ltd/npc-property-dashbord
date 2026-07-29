import { airtableService, PropertyListing } from '@/lib/airtable';

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

/**
 * Unified property data service that ensures consistent data fetching,
 * processing, and deduplication across dashboard and reports
 */
class PropertyDataService {
  private cache: {
    data: PropertyListing[] | null;
    timestamp: number;
    ttl: number;
    tableKey: string | null;
  } = {
    data: null,
    timestamp: 0,
    ttl: 5 * 60 * 1000, // 5 minutes
    tableKey: null,
  };

  /**
   * Fetch all property listings with consistent processing and caching
   */
  async fetchAllListings(options: PropertyDataOptions = {}): Promise<PropertyDataResult> {
    const startTime = Date.now();
    const { maxRecords, includeDebugInfo = false, bypassCache = false, tableName } = options;
    const tableKey = tableName || '__default__';

    const now = Date.now();

    // Use cache if valid, same table, and not bypassed
    if (
      !bypassCache &&
      this.cache.data &&
      this.cache.tableKey === tableKey &&
      (now - this.cache.timestamp) < this.cache.ttl
    ) {
      console.log('Using cached property data:', this.cache.data.length, 'records');
      let listings = this.cache.data;
      if (maxRecords) {
        listings = listings.slice(0, maxRecords);
      }
      return this.buildResult(listings, startTime, includeDebugInfo, true);
    }

    try {
      let allRecords: PropertyListing[] = [];
      let offset: string | undefined;
      let pageCount = 0;
      const maxPages = maxRecords ? Math.ceil(maxRecords / 100) : Infinity;

      console.log('Fetching fresh property data from Airtable...', { tableName: tableName || '(default)' });

      do {
        const response = await airtableService.getRecords({
          pageSize: 100,
          offset,
          sortField: 'Created',
          sortDirection: 'desc',
          tableName,
        });



        allRecords = [...allRecords, ...response.records];
        offset = response.offset;
        pageCount++;

        console.log(`Fetched page ${pageCount}, total records: ${allRecords.length}`);

        if (maxRecords && allRecords.length >= maxRecords) {
          allRecords = allRecords.slice(0, maxRecords);
          break;
        }

        if (pageCount >= maxPages) {
          break;
        }
      } while (offset);

      console.log(`Raw data fetched: ${allRecords.length} records in ${Date.now() - startTime}ms`);

      const processedListings = this.processAndDeduplicateListings(allRecords);

      // Only complete table reads are safe to reuse for later unlimited requests.
      if (!maxRecords) {
        this.cache = {
          data: processedListings,
          timestamp: now,
          ttl: this.cache.ttl,
          tableKey,
        };
      }


      console.log(`Processed data: ${processedListings.length} unique records`);

      return this.buildResult(processedListings, startTime, includeDebugInfo, false);

    } catch (error) {
      console.error('Error fetching property data:', error);
      throw error;
    }
  }

  /**
   * Clear the cache to force fresh data fetch
   */
  clearCache(): void {
    this.cache = {
      data: null,
      timestamp: 0,
      ttl: this.cache.ttl,
      tableKey: null,
    };

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
