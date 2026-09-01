/**
 * BUILDER STOCK — THE PICTURE A BUILDER HANDS OVER DIRECTLY.
 *
 * Every image this product serves is read out of something: a column that
 * names a URL, a brochure page that names a lot, a page cover, a design
 * brochure. That works until there is nothing to read — and on the one live
 * source, thirteen of twenty-six published properties attach no document at
 * all. The pipeline's own fallbacks then offered, for those rows, a Simonds
 * display home, an ABC Homes display home and the land developer's estate
 * marketing, and refused all of them, correctly. The cards stayed blank
 * because there was nothing to read, and no reader fixes that.
 *
 * The one party who certainly has the picture is the builder, and the product
 * had no way for them to hand it over. That is what this module is for.
 *
 * TWO ROUTES, ONE ACT. A builder supplies a picture either FOR A DESIGN — one
 * render, serving every row of theirs that states it — or FOR ONE PROPERTY.
 * The first is the leverage (three uploads cover those thirteen rows, and
 * every future row of those designs for ever); the second is the guarantee
 * (whatever else went wrong, somebody can fix one card).
 *
 * NEITHER INVENTS A LEVEL OR A STAGE. A builder-supplied image is stored as
 * `uploaded_document` / `source_supplied`, which is what it is: bytes the
 * builder gave us for this property. It therefore travels the existing ladder
 * unchanged — `isDisplayableSourceImage`, `rankImage`, `chooseCardImage`, the
 * marketplace eligibility gate — and a card drawing one truthfully says
 * "Builder supplied". In particular it goes through the promotional-overlay
 * rule like any other builder image: a render with "$25,000 REBATE" set over
 * it is refused here exactly as it is when it arrives inside a brochure, and
 * for the same reason.
 *
 * Pure: no IO, no clock, no network.
 */

/**
 * The comparison key for a design name.
 *
 * Case, spacing and punctuation are removed, so `DK 22B`, `dk 22b` and
 * `DK-22B` are one design — which is how a builder types the same house into
 * twenty rows.
 */
export function designImageKey(design: string | null | undefined): string | null {
  const key = String(design ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return key ? key : null;
}

/**
 * WHY `designIdentityIsDistinctive` IS DELIBERATELY NOT USED HERE.
 *
 * That rule asks whether a design name is distinctive enough to IDENTIFY A
 * DOCUMENT BY ITSELF — whether a page mentioning "18" can be taken as being
 * about this design. It is a rule about inference from somebody's prose, and
 * it is right for that.
 *
 * There is no inference here. The builder picks a design from the ones their
 * OWN stock list already states, and the render reaches a property only when
 * that property's own `house_design` is the same string. `DK 22B` fails the
 * distinctiveness test — two tokens, neither of them three letters — and it is
 * exactly the design eleven live properties state. Applying a text-matching
 * rule to an exact, builder-chosen, organisation-scoped equality would refuse
 * the whole case this exists for.
 *
 * The guard that replaces it is stronger and is enforced by the caller: a
 * render can only be uploaded for a design THIS ORGANISATION'S OWN STOCK
 * STATES. A builder cannot supply a render for a design they do not sell, and
 * `designsInStock` is what the surface offers them to choose from.
 */
export interface DesignInStock {
  /** The comparison key. */
  key: string;
  /** As the builder's own rows write it, for anything a person reads. */
  label: string;
  /** How many of this organisation's properties state it. */
  properties: number;
  /** How many of those still have no picture at all. */
  withoutImage: number;
}

/**
 * The designs an organisation's stock actually states, with their coverage.
 *
 * Ordered by what a render would do: most properties still without a picture
 * first, so the upload that fixes eleven cards is the one at the top. Ties
 * fall to the label, so the list is stable between reads.
 *
 * A row stating no design contributes nothing — there is no design to supply a
 * render for, and that property's route is the per-property upload.
 */
export function designsInStock(
  rows: ReadonlyArray<{
    house_design?: string | null;
    hasImage?: boolean;
  }>,
): DesignInStock[] {
  const byKey = new Map<string, DesignInStock>();
  for (const row of rows ?? []) {
    const label = String(row?.house_design ?? '').trim();
    const key = designImageKey(label);
    if (!key) continue;
    const entry = byKey.get(key) ?? { key, label, properties: 0, withoutImage: 0 };
    entry.properties += 1;
    if (!row?.hasImage) entry.withoutImage += 1;
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) =>
    b.withoutImage - a.withoutImage
    || b.properties - a.properties
    || a.label.localeCompare(b.label));
}

/**
 * The properties one design render serves, out of a set already scoped to the
 * organisation that owns the render.
 *
 * EXACT KEY EQUALITY AND NOTHING ELSE. No prefix, no token overlap, no
 * closest match: `DK 22B` serves `DK 22B` and never `DK 23B`, which differ by
 * one character and are different houses. The whole safety of this feature is
 * that it cannot be clever.
 */
export function propertiesForDesign<T extends { id: string; house_design?: string | null }>(
  rows: ReadonlyArray<T>,
  designKey: string,
): T[] {
  const key = designImageKey(designKey);
  if (!key) return [];
  return (rows ?? []).filter((row) => designImageKey(row?.house_design) === key);
}

/**
 * The design a stored row states, from the one place it can be.
 *
 * `house_design` is the canonical field. A row imported before the `HOUSE`
 * column was mappable carries it in `unmapped` instead — and those rows are
 * exactly the ones this feature exists for, so reading both means a builder
 * does not have to re-read their source before they can supply a render.
 * Re-reading it is still better, and the page says so.
 *
 * Shared because three callers must agree: the surface that offers a builder
 * their designs, the fan-out that attaches a render, and the settler that
 * applies one to stock imported later.
 */
export function designOfStoredRow(sourceRow: unknown): string | null {
  const row = (sourceRow ?? {}) as Record<string, unknown>;
  const canonical = typeof row.house_design === 'string' ? row.house_design.trim() : '';
  if (canonical) return canonical;
  const unmapped = (row.unmapped ?? {}) as Record<string, unknown>;
  for (const key of ['HOUSE', 'House', 'house']) {
    const value = unmapped[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** Where a builder-supplied object lives, so one rule names every path. */
export function designImageStoragePath(input: {
  organisationId: string;
  designKey: string;
  filename: string;
}): string {
  return `builder-designs/${input.organisationId}/${input.designKey}/${input.filename}`;
}

export function propertyImageStoragePath(input: {
  organisationId: string;
  stockItemId: string;
  filename: string;
}): string {
  return `builder-supplied/${input.organisationId}/${input.stockItemId}/${input.filename}`;
}

/**
 * Is this a path this product wrote for a builder-supplied image?
 *
 * Checked before anything is read back out of storage, for the reason
 * `isAcceptableStockStoragePath` exists: a path that arrives in a request body
 * is a lookup key and never authority, and a caller must not be able to name
 * an object outside the two prefixes above.
 */
export function isBuilderSuppliedPath(path: string | null | undefined): boolean {
  const value = String(path ?? '');
  if (!value || value.includes('..') || value.startsWith('/')) return false;
  return /^builder-(designs|supplied)\/[0-9a-f-]{36}\/[^/]+\/[^/]+$/i.test(value);
}
