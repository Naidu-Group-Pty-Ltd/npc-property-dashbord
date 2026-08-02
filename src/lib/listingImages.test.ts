import { describe, expect, it } from 'vitest';
import {
  failureBackoffMs,
  imageIdentity,
  imageSetFingerprint,
  isFetchableImageUrl,
  isRefreshDue,
  isSignedUrlUsable,
  nextRefreshAt,
  normaliseImageCandidates,
  pickHeroImage,
  toImageCandidate,
  type ImageCandidate,
  type StoredListingImage,
} from '@/lib/listingImages';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 2);

/** An Airtable attachment, in the shape the API actually returns. */
function attachment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attABC123',
    url: 'https://v5.airtableusercontent.com/v3/u/40/full.jpg?ts=1770000000&sig=aaa',
    filename: 'front.jpg',
    size: 482_113,
    type: 'image/jpeg',
    width: 3000,
    height: 2000,
    thumbnails: {
      small: { url: 'https://v5.airtableusercontent.com/v3/u/40/sm.jpg?ts=1&sig=b', width: 54, height: 36 },
      large: { url: 'https://v5.airtableusercontent.com/v3/u/40/lg.jpg?ts=1&sig=c', width: 768, height: 512 },
      full: { url: 'https://v5.airtableusercontent.com/v3/u/40/fl.jpg?ts=1&sig=d', width: 3000, height: 2000 },
    },
    ...overrides,
  };
}

describe('isFetchableImageUrl', () => {
  it('accepts absolute http(s) URLs', () => {
    expect(isFetchableImageUrl('https://example.com/a.jpg')).toBe(true);
    expect(isFetchableImageUrl('http://example.com/a.jpg')).toBe(true);
  });

  it('rejects everything that is not one', () => {
    for (const value of [
      '',
      '   ',
      'undefined',
      '/relative/a.jpg',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      'ftp://example.com/a.jpg',
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isFetchableImageUrl(value)).toBe(false);
    }
  });

  it('rejects a URL long enough to be an attack rather than an address', () => {
    expect(isFetchableImageUrl(`https://example.com/${'a'.repeat(3000)}`)).toBe(false);
  });
});

describe('toImageCandidate', () => {
  it('reads an Airtable attachment object, preferring the largest thumbnail', () => {
    const candidate = toImageCandidate(attachment(), 'airtable');
    expect(candidate).toMatchObject({
      url: 'https://v5.airtableusercontent.com/v3/u/40/fl.jpg?ts=1&sig=d',
      origin: 'airtable',
      externalId: 'attABC123',
      filename: 'front.jpg',
      contentType: 'image/jpeg',
      width: 3000,
      height: 2000,
      bytes: 482_113,
    });
  });

  it('falls back down the thumbnail ladder, then to the original', () => {
    const noFull = toImageCandidate(
      attachment({ thumbnails: { large: { url: 'https://x.test/lg.jpg', width: 768, height: 512 } } }),
      'airtable',
    );
    expect(noFull?.url).toBe('https://x.test/lg.jpg');

    const noThumbs = toImageCandidate(attachment({ thumbnails: undefined }), 'airtable');
    expect(noThumbs?.url).toContain('/full.jpg');
    expect(noThumbs?.width).toBe(3000);
  });

  it('reads a bare URL string from a text field', () => {
    expect(toImageCandidate('https://example.com/a.jpg', 'listing_url')).toEqual({
      url: 'https://example.com/a.jpg',
      origin: 'listing_url',
    });
  });

  it('returns null for an attachment with no usable URL anywhere', () => {
    expect(toImageCandidate(attachment({ url: null, thumbnails: undefined }), 'airtable')).toBeNull();
    expect(toImageCandidate({ filename: 'a.jpg' }, 'airtable')).toBeNull();
    expect(toImageCandidate(null, 'airtable')).toBeNull();
  });
});

