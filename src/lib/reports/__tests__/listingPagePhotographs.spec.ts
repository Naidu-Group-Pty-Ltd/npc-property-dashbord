/**
 * A URL-extract report takes the listing's own photographs — and never the
 * house next door's.
 *
 * On 25 Sep 2026 the owner decided a client's report may carry the listing's
 * photographs from the page a URL extract read. A listing page also shows OTHER
 * listings' photographs ("similar properties"), so attribution is read from the
 * page's own data: realestate.com.au publishes the listing it is showing at
 * `details.listing` inside `window.ArgonautExchange`, three JSON documents deep,
 * with photographs and floor plans in separate lists. The fixture below is built
 * in exactly that nesting, as Scrapfly's worked example documents it, with a
 * second listing and floor plans present so the test can see them refused.
 */
import { describe, expect, it } from 'vitest';

import {
  argonautListings,
  captureRenditions,
  jsonObjectAt,
  ogImageFromHtml,
  PAGE_PHOTOGRAPH_CANDIDATE_LIMIT,
  photographCandidatesFromPage,
  REA_CLASSIFY_RENDITION,
  REA_STORE_RENDITION,
  reaImageAsset,
  reaListingIdFromUrl,
  readPageCandidates,
} from '../../../../supabase/functions/_shared/listingPagePhotographs.pure';

const PAGE = 'https://www.realestate.com.au/property-house-wa-spalding-152134896';
const hash = (n: number | string) => String(n).padStart(64, String(n).slice(-1)).replace(/[^0-9a-f]/g, 'a');
const templated = (h: string, file = 'image.jpg') => `https://i2.au.reastatic.net/{size}/${h}/${file}`;
const stored = (h: string, file = 'image.jpg') => `https://i2.au.reastatic.net/${REA_STORE_RENDITION}/${h}/${file}`;

interface ReaPageOptions {
  listingId?: string | number;
  images?: string[];
  mainImage?: string;
  floorplans?: string[];
  /** A different listing in the same cache — a prefetched neighbour. */
  otherListing?: { id: string; images: string[] };
  ogImage?: string;
  /** Markup around the data: thumbnails of other listings. */
  similarThumbs?: string[];
}

function reaPage(options: ReaPageOptions): string {
  const listing = {
    __typename: 'BuyResidentialListing',
    id: String(options.listingId ?? '152134896'),
    media: {
      ...(options.mainImage ? { mainImage: { templatedUrl: templated(options.mainImage) } } : {}),
      images: (options.images ?? []).map((h) => ({ __typename: 'Image', templatedUrl: templated(h) })),
      floorplans: (options.floorplans ?? []).map((h) => ({ __typename: 'Image', templatedUrl: templated(h) })),
    },
  };
  const cache: Record<string, { data: string }> = {
    '3318744402': { data: JSON.stringify({ details: { listing } }) },
  };
  if (options.otherListing) {
    cache['8810022991'] = {
      data: JSON.stringify({
        details: {
          listing: {
            id: options.otherListing.id,
            media: { images: options.otherListing.images.map((h) => ({ templatedUrl: templated(h) })) },
          },
        },
      }),
    };
  }
  const exchange = { 'resi-property_listing-experience-web': { urqlClientCache: JSON.stringify(cache) } };
  const og = options.ogImage ? `<meta property="og:image" content="${options.ogImage}">` : '';
  const thumbs = (options.similarThumbs ?? [])
    .map((h) => `<img src="https://i2.au.reastatic.net/340x64-format=webp/${h}/image.jpg">`).join('');
  return `<!doctype html><html><head>${og}<title>60 Lawley Street</title></head><body>` +
    `<script>window.ArgonautExchange=${JSON.stringify(exchange)};window.other={"a":1};</script>` +
    `<section class="similar">${thumbs}</section></body></html>`;
}

