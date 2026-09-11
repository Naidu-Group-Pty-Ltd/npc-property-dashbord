/**
 * Builder stock — an uploaded package was held to a stricter standard than a
 * linked one, for no reason anybody chose.
 *
 * MEASURED 11 SEPTEMBER 2026 on `LOT 27 - ZIMI - FLYER.pdf`, a fresh upload
 * that had never been sent before. One property, a large facade render on the
 * cover, and no picture on the card. The refusal the pipeline recorded — and
 * now quotes — was:
 *
 *   no page states this property's identity together with its package
 *   information — its first page reads "Lot 27 — LOT 32, 33, 34,"
 *
 * TWO THINGS WERE WRONG AND BOTH WERE WIRING.
 *
 * 1. THE UPLOAD PATH PASSED NO IDENTITY HINTS. The imported row carries
 *    `development_name: "HAVENWOOD"` and the flyer prints HAVENWOOD across the
 *    top, but the row's LABEL is "Lot 27, 49 Cockrell Rd, Mernda" — a street
 *    the document never mentions. `pageStatesIdentity` test 4 wants one
 *    corroborating token, `stockIdentityHints` exists to supply the estate,
 *    and the LINKED-document path has passed it since the Watsons Reach fix.
 *    `repairPdfUpload` and the importer's own `paginated` block passed only
 *    the label. Same for `house_design`, which feeds the design-cover rung:
 *    the linked path passes it, the upload path did not, so an uploaded
 *    package could not reach that rung at all.
 *
 * 2. THE OTHER-LOT VETO DOES NOT BELONG TO A ONE-PROPERTY DOCUMENT. Test 2 of
 *    `pageStatesIdentity` refuses a page naming any lot but ours, and for a
 *    stock list of twelve lots that is exactly right — two lots on one page is
 *    the document declining to say whose page it is, and a guess puts somebody
 *    else's house on a client's card. This flyer names lots 32, 33 and 34
 *    beside lot 27 because the estate's site plan is printed on it. With ONE
 *    property in the document there is no other property to mis-attribute to,
 *    so a second lot number is context rather than a competitor.
 *
 * Same principle, same document shape, as the sole-property branch of
 * `anchorPdfRowsToPages`. A multi-property document is untouched.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assignPdfMediaRoles, findPropertyCoverPages,
} from '../../../supabase/functions/_shared/builderStock/pdfPrimaryImage.pure';
import {
  anchorPdfRowsToPages,
} from '../../../supabase/functions/_shared/builderStock/pdfRowAnchors.pure';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');
const IMPORT = read('supabase/functions/_shared/builderStock/importStock.ts');
const REPAIR = read('supabase/functions/_shared/builderStock/repairSourceImages.ts');

/** Page 1 of the flyer, from what production recorded plus the printed figures. */
const FLYER = [
  'HAVENWOOD',
  'Lot 27',
  'Zimi',
  'Sale Price - $699,000',
  'Land Size - 143sqm',
  'Build Size - 180sqm',
  'Turn-Key Inclusions, Front and rear landscaping, driveway + fencing',
  'LOT 32, 33, 34',
].join('\n');
const PAGES = [FLYER, 'Inclusions'];

/** The label the model's extraction produced — a street the flyer never names. */
const LABEL = 'Lot 27, 49 Cockrell Rd, Mernda';
/** What `stockIdentityHints` returns for that row. */
const HINTS = ['HAVENWOOD'];

describe('why the flyer was refused', () => {
  it('the label alone matches nothing on the page', () => {
    expect(findPropertyCoverPages(PAGES, LABEL)).toHaveLength(0);
  });

  it('and the estate hint alone is not enough — the other lots still veto', () => {
    // This is the part a hints-only fix would have missed.
    expect(findPropertyCoverPages(PAGES, LABEL, HINTS)).toHaveLength(0);
  });
});

describe('a one-property document is read the way it is written', () => {
  it('finds the cover with the estate hint and the sole-property rule', () => {
    const covers = findPropertyCoverPages(PAGES, LABEL, HINTS, true);
    expect(covers).toHaveLength(1);
    expect(covers[0].page).toBe(1);
  });

  it('elects the render on it', () => {
    const [role] = assignPdfMediaRoles({
      label: LABEL,
      identityHints: HINTS,
      soleProperty: true,
      pageTexts: PAGES,
      pageOrderAuthoritative: true,
      media: [{ name: 'Im0', page: 1, placementsOnPage: 1, pagesDrawnOn: [1], pageAreaShare: 0.39 }],
    } as never);
    expect(role.role).toBe('primary_property');
  });

  it('and refuses it without the rule, which is the before picture', () => {
    const [role] = assignPdfMediaRoles({
      label: LABEL,
      identityHints: HINTS,
      pageTexts: PAGES,
      pageOrderAuthoritative: true,
      media: [{ name: 'Im0', page: 1, placementsOnPage: 1, pagesDrawnOn: [1], pageAreaShare: 0.39 }],
    } as never);
    expect(role.role).not.toBe('primary_property');
  });

  it('anchors the row to the page carrying the render', () => {
    expect(anchorPdfRowsToPages([LABEL], PAGES, [1], true, [HINTS])).toEqual(['pdf:page1']);
  });
});

describe('a MULTI-property document is untouched', () => {
  it('still refuses a page that names another lot', () => {
    expect(findPropertyCoverPages(PAGES, LABEL, HINTS, false)).toHaveLength(0);
  });

  it('and the veto is what does it, not the hints', () => {
    // The same page with no foreign lot on it IS accepted under multi rules,
    // so the refusal above is the other-lot test and nothing else.
    const clean = [FLYER.replace('LOT 32, 33, 34', ''), 'Inclusions'];
    expect(findPropertyCoverPages(clean, LABEL, HINTS, false)).toHaveLength(1);
  });

  it('two rows in one document never get the sole-property relaxation', () => {
    const anchors = anchorPdfRowsToPages(
      [LABEL, 'Lot 32, Other Street, Mernda'], PAGES, [1], true, [HINTS, []]);
    // Neither row may claim page 1 on a document that names several lots.
    expect(anchors[0]).toBeNull();
  });
});

describe('the wiring, so this cascades to every future upload', () => {
  it('the importer passes the estate hints, the design and the count', () => {
    expect(IMPORT).toContain('identityHintsByItemId,');
    expect(IMPORT).toContain('designByItemId,');
    expect(IMPORT).toContain('soleProperty: records.length === 1,');
  });

  it('and builds the design map from the row itself', () => {
    expect(IMPORT).toContain('designByItemId.set(itemId, record.house_design ?? null)');
  });

  it('the repair path passes the same three', () => {
    expect(REPAIR).toContain('identityHints = existing.map((item) => stockIdentityHints(recordOf(item)))');
    expect(REPAIR).toContain('const soleProperty = existing.length === 1;');
    expect(REPAIR).toContain('designByItemId: new Map(');
  });

  it('and hands the hints to the anchor rule too, not only to the roles', () => {
    expect(REPAIR).toContain(
      'anchorPdfRowsToPages(\n    labels, input.pageTexts, photoPages, input.pageOrderAuthoritative, identityHints)');
  });
});