describe('imageIdentity', () => {
  it('identifies an attachment by its Airtable id, not its signed URL', () => {
    const a = toImageCandidate(attachment(), 'airtable') as ImageCandidate;
    const reSigned = toImageCandidate(
      attachment({
        thumbnails: { full: { url: 'https://v5.airtableusercontent.com/v3/u/40/fl.jpg?ts=9999&sig=zzz' } },
      }),
      'airtable',
    ) as ImageCandidate;
    // Airtable re-signs on every read; the same photo must not look new.
    expect(imageIdentity(a)).toBe(imageIdentity(reSigned));
  });

  it('ignores the query string of a plain URL for the same reason', () => {
    const a = { url: 'https://cdn.test/p/1.jpg?v=1', origin: 'scraped' } as ImageCandidate;
    const b = { url: 'https://cdn.test/p/1.jpg?v=2', origin: 'scraped' } as ImageCandidate;
    expect(imageIdentity(a)).toBe(imageIdentity(b));
  });

  it('still separates genuinely different paths', () => {
    const a = { url: 'https://cdn.test/p/1.jpg', origin: 'scraped' } as ImageCandidate;
    const b = { url: 'https://cdn.test/p/2.jpg', origin: 'scraped' } as ImageCandidate;
    expect(imageIdentity(a)).not.toBe(imageIdentity(b));
  });
});

