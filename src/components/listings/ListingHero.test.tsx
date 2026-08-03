import { describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach } from 'vitest';
import { ListingHero } from './ListingHero';
import type { StoredListingImage } from '@/lib/listingImages';

// Street View fetches a static panorama through an edge function. The carousel's
// job is to put it on the last slide; whether Google answers is that panel's
// problem, so it is stubbed to something inert.
vi.mock('@/components/listings/StreetViewPanel', () => ({
  StreetViewPanel: ({ label }: { label?: string }) => (
    <div data-testid="street-view">{label ?? 'street view'}</div>
  ),
}));

afterEach(cleanup);

const photo = (n: number): StoredListingImage =>
  ({ url: `https://cdn.example.com/p${n}.jpg`, position: n, origin: 'scraped' }) as StoredListingImage;

const POINT = { lat: -31.94, lng: 115.76 };

const LISTING = {
  address: '13 Larundel Road',
  suburb: 'City Beach',
  state: 'WA',
  propertyType: 'House',
  price: 850_000,
} as never;

describe('ListingHero', () => {
  it('says so when there is no photo, rather than showing an empty frame', () => {
    // On a grid, a blank tile reads as "still loading" indefinitely. Most of
    // this corpus has no photograph yet, so this is the common case.
    render(<ListingHero images={[]} />);
    expect(screen.getByText('No photo on record')).toBeTruthy();
  });

  it('offers to fetch photos when the caller can, and shows progress while it does', () => {
    // The sweep works worst-first through 1,441 records, so a given listing may
    // be hours from its turn. The empty state is the only place someone looking
    // at that listing can say "do it now".
    const onFindPhotos = vi.fn();
    const { rerender } = render(<ListingHero images={[]} onFindPhotos={onFindPhotos} />);

    fireEvent.click(screen.getByRole('button', { name: /find photos/i }));
    expect(onFindPhotos).toHaveBeenCalledTimes(1);

    rerender(<ListingHero images={[]} onFindPhotos={onFindPhotos} isFindingPhotos />);
    expect(screen.getByText('Looking for photos…')).toBeTruthy();
    // The button must not survive into the pending state; a second press would
    // queue a duplicate fetch for the same record.
    expect(screen.queryByRole('button', { name: /find photos/i })).toBeNull();
  });

  it('leaves the empty state a plain statement when no fetch is offered', () => {
    render(<ListingHero images={[]} />);
    expect(screen.getByText('No photo on record')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /find photos/i })).toBeNull();
  });

  it('does not load Street View for a photo-less card until asked', () => {
    // A 48-card grid where every photo-less tile auto-loaded a panorama would
    // spend ~96 metered Google calls per page view against a 5,000/day global
    // quota that the edge function does not cache. The cover is free; the
    // panorama is one deliberate click.
    render(<ListingHero images={[]} point={POINT} streetViewMode="on-demand" listing={LISTING} />);
    expect(screen.queryByTestId('street-view')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Street View' }));
    expect(screen.getByTestId('street-view')).toBeTruthy();
  });

  it('keeps Street View as an always-present slide where one listing is on screen', () => {
    // The property page and the map popup render a single listing, so there is
    // no fan-out to protect against and the panorama should just be there.
    render(<ListingHero images={[]} point={POINT} listing={LISTING} label="12 Example St" />);
    expect(screen.getByTestId('street-view')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Street View' })).toBeNull();
  });

  it('does not carry one listing\u2019s Street View request onto the next', () => {
    // Cards are recycled as the reader filters and scrolls. Inheriting the
    // request would silently spend a call on a property nobody asked about.
    const { rerender } = render(
      <ListingHero images={[]} point={POINT} streetViewMode="on-demand" listing={LISTING} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Street View' }));
    expect(screen.getByTestId('street-view')).toBeTruthy();

    rerender(
      <ListingHero
        images={[]}
        point={POINT}
        streetViewMode="on-demand"
        listing={{ ...LISTING, address: '9 Birch Road', suburb: 'Aubin Grove' }}
      />,
    );
    expect(screen.queryByTestId('street-view')).toBeNull();
  });

  it('draws a cover instead of a blank frame when the record can describe itself', () => {
    render(<ListingHero images={[]} listing={LISTING} />);
    // Still honest about the photograph...
    expect(screen.getByText('No photo on record')).toBeTruthy();
    // ...but the frame carries the locality rather than being dead grey space.
    expect(screen.getByText('City Beach WA')).toBeTruthy();
  });

  it('shows a counter and advances through the photos', async () => {
    render(<ListingHero images={[photo(1), photo(2), photo(3)]} label="12 Example St" />);

    expect(screen.getByText('1/3')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Next photo'));
    expect(screen.getByText('2/3')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Previous photo'));
    expect(screen.getByText('1/3')).toBeTruthy();
  });

  it('wraps at both ends', async () => {
    render(<ListingHero images={[photo(1), photo(2)]} />);
    fireEvent.click(screen.getByLabelText('Previous photo'));
    expect(screen.getByText('2/2')).toBeTruthy();
  });

  it('offers no controls for a single photo', () => {
    render(<ListingHero images={[photo(1)]} />);
    expect(screen.queryByLabelText('Next photo')).toBeNull();
  });

  /**
   * The behaviour the map popup needed. It previously showed EITHER one
   * photograph OR Street View in one frame, behind a toggle that only appeared
   * when a photograph existed — so with no photos it silently showed Street View
   * and gave no hint a photograph was ever expected.
   */
  it('adds Street View as the last slide without displacing the photos', async () => {
    render(<ListingHero images={[photo(1), photo(2)]} point={POINT} label="12 Example St" />);

    // A photograph leads.
    expect(screen.getByText('1/2')).toBeTruthy();
    expect(screen.queryByTestId('street-view')).toBeNull();

    fireEvent.click(screen.getByLabelText('Next photo'));
    fireEvent.click(screen.getByLabelText('Next photo'));
    expect(screen.getByTestId('street-view')).toBeTruthy();
    expect(screen.getByText('Street View')).toBeTruthy();
  });

  it('jumps straight to Street View from the shortcut', async () => {
    render(<ListingHero images={[photo(1), photo(2)]} point={POINT} />);
    fireEvent.click(screen.getByRole('button', { name: /street/i }));
    expect(screen.getByTestId('street-view')).toBeTruthy();
  });

  it('falls back to Street View alone when there are no photos', () => {
    // Which is the honest answer for a listing we have not harvested yet: the
    // location is known, the property is not.
    render(<ListingHero images={[]} point={POINT} />);
    expect(screen.getByTestId('street-view')).toBeTruthy();
    expect(screen.queryByText('No photo on record')).toBeNull();
  });

  it('drops a photo whose signed url has expired instead of leaving a broken frame', async () => {
    render(<ListingHero images={[photo(1), photo(2)]} />);
    expect(screen.getByRole('img').getAttribute('src')).toContain('p1.jpg');

    fireEvent.error(screen.getByRole('img'));

    // The dead one leaves the set and the next photo takes its place, rather
    // than the reader being left looking at a broken frame.
    expect(screen.getByRole('img').getAttribute('src')).toContain('p2.jpg');
    // One photo left, so the counter and arrows go away.
    expect(screen.queryByLabelText('Next photo')).toBeNull();
  });

  it('restarts at the first slide when it is handed a different listing', async () => {
    // The map popup reuses one component across markers. Without this, slide 5
    // of the previous listing becomes slide 5 of a two-photo one.
    const { rerender } = render(<ListingHero images={[photo(1), photo(2), photo(3)]} />);
    fireEvent.click(screen.getByLabelText('Next photo'));
    expect(screen.getByText('2/3')).toBeTruthy();

    rerender(<ListingHero images={[photo(7), photo(8)]} />);
    expect(screen.getByText('1/2')).toBeTruthy();
  });

  it('is keyboard operable', async () => {
    render(<ListingHero images={[photo(1), photo(2), photo(3)]} />);
    const carousel = screen.getByRole('group');
    carousel.focus();
    fireEvent.keyDown(carousel, { key: 'ArrowRight' });
    expect(screen.getByText('2/3')).toBeTruthy();
    fireEvent.keyDown(carousel, { key: 'ArrowLeft' });
    expect(screen.getByText('1/3')).toBeTruthy();
  });

  it('reports which slide was open when it is expanded', async () => {
    const onExpand = vi.fn();
    render(<ListingHero images={[photo(1), photo(2)]} onExpand={onExpand} label="12 Example St" />);
    fireEvent.click(screen.getByLabelText('Next photo'));
    fireEvent.click(screen.getByLabelText('Enlarge 12 Example St'));
    expect(onExpand).toHaveBeenCalledWith(1);
  });
});