describe('realestate.com.au: the listing the page names, from its own data', () => {
  it('takes the listing\'s photographs in the agent\'s order, at the stored rendition', () => {
    const h = [hash(1), hash(2), hash(3)];
    const out = photographCandidatesFromPage({ pageUrl: PAGE, rawHtml: reaPage({ images: h }) });
    expect(out).toEqual(h.map((x) => ({ url: stored(x), origin: 'listing_gallery' })));
  });

  it('never a floor plan, and never another listing\'s photograph on the same page', () => {
    const own = [hash(1), hash(2)];
    const out = photographCandidatesFromPage({
      pageUrl: PAGE,
      rawHtml: reaPage({
        images: own,
        floorplans: [hash(7)],
        otherListing: { id: '149999999', images: [hash(8), hash(9)] },
        similarThumbs: [hash(8), hash(9)],
      }),
    });
    expect(out.map((c) => c.url)).toEqual(own.map((x) => stored(x)));
    const urls = out.map((c) => c.url).join(' ');
    for (const refused of [hash(7), hash(8), hash(9)]) expect(urls).not.toContain(refused);
  });

  it('refuses the gallery when the data describes a different listing from the URL', () => {
    const out = photographCandidatesFromPage({
      pageUrl: PAGE,
      rawHtml: reaPage({ listingId: '149999999', images: [hash(1)], ogImage: `https://i2.au.reastatic.net/1200x630-format=jpeg/${hash(5)}/image.jpg` }),
    });
    // Only the page's own og:image survives, as the cover.
    expect(out).toEqual([{ url: stored(hash(5)), origin: 'og_image' }]);
  });

  it('reads a GraphQL-style id that carries the listing number', () => {
    const out = photographCandidatesFromPage({
      pageUrl: PAGE,
      rawHtml: reaPage({ listingId: 'BuyResidentialListing:152134896', images: [hash(1)] }),
    });
    expect(out.map((c) => c.origin)).toEqual(['listing_gallery']);
  });

  it('a lead image stated separately leads, and is not taken twice', () => {
    const out = photographCandidatesFromPage({
      pageUrl: PAGE,
      rawHtml: reaPage({ mainImage: hash(2), images: [hash(1), hash(2)] }),
    });
    expect(out.map((c) => c.url)).toEqual([stored(hash(2)), stored(hash(1))]);
  });

  it('a property profile page names no listing, so its data is never read as one', () => {
    expect(reaListingIdFromUrl('https://www.realestate.com.au/property/60-lawley-st-spalding-wa-6530')).toBeNull();
    expect(reaListingIdFromUrl(PAGE)).toBe('152134896');
    expect(reaListingIdFromUrl('https://www.domain.com.au/60-lawley-street-spalding-wa-6530-2019598837')).toBeNull();
  });

  it('never more candidates than the ceiling', () => {
    const many = Array.from({ length: 30 }, (_, i) => hash(`${i + 10}`));
    const unique = [...new Set(many)];
    const out = photographCandidatesFromPage({ pageUrl: PAGE, rawHtml: reaPage({ images: unique }) });
    expect(out.length).toBeLessThanOrEqual(PAGE_PHOTOGRAPH_CANDIDATE_LIMIT);
  });

  it('a page whose data is missing or broken falls back to og:image and never throws', () => {
    const og = `https://i2.au.reastatic.net/1200x630-format=jpeg/${hash(4)}/image.jpg`;
    const broken = `<html><head><meta content="${og}" property="og:image"></head>` +
      '<script>window.ArgonautExchange={"resi-property_listing-experience-web":{"urqlClientCache":"{not json';
    expect(photographCandidatesFromPage({ pageUrl: PAGE, rawHtml: broken }))
      .toEqual([{ url: stored(hash(4)), origin: 'og_image' }]);
    expect(photographCandidatesFromPage({ pageUrl: 'not a url', rawHtml: broken })).toEqual([]);
  });
});

describe('every other page: its own og:image, as the cover, and nothing else', () => {
  const agency = 'https://www.acmerealty.com.au/listings/60-lawley-street';

  it('takes the declared og:image, resolved against the page', () => {
    const out = photographCandidatesFromPage({
      pageUrl: agency,
      rawHtml: '<meta property="og:image" content="/uploads/60-lawley/front-1920.jpg"><img src="/uploads/other-house.jpg">',
    });
    expect(out).toEqual([{ url: 'https://www.acmerealty.com.au/uploads/60-lawley/front-1920.jpg', origin: 'og_image' }]);
  });

  it('prefers what the reader reported to what the markup says', () => {
    const out = photographCandidatesFromPage({
      pageUrl: agency,
      rawHtml: '<meta property="og:image" content="https://cdn.acme.example/b.jpg">',
      ogImage: 'https://cdn.acme.example/a.jpg',
    });
    expect(out.map((c) => c.url)).toEqual(['https://cdn.acme.example/a.jpg']);
  });

  it('refuses a logo, an icon, an SVG and anything not served over https', () => {
    for (const og of [
      'https://cdn.acme.example/brand/logo-header.png',
      'https://cdn.acme.example/icons/share.png',
      'https://cdn.acme.example/hero.svg',
      'http://cdn.acme.example/hero.jpg',
    ]) {
      expect(photographCandidatesFromPage({ pageUrl: agency, ogImage: og })).toEqual([]);
    }
  });

  it('a page that declares nothing yields nothing', () => {
    expect(photographCandidatesFromPage({ pageUrl: agency, rawHtml: '<p>no images declared</p>' })).toEqual([]);
    expect(photographCandidatesFromPage({ pageUrl: agency })).toEqual([]);
  });
});

