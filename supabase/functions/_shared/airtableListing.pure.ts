/**
 * The Airtable record -> listing projection.
 *
 * Extracted from `airtable-proxy`, where it was defined inline inside the
 * request handler, because a second reader now exists: the server-side listings
 * cache stores Airtable's `fields` verbatim and projects at read time. Two
 * copies of this mapping would drift the moment somebody renamed a column, and
 * the symptom would be a field that is populated on one code path and blank on
 * the other.
 *
 * Free of Deno, Supabase, React and the DOM so both runtimes can import it.
 */

export interface AirtableSourceRecord {
  id: string;
  createdTime?: string | null;
  fields?: Record<string, unknown> | null;
}

/** The projected listing. Deliberately loose — callers narrow it to `PropertyListing`. */
export type ProjectedListing = Record<string, unknown> & { id: string };

function cleanPrice(price: unknown): number | null {
  if (!price) return null;
  const numPrice =
    typeof price === 'string' ? parseFloat(price.replace(/[^0-9.]/g, '')) : Number(price);
  // Filter unrealistic prices rather than letting a typo skew every average.
  return numPrice > 0 && numPrice < 50000000 ? numPrice : null;
}

function normalizeConfidence(confidence: unknown): number | null {
  if (!confidence) return null;
  const numConf = typeof confidence === 'string' ? parseFloat(confidence) : Number(confidence);
  if (numConf >= 0 && numConf <= 1) return numConf; // Already normalized
  if (numConf >= 0 && numConf <= 100) return numConf / 100; // Convert percentage
  return null;
}

function standardizePropertyType(type: unknown): string {
  if (!type || typeof type !== 'string') return 'Unknown';
  const normalized = type.toLowerCase().trim();
  if (normalized.includes('apartment') || normalized.includes('unit')) return 'Apartment';
  if (normalized.includes('house') || normalized.includes('home')) return 'House';
  if (normalized.includes('townhouse') || normalized.includes('town house')) return 'Townhouse';
  if (normalized.includes('villa')) return 'Villa';
  if (normalized.includes('duplex')) return 'Duplex';
  if (normalized.includes('land')) return 'Land';
  return type;
}

function standardizeSuburb(suburb: unknown): string {
  if (!suburb || typeof suburb !== 'string') return 'Unknown Suburb';
  return suburb.split(',')[0].trim(); // Remove state/postcode if present
}

function countOrNull(value: unknown): number | null {
  const parsed = parseInt(String(value ?? 0), 10);
  return Math.max(0, Number.isFinite(parsed) ? parsed : 0) || null;
}

/**
 * The record's display date, with a fallback chain ending at "now".
 *
 * The `now` fallback is a display convenience and nothing more: a record with no
 * date at all still has to sort somewhere. It must never be written to
 * `listings_cache.created_time` — that column drives a 30-day retention window
 * shared with Airtable, and a value that resets on every read would make an
 * undated record permanently fresh here while Airtable pruned it. See
 * `listingsCache.pure.ts#extractCreatedTime`, which deliberately returns null
 * instead.
 */
function displayDate(record: AirtableSourceRecord, now: () => number): string {
  const fields = record.fields ?? {};
  const candidates = [
    fields['Created'], // Primary field name in Airtable
    fields['Created At'],
    fields['Listed_Date'],
    fields['Date_Listed'],
    record.createdTime,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const date = new Date(candidate as string | number | Date);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date(now()).toISOString();
}

/**
 * Projects one Airtable record onto the listing shape the dashboard renders.
 *
 * `fields` is carried through untouched alongside the projection: the intake
 * table has 205 columns and only a fraction are mapped here, so the extended
 * detail panels read the original.
 */
export function projectAirtableRecord(
  record: AirtableSourceRecord,
  now: () => number = Date.now,
): ProjectedListing {
  const fields = (record.fields ?? {}) as Record<string, any>;
  const stamp = displayDate(record, now);
  const beds = countOrNull(fields.Beds || fields.Bedrooms || fields.Bedroom_Count);
  const baths = countOrNull(fields.Baths || fields.Bathrooms || fields.Bathroom_Count);

  return {
    id: record.id,
    fields,
    createdTime: stamp,

    // Core property information with enhanced mapping
    title: fields.Address || fields.Property_Title || fields.Title || 'Untitled Property',
    price: cleanPrice(fields.Price || fields.Asking_Price),
    location:
      `${fields.Address || ''}, ${standardizeSuburb(fields.Suburb)}`.replace(/^, |, $/, '') ||
      'Location not specified',
    address: fields.Address || 'Unknown Address',
    suburb: standardizeSuburb(fields.Suburb),

    // Property details with data validation
    beds,
    baths,
    bedrooms: beds,
    bathrooms: baths,
    carSpaces: countOrNull(fields['Car Spaces'] || fields.Car_Spaces),

    propertyType: standardizePropertyType(fields['Property Type'] || fields.Property_Type),
    listingDate: stamp,
    status: fields.Status || 'Available',

    // Quality and confidence metrics
    confidence: normalizeConfidence(
      fields['Confidence Score'] || fields.Confidence_Score || fields.Confidence,
    ),
    source: fields.Source || fields.Data_Source || 'Airtable',

    // Agent and agency information
    agent: fields['Agent Name'] || fields.Agent || fields.Listing_Agent || 'Unknown Agent',
    agentName: fields['Agent Name'] || fields.Agent || fields.Listing_Agent || 'Unknown Agent',
    agencyName: fields['Agency Name'] || fields.Agency || fields['Agent Agency'] || 'Unknown Agency',
    agentPhone: fields['Agent Phone'] || null,

    // Additional details
    createdAt: stamp,
    receivedAt: stamp,
    description: fields['Property Description'] || fields.Description || fields.Summary || '',
    images: fields.Images || fields.Property_Images || [],
    features: fields.Features || fields.Property_Features || [],

    // Location details
    landSize:
      fields['Square Feet'] || fields['Land Size'] || fields.Land_Size || fields.LandSize || null,
    lotNumber: fields['Lot Number'] || null,
    webLinks: fields['Web Link'] || null,
    state: fields['State'] || null,
    zipCode:
      fields['Zipcode'] || fields['Zip Code'] || fields['Post Code'] || fields['Postcode'] || null,

    // Additional metadata
    summary: fields.Summary || null,
    keyEntities: fields['Key Entities'] || null,
    rawExtract: fields['Raw Extract'] || null,
    category: fields.Category || null,
    inspectionStart: fields['Inspection Start'] ? new Date(fields['Inspection Start']) : null,
    inspectionEnd: fields['Inspection End'] ? new Date(fields['Inspection End']) : null,
    inspectionNotes: fields['Inspection Notes'] || null,
    floorplans: fields.Floorplans || [],
  };
}