describe('normaliseImageCandidates', () => {
  it('normalises a mixed field of attachments and strings', () => {
    const out = normaliseImageCandidates([
      attachment(),
      'https://example.com/b.jpg',
      null,
      'not a url',
      { filename: 'broken.jpg' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].externalId).toBe('attABC123');
    expect(out[1].url).toBe('https://example.com/b.jpg');
  });

  it('preserves the agent’s ordering, because the first photo is the hero shot', () => {
    const out = normaliseImageCandidates([
      'https://example.com/c.jpg',
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
    ]);
    expect(out.map((c) => c.url)).toEqual([
      'https://example.com/c.jpg',
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
    ]);
  });

  it('de-duplicates the same photo re-signed twice', () => {
    const out = normaliseImageCandidates([attachment(), attachment()]);
    expect(out).toHaveLength(1);
  });

  it('accepts a single non-array value', () => {
    expect(normaliseImageCandidates('https://example.com/a.jpg')).toHaveLength(1);
    expect(normaliseImageCandidates(null)).toEqual([]);
    expect(normaliseImageCandidates(undefined)).toEqual([]);
  });
});

describe('imageSetFingerprint', () => {
  const set = (urls: string[]) =>
    urls.map((url) => ({ url, origin: 'scraped' }) as ImageCandidate);

  it('is order independent', () => {
    expect(imageSetFingerprint(set(['https://x.test/1.jpg', 'https://x.test/2.jpg']))).toBe(
      imageSetFingerprint(set(['https://x.test/2.jpg', 'https://x.test/1.jpg'])),
    );
  });

  it('does not change when Airtable re-signs the same attachments', () => {
    expect(imageSetFingerprint(normaliseImageCandidates([attachment()]))).toBe(
      imageSetFingerprint(
        normaliseImageCandidates([
          attachment({ url: 'https://v5.airtableusercontent.com/v3/u/40/full.jpg?ts=2&sig=q' }),
        ]),
      ),
    );
  });

  it('does change when a photo is added or removed', () => {
    const one = imageSetFingerprint(set(['https://x.test/1.jpg']));
    const two = imageSetFingerprint(set(['https://x.test/1.jpg', 'https://x.test/2.jpg']));
    expect(one).not.toBe(two);
  });

  it('has a stable empty value', () => {
    expect(imageSetFingerprint([])).toBe(imageSetFingerprint([]));
  });
});

describe('nextRefreshAt', () => {
  const daysUntil = (at: number) => Math.round((at - NOW) / DAY);

  it('polls a brand-new listing daily and an old one rarely', () => {
    expect(daysUntil(nextRefreshAt({ listedAt: NOW - 2 * DAY, now: NOW }))).toBe(1);
    expect(daysUntil(nextRefreshAt({ listedAt: NOW - 20 * DAY, now: NOW }))).toBe(3);
    expect(daysUntil(nextRefreshAt({ listedAt: NOW - 90 * DAY, now: NOW }))).toBe(14);
    expect(daysUntil(nextRefreshAt({ listedAt: NOW - 900 * DAY, now: NOW }))).toBe(60);
  });

  it('treats an unknown date as mid-life, not as new', () => {
    expect(daysUntil(nextRefreshAt({ listedAt: null, now: NOW }))).toBe(14);
    expect(daysUntil(nextRefreshAt({ listedAt: Number.NaN, now: NOW }))).toBe(14);
  });

  it('treats a future date as brand new rather than going negative', () => {
    expect(daysUntil(nextRefreshAt({ listedAt: NOW + 5 * DAY, now: NOW }))).toBe(1);
  });

  it('always schedules forward', () => {
    for (const age of [0, 1, 7, 8, 30, 31, 180, 181, 5000]) {
      expect(nextRefreshAt({ listedAt: NOW - age * DAY, now: NOW })).toBeGreaterThan(NOW);
    }
  });

  it('backs a failing listing off instead of using its recency tier', () => {
    const first = nextRefreshAt({ listedAt: NOW, errorCount: 1, now: NOW });
    const fifth = nextRefreshAt({ listedAt: NOW, errorCount: 5, now: NOW });
    expect(fifth).toBeGreaterThan(first);
    // A hot listing would normally be re-checked in a day; a failing one waits longer.
    expect(fifth - NOW).toBeGreaterThan(DAY);
  });
});

describe('failureBackoffMs', () => {
  it('grows with each failure and then stops growing', () => {
    expect(failureBackoffMs(1)).toBeLessThan(failureBackoffMs(2));
    expect(failureBackoffMs(20)).toBe(failureBackoffMs(50));
    expect(failureBackoffMs(50)).toBeLessThanOrEqual(60 * DAY);
  });

  it('handles a zero or nonsense count without going backwards', () => {
    expect(failureBackoffMs(0)).toBeGreaterThan(0);
    expect(failureBackoffMs(-3)).toBeGreaterThan(0);
  });
});

describe('isRefreshDue', () => {
  it('is due when the timestamp has passed, and never due early', () => {
    expect(isRefreshDue(NOW - 1, NOW)).toBe(true);
    expect(isRefreshDue(NOW, NOW)).toBe(true);
    expect(isRefreshDue(NOW + 1, NOW)).toBe(false);
  });

  it('treats a missing schedule as due, so a new row is harvested', () => {
    expect(isRefreshDue(null, NOW)).toBe(true);
    expect(isRefreshDue(undefined, NOW)).toBe(true);
    expect(isRefreshDue(Number.NaN, NOW)).toBe(true);
  });
});

describe('pickHeroImage', () => {
  const image = (over: Partial<StoredListingImage>): StoredListingImage => ({
    listingId: 'rec1',
    url: 'https://signed.test/x.jpg',
    position: 0,
    origin: 'airtable',
    width: null,
    height: null,
    expiresAt: NOW + 3600_000,
    ...over,
  });

  it('leads with the lowest position', () => {
    const hero = pickHeroImage([image({ position: 2 }), image({ position: 0, url: 'first' }), image({ position: 1 })]);
    expect(hero?.url).toBe('first');
  });

  it('breaks a positional tie on origin quality', () => {
    const hero = pickHeroImage([
      image({ position: 0, origin: 'street_view', url: 'pano' }),
      image({ position: 0, origin: 'airtable', url: 'photo' }),
    ]);
    expect(hero?.url).toBe('photo');
  });

  it('does not mutate the caller’s array', () => {
    const list = [image({ position: 2, url: 'b' }), image({ position: 1, url: 'a' })];
    pickHeroImage(list);
    expect(list.map((i) => i.url)).toEqual(['b', 'a']);
  });

  it('returns null for an empty set', () => {
    expect(pickHeroImage([])).toBeNull();
  });
});

describe('isSignedUrlUsable', () => {
  const image: StoredListingImage = {
    listingId: 'rec1',
    url: 'https://signed.test/x.jpg',
    position: 0,
    origin: 'airtable',
    width: null,
    height: null,
    expiresAt: NOW + 120_000,
  };

  it('rejects a URL that is about to expire mid-render', () => {
    expect(isSignedUrlUsable(image, NOW)).toBe(true);
    expect(isSignedUrlUsable(image, NOW + 90_000)).toBe(false);
    expect(isSignedUrlUsable(image, NOW + 200_000)).toBe(false);
  });
});
