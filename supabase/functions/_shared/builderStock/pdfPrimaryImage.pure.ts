/**
 * Builder stock — WHICH page of a PDF is the property's cover, and which
 * picture on it is the hero.
 *
 * This is LEVEL 2 of `sourceImageRole.pure.ts` for a paginated document, and it
 * is the half the pipeline never had. `pdfPageImages.pure.ts` finds every
 * picture a page draws and rejects the ones that cannot be photographs;
 * everything after that used to be "the largest one, on the first page that has
 * one", which is a statement about rasters and never about the property.
 *
 * WHAT IT COST. The live Lot 537 Kirramingly Avenue contract has, on the page a
 * person opens first, the lot and street, the estate, the house design, the
 * fixed contract price, the land and build sizes, and one large facade render.
 * On its third page it has "INCLUSIONS" and a bedroom. The old rule reached the
 * third page and took the bedroom, because the bedroom is 2202×1229 and the
 * page draws it across the full bleed. Both pictures are the builder's; only
 * one of them is what this property looks like from the street.
 *
 * THE RULE, AND IT ONLY EVER ANSWERS FROM THE DOCUMENT'S OWN WORDS:
 *
 *   1. A page is a PROPERTY COVER when it states the property's IDENTITY — the
 *      lot, address or reference the row was imported under — together with its
 *      PACKAGE INFORMATION: a price, a configuration, a land or build size, a
 *      contract or package heading. Identity alone is not enough (a floorplan
 *      page repeats the lot) and package facts alone are not enough (an
 *      inclusions page quotes prices).
 *   2. The hero is the ONE candidate picture on that page which the page does
 *      not draw more than once and which no other page of the document also
 *      draws. Repetition is the document telling us a picture is furniture — a
 *      bleed wash, a banner, a letterhead — and furniture is never one
 *      property's listing image.
 *   3. Anything else — no cover page, no surviving candidate, or two of them —
 *      is NO PRIMARY. Not the biggest, not the first, not the most detailed.
 *
 * Nothing here reads a page NUMBER as meaningful. Page one is not privileged;
 * the cover of a package is wherever the package puts it, and a document whose
 * page order we could not establish is refused outright rather than counted.
 *
 * Pure: no imports beyond the role vocabulary, no IO, no clock.
 */
import {
  noPrimaryEvidence, roleFromAssetName, roleFromPropertyCover, secondaryRole,
  type SourceImageRoleAssignment,
} from './sourceImageRole.pure.ts';

/** What made a page the property's cover. Recorded, never inferred. */
export interface PropertyCoverEvidence {
  /** 1-based, the way a person counts pages. */
  page: number;
  /** The property identity the page stated. */
  identity: string;
  /** The package facts it stated alongside. */
  packageFacts: string[];
}

/**
 * Package information a property's own cover states.
 *
 * Each is a fact about the DEAL rather than about the building, which is what
 * separates a package cover from a floorplan page that repeats the lot number
 * and from a gallery page that repeats the address.
 */
const PACKAGE_FACTS: ReadonlyArray<readonly [string, RegExp]> = [
  ['a package price', /(?:\$|aud\s*)\s?\d{1,3}(?:[, ]\d{3})+(?:\.\d{2})?/i],
  ['a contract or package heading', /\b(fixed\s*price\s*contract|price\s*contract|house\s*(?:and|&|\+)\s*land|package|single\s*contract|two\s*part\s*contract|turnkey|build\s*contract|hia\s*contract)\b/i],
  ['a land or build size', /\b(land\s*size|build\s*size|lot\s*size|house\s*size|floor\s*area|\d{2,4}\s*m\s*2|\d{2,4}\s*sqm)\b/i],
  ['a bedroom/bathroom/car configuration', /\b\d\s*(bed|bedroom|bath|bathroom|car|garage)s?\b/i],
  ['a title or completion date', /\b(title\s*reg|titled|registration|est(?:imated)?\.?\s*completion|handover)\b/i],
  ['a lot dimension', /\b(lot\s*width|lot\s*length|frontage)\b/i],
];

/** Tokens of a label, in order, punctuation and case removed. */
function tokenise(value: string): string[] {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length > 0);
}

/**
 * How much of the property's label a page must repeat to be naming it.
 *
 * The same set-matching `pdfRowAnchors.pure.ts` uses and for the same reason: a
 * PDF breaks lines wherever the layout did, so "Lot 537 Kirramingly Avenue,
 * Donnybrook" arrives as three fragments. Requiring several tokens keeps
 * "Lot 5" from matching every page that mentions a five.
 */
const MIN_IDENTITY_TOKENS = 2;
const MAX_IDENTITY_TOKENS = 8;

