import { describe, expect, it } from 'vitest';
import { listingFreshness } from './listingDisplay';

const NOW = Date.parse('2026-08-04T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const listing = (over: Record<string, unknown>) => ({ ...over }) as never;

describe('listingFreshness', () => {
  it.each([
    [0, 'Added today'],
    [1, 'Added yesterday'],
    [4, 'Added 4 days ago'],
    [6, 'Added 6 days ago'],
    [8, 'Added last week'],
    [20, 'Added 2 weeks ago'],
    [45, 'Added over a month ago'],
  ])('reads %s days as "%s"', (days, expected) => {
    expect(listingFreshness(listing({ receivedAt: daysAgo(days) }), NOW)?.label).toBe(expected);
  });

  it('flags only the first few days as new', () => {
    // Airtable prunes at 30 days, so "new" has to mean days, not weeks.
    expect(listingFreshness(listing({ receivedAt: daysAgo(3) }), NOW)?.isNew).toBe(true);
    expect(listingFreshness(listing({ receivedAt: daysAgo(4) }), NOW)?.isNew).toBe(false);
  });

  it('says nothing when the date was invented rather than read', () => {
    // `listedAtKnown: false` marks exactly that. "Added today" on a month-old
    // listing is worse than no phrase at all.
    expect(listingFreshness(listing({ receivedAt: daysAgo(0), listedAtKnown: false }), NOW)).toBeNull();
  });

  it.each([
    ['no date at all', {}],
    ['an unparseable date', { receivedAt: 'not a date' }],
    ['a null date', { receivedAt: null }],
  ])('says nothing given %s', (_label, over) => {
    expect(listingFreshness(listing(over), NOW)).toBeNull();
  });

  it('says nothing for a future timestamp rather than counting down to it', () => {
    // A clock or parse problem, not a listing that has not happened yet.
    expect(listingFreshness(listing({ receivedAt: daysAgo(-3) }), NOW)).toBeNull();
  });

  it('falls back through the date fields in order of trustworthiness', () => {
    expect(
      listingFreshness(listing({ createdTime: daysAgo(1), listingDate: daysAgo(30) }), NOW)?.label,
    ).toBe('Added yesterday');
    expect(listingFreshness(listing({ listingDate: daysAgo(1) }), NOW)?.label).toBe('Added yesterday');
  });

  it('accepts a Date as readily as a string', () => {
    expect(listingFreshness(listing({ receivedAt: new Date(NOW - 86_400_000) }), NOW)?.label)
      .toBe('Added yesterday');
  });
});
