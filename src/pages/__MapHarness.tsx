import ListingsMapView from '@/components/listings/ListingsMapView';
import type { PropertyListing } from '@/lib/airtable';

const rows: PropertyListing[] = [
  { id: 'a', title: 'A', price: 800000, location: 'Sydney', bedrooms: 3, bathrooms: 2, propertyType: 'House', listingDate: '2026-07-01', status: 'active', confidence: 1, source: 't', description: '', images: [], agent: '', features: [], address: '1 George St', suburb: 'Sydney', state: 'NSW', zipCode: '2000', latitude: -33.86, longitude: 151.2 },
  { id: 'b', title: 'B', price: 600000, location: 'Melbourne', bedrooms: 2, bathrooms: 1, propertyType: 'Unit', listingDate: '2026-07-02', status: 'active', confidence: 1, source: 't', description: '', images: [], agent: '', features: [], address: '2 Collins St', suburb: 'Melbourne', state: 'VIC', zipCode: '3000', latitude: -37.81, longitude: 144.96 },
] as unknown as PropertyListing[];

export default function MapHarness() {
  return <ListingsMapView listings={rows} onSelectListing={() => undefined} />;
}