function pageStatesIdentity(pageText: string, label: string): boolean {
  const tokens = tokenise(label).slice(0, MAX_IDENTITY_TOKENS);
  if (tokens.length < MIN_IDENTITY_TOKENS) return false;
  const haystack = ` ${tokenise(pageText).join(' ')} `;
  return tokens.every((token) => haystack.includes(` ${token} `));
}

/** The package facts a page states, in the order they are defined above. */
export function packageFactsOn(pageText: string): string[] {
  const text = String(pageText ?? '');
  const found: string[] = [];
  for (const [name, pattern] of PACKAGE_FACTS) {
    if (pattern.test(text)) found.push(name);
  }
  return found;
}

/** How many package facts a cover must state. One is a coincidence. */
const MIN_PACKAGE_FACTS = 2;

/**
 * The page (or pages) that present this property as a package.
 *
 * `pageTexts[i]` is the text of visible page `i + 1`. More than one match is
 * returned rather than resolved, because a document that presents the same
 * property twice has not told us which presentation is its cover — and the
 * caller's answer to that is no primary image.
 */
export function findPropertyCoverPages(
  pageTexts: string[],
  label: string | null | undefined,
): PropertyCoverEvidence[] {
  const identity = String(label ?? '').trim();
  if (!identity) return [];

  const covers: PropertyCoverEvidence[] = [];
  (pageTexts ?? []).forEach((text, index) => {
    if (!pageStatesIdentity(text ?? '', identity)) return;
    const packageFacts = packageFactsOn(text ?? '');
    if (packageFacts.length < MIN_PACKAGE_FACTS) return;
    covers.push({ page: index + 1, identity, packageFacts });
  });
  return covers;
}

// ---------------------------------------------------------------------------
// Which picture on that page is the hero
// ---------------------------------------------------------------------------

/** A candidate picture, reduced to what this decision is allowed to see. */
export interface CoverCandidate {
  /** Identifies the raster within the document. */
  key: string;
  /** How many times the cover page draws it. */
  placementsOnPage: number;
  /** How many pages of the document draw it at all. */
  pagesDrawnOn: number;
}

export type CoverHeroOutcome =
  | { kind: 'hero'; key: string; reason: string }
  | { kind: 'none'; reason: string };

/**
 * The one picture on a property's cover page that is its hero.
 *
 * REPETITION IS THE ONLY THING THAT ELIMINATES, and it eliminates by what the
 * document did rather than by what the picture looks like. A raster the cover
 * draws twice, or that a second page also draws, is the design's furniture: on
 * the Lot 537 cover that is the grey faceted wash, placed three times, which
 * every size and encoding rule admits and which is bigger on the page than the
 * facade it sits behind.
 *
 * What survives has to be exactly one. Two surviving photographs on a cover is
 * a page presenting a choice, and this does not make choices — see LEVEL 4.
 */
export function selectCoverHero(candidates: CoverCandidate[]): CoverHeroOutcome {
  const all = candidates ?? [];
  if (!all.length) {
    return { kind: 'none', reason: 'the property cover page presents no photograph' };
  }

  const unique = all.filter(
    (candidate) => candidate.placementsOnPage <= 1 && candidate.pagesDrawnOn <= 1,
  );
  if (unique.length === 1) {
    const dropped = all.length - unique.length;
    return {
      kind: 'hero',
      key: unique[0].key,
      reason: dropped
        ? `the only photograph the property cover presents once; ${dropped} other `
          + 'raster(s) on that page are repeated artwork the document reuses'
        : 'the only photograph the property cover presents',
    };
  }
  if (!unique.length) {
    return {
      kind: 'none',
      reason: 'every photograph on the property cover is artwork the document repeats, '
        + 'so none of them is this property\'s own image',
    };
  }
  return {
    kind: 'none',
    reason: `the property cover presents ${unique.length} photographs and does not say `
      + 'which is the property\'s, so none is used',
  };
}

// ---------------------------------------------------------------------------
// The one decision, for every caller
// ---------------------------------------------------------------------------

/** One discovered picture, reduced to what the source said about where it sits. */
export interface PdfMediaPlacement {
  /** 1-based, the page a person sees. */
  page: number;
  /** The resource/file name the document gave it, when it gave one. */
  name: string | null;
  /** How many times its own page draws it. */
  placementsOnPage: number;
  /** How many pages of the document draw it. */
  pagesDrawnOn: number;
}