describe('renditions — measured on i2.au.reastatic.net, 25 Sep 2026', () => {
  it('stores the original frame (fit: no crop, no pad, no upscale) and looks at a smaller one', () => {
    // `2000x2000` alone crops to the box; `-resize` stretches; `-fit` keeps the frame.
    expect(REA_STORE_RENDITION).toBe('2000x2000-fit');
    expect(REA_CLASSIFY_RENDITION).toBe('800x800-fit');
    const url = templated(hash(1));
    expect(captureRenditions(url)).toEqual({
      store: `https://i2.au.reastatic.net/2000x2000-fit/${hash(1)}/image.jpg`,
      classify: `https://i2.au.reastatic.net/800x800-fit/${hash(1)}/image.jpg`,
    });
    // Any rendition of the asset names the same asset.
    expect(reaImageAsset(`https://i1.au.reastatic.net/600x400,gravity=north/${hash(1)}/image.jpg`))
      .toEqual({ hash: hash(1), file: 'image.jpg' });
  });

  it('any other host is stored as it was named and judged on those bytes', () => {
    expect(captureRenditions('https://cdn.acme.example/a.jpg')).toEqual({ store: 'https://cdn.acme.example/a.jpg', classify: null });
  });
});

describe('the stored candidate list is re-checked on the way in', () => {
  it('https only, known origins only, one per photograph, capped', () => {
    const out = readPageCandidates([
      { url: stored(hash(1)), origin: 'listing_gallery' },
      { url: `https://i1.au.reastatic.net/800x600/${hash(1)}/image.jpg`, origin: 'listing_gallery' },
      { url: 'http://cdn.acme.example/a.jpg', origin: 'og_image' },
      { url: 'https://cdn.acme.example/b.jpg', origin: 'somewhere' },
      { url: 'javascript:alert(1)', origin: 'og_image' },
      'https://cdn.acme.example/c.jpg',
      { url: 'https://cdn.acme.example/d.jpg', origin: 'og_image' },
    ]);
    expect(out).toEqual([
      { url: stored(hash(1)), origin: 'listing_gallery' },
      { url: 'https://cdn.acme.example/d.jpg', origin: 'og_image' },
    ]);
    expect(readPageCandidates(null)).toEqual([]);
    expect(readPageCandidates(Array.from({ length: 40 }, (_, i) => ({ url: `https://cdn.acme.example/${i}.jpg`, origin: 'og_image' }))))
      .toHaveLength(PAGE_PHOTOGRAPH_CANDIDATE_LIMIT);
  });

  it('holds a planted URL to the rule the page was read with: no page, no icon, no vector', () => {
    expect(readPageCandidates([
      { url: 'https://example.com/admin/export', origin: 'og_image' },
      { url: 'https://cdn.acme.example/logo.svg', origin: 'og_image' },
      { url: 'https://cdn.acme.example/icons/bed.png', origin: 'listing_gallery' },
      { url: 'https://cdn.acme.example/front.jpg', origin: 'og_image' },
    ])).toEqual([{ url: 'https://cdn.acme.example/front.jpg', origin: 'og_image' }]);
  });
});

describe('reading the embedded data', () => {
  it('finds where an object ends, whatever braces its strings hold', () => {
    const text = 'x={"a":"}{\\"}","b":{"c":[1,2,{"d":"}"}]}};rest';
    expect(JSON.parse(jsonObjectAt(text, 2)!)).toEqual({ a: '}{"}', b: { c: [1, 2, { d: '}' }] } });
    expect(jsonObjectAt('x=[1,2]', 2)).toBeNull();
    expect(jsonObjectAt('x={"a":1', 2)).toBeNull();
  });

  it('finds the listing under a renamed outer key, and still holds it to the listing id', () => {
    const listing = { id: '152134896', media: { images: [{ templatedUrl: templated(hash(1)) }] } };
    const exchange = { 'resi-property_listing-experience-web-v2': { cache: JSON.stringify({ k: { data: JSON.stringify({ details: { listing } }) } }) } };
    const html = `<script>window.ArgonautExchange = ${JSON.stringify(exchange)};</script>`;
    expect(argonautListings(html)).toHaveLength(1);
    expect(photographCandidatesFromPage({ pageUrl: PAGE, rawHtml: html }).map((c) => c.origin)).toEqual(['listing_gallery']);
    expect(photographCandidatesFromPage({ pageUrl: PAGE.replace('152134896', '152134897'), rawHtml: html })).toEqual([]);
  });

  it('reads og:image in either attribute order, and decodes an escaped ampersand', () => {
    expect(ogImageFromHtml('<meta property="og:image" content="https://a.example/x.jpg?w=1&amp;h=2">')).toBe('https://a.example/x.jpg?w=1&h=2');
    expect(ogImageFromHtml("<meta content='https://a.example/y.jpg' name='og:image'>")).toBe('https://a.example/y.jpg');
    expect(ogImageFromHtml('<meta property="og:title" content="x">')).toBeNull();
  });
});