/**
 * The role of EVERY picture found in one PDF, index-aligned with the input.
 *
 * ONE implementation, three callers — a PDF uploaded straight into the portal,
 * the same PDF re-read by a repair, and a package PDF reached through a stock
 * row's own link. They must not be able to disagree about which picture is a
 * property's hero, which is exactly the class of drift that produced two
 * competing brochure readers in the first place.
 *
 * At most ONE assignment comes back as `primary_property`, and only when the
 * document said so.
 */
export function assignPdfMediaRoles(input: {
  label: string | null | undefined;
  pageTexts: string[];
  pageOrderAuthoritative: boolean;
  media: PdfMediaPlacement[];
}): SourceImageRoleAssignment[] {
  const media = input.media ?? [];
  const covers = input.pageOrderAuthoritative
    ? findPropertyCoverPages(input.pageTexts ?? [], input.label)
    : [];
  const cover = covers.length === 1 ? covers[0] : null;

  const onCover = cover
    ? media
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.page === cover.page)
    : [];

  const outcome = cover
    ? selectCoverHero(onCover.map(({ entry, index }) => ({
      key: String(index),
      placementsOnPage: entry.placementsOnPage,
      pagesDrawnOn: entry.pagesDrawnOn,
    })))
    : null;

  const heroIndex = outcome?.kind === 'hero' ? Number(outcome.key) : -1;

  // Why nothing is primary, said once and in the source's own terms, so the
  // stored record explains itself without anybody re-running the import.
  const refusal = !input.pageOrderAuthoritative
    ? 'the document\'s own page order could not be established, so no page can be read as '
      + 'this property\'s cover'
    : !(input.pageTexts ?? []).length
      ? 'the document\'s text could not be read, so no page can be read as this property\'s cover'
      : !String(input.label ?? '').trim()
        ? 'the property has no label for a page to state, so no page can be read as its cover'
        : covers.length > 1
          ? `${covers.length} pages present this property as a package and the document does `
            + 'not say which is its cover'
          : !covers.length
            ? 'no page states this property\'s identity together with its package information'
            : outcome?.kind === 'none'
              ? outcome.reason
              : 'the source does not designate a primary image for this property';

  return media.map((entry, index) => {
    /**
     * A name the builder chose may DEMOTE and never promote. `Masterplan.png`
     * is not a house whatever page it sits on; `6.png` is a perfectly ordinary
     * name for a facade render, so a hero word in a filename proves nothing
     * about which property it belongs to or what the source presented it as.
     */
    const named = roleFromAssetName(entry.name);
    if (named) {
      return secondaryRole(named, `the source names this image "${entry.name}"`);
    }
    if (index === heroIndex && cover) {
      return roleFromPropertyCover({
        where: `visible page ${cover.page}`,
        identity: cover.identity,
        packageFacts: cover.packageFacts,
      });
    }
    return noPrimaryEvidence(refusal);
  });
}

/**
 * The same decision for a document that produced SEVERAL properties.
 *
 * Each property is judged against the pages attributed to it and against its
 * own label, so a stock PDF listing twelve lots resolves twelve covers rather
 * than one — and a picture the document tied to nobody stays tied to nobody.
 *
 * Index-aligned with `media`, like everything else on this path, because the
 * caller writes one storage row per entry and a misalignment here would put one
 * property's evidence on another property's picture.
 */
export function assignPdfMediaRolesPerProperty(input: {
  media: Array<{ name: string; placement?: PdfMediaPlacement | null }>;
  /** The property each picture reached, index-aligned. Null is unattributed. */
  stockItemIds: Array<string | null>;
  labelByItemId: Map<string, string>;
  pageTexts: string[];
  pageOrderAuthoritative: boolean;
}): SourceImageRoleAssignment[] {
  const media = input.media ?? [];
  const out: SourceImageRoleAssignment[] = media.map(() => noPrimaryEvidence(
    'the source did not tie this image to a property, so it is kept against the upload '
    + 'and shown against nobody'));

  const byProperty = new Map<string, number[]>();
  media.forEach((_, index) => {
    const itemId = input.stockItemIds[index];
    if (!itemId) return;
    const bucket = byProperty.get(itemId) ?? [];
    bucket.push(index);
    byProperty.set(itemId, bucket);
  });

  for (const [itemId, indexes] of byProperty) {
    const assignments = assignPdfMediaRoles({
      label: input.labelByItemId.get(itemId) ?? null,
      pageTexts: input.pageTexts,
      pageOrderAuthoritative: input.pageOrderAuthoritative,
      media: indexes.map((index) => media[index].placement ?? {
        // A picture with no placement was not read by the page reader, so
        // nothing is known about where the document put it.
        page: 0, name: media[index].name, placementsOnPage: 2, pagesDrawnOn: 2,
      }),
    });
    indexes.forEach((index, position) => { out[index] = assignments[position]; });
  }
  return out;
}
