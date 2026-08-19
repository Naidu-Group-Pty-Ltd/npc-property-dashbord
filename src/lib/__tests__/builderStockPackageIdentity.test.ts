/**
 * Builder stock — whether a package page is naming THIS property.
 *
 * THE DEFECT THESE PIN. Fifty of the seventy-one live Builder Stock cards show
 * no image. Every one of those rows links a "Complete Package Pack" Drive
 * folder, and for twenty-five of them that folder contains a per-property PDF
 * whose FIRST PAGE is a hero facade under the property's own name and price.
 * The pipeline read those documents, found the right file, and then refused the
 * page — because the rule was "the page must repeat every one of the label's
 * first eight tokens", and the two documents word the address differently:
 *
 *   the stock list   Lot 51 - Tringa Street, Sandpiper Estate,
 *                    Tweed Heads South NSW 2486 [Miami 190]
 *   the builder      Lot 51, Sandpiper Estate, Tweed Heads NSW ·
 *                    Miami 190, Spectral façade
 *
 * The cover names the lot, the estate, the suburb, the state and the design. It
 * does not name the street, and it writes "Tweed Heads" for "Tweed Heads
 * South". `tringa` and `street` are absent, the conjunction fails, and a
 * document that could not identify the property more plainly is discarded.
 *
 * AND WHY RELAXING IT IS DANGEROUS, which is the other half of these tests.
 * Lot 51 carries SEVEN stock rows — Miami 190, Miami 196, Stradbroke 180,
 * Stradbroke 197, Bishop 258, Bravo 217, Echo 236 — at one address, on one lot,
 * differing only by design. Lot 52 carries the same seven. Any rule loose
 * enough to match "Tweed Heads NSW" against "Tweed Heads South NSW 2486" must
 * still be tight enough that fourteen near-identical labels each match exactly
 * one document. The cross-product below is that assertion.
 *
 * The page text is the real extraction from the real files. See the fixture.
 */
import { describe, expect, it } from 'vitest';

import {
  findPropertyCoverPages, packageFactsOn,
} from '../../../supabase/functions/_shared/builderStock/pdfPrimaryImage.pure';
import {
  COVELLA_ADDRESS, COVELLA_LOT_914_PAGE_1, LOT_51_MIAMI_190_PAGE_1,
  LOT_51_MIAMI_196_PAGE_1, LOT_52_MIAMI_190_PAGE_1, SANDPIPER_ADDRESS,
} from './fixtures/builderStockPackagePages';

/** The label the repair builds for a Sandpiper row, exactly as production does. */
const sandpiper = (lot: number, design: string) =>
  `Lot ${lot} - ${SANDPIPER_ADDRESS} [${design}]`;

describe('a builder package cover names its property', () => {
  it('accepts the cover of the property it is FOR', () => {
    const covers = findPropertyCoverPages(
      [LOT_51_MIAMI_190_PAGE_1], sandpiper(51, 'Miami 190'));
    expect(covers).toHaveLength(1);
    expect(covers[0].page).toBe(1);
    // And it is a package page, not a floorplan that happens to repeat the lot.
    expect(covers[0].packageFacts.length).toBeGreaterThanOrEqual(2);
  });

  it('does not need the street the builder never wrote down', () => {
    // The whole defect in one assertion: `tringa` and `street` are in the
    // label and in no part of the builder's own cover for that house.
    const page = LOT_51_MIAMI_190_PAGE_1.toLowerCase();
    expect(page).not.toContain('tringa');
    expect(page).not.toContain('2486');
    expect(findPropertyCoverPages([LOT_51_MIAMI_190_PAGE_1], sandpiper(51, 'Miami 190')))
      .toHaveLength(1);
  });

  it('reads a package price and a package heading off that page', () => {
    expect(packageFactsOn(LOT_51_MIAMI_190_PAGE_1)).toContain('a package price');
  });
});

describe('and cannot be confused with the property next to it', () => {
  /*
   * THE CROSS-PRODUCT. Rows down, documents across; every cell is the number of
   * cover pages the rule matched. Anything other than an identity matrix is a
   * client being shown another property's house.
   */
  const documents: Array<[string, string]> = [
    ['Lot 51 · Miami 190', LOT_51_MIAMI_190_PAGE_1],
    ['Lot 51 · Miami 196', LOT_51_MIAMI_196_PAGE_1],
    ['Lot 52 · Miami 190', LOT_52_MIAMI_190_PAGE_1],
  ];
  const labels: Array<[string, string]> = [
    ['Lot 51 · Miami 190', sandpiper(51, 'Miami 190')],
    ['Lot 51 · Miami 196', sandpiper(51, 'Miami 196')],
    ['Lot 52 · Miami 190', sandpiper(52, 'Miami 190')],
  ];

  for (const [labelName, label] of labels) {
    for (const [documentName, page] of documents) {
      const expected = labelName === documentName ? 1 : 0;
      it(`${labelName} ${expected ? 'matches' : 'does NOT match'} ${documentName}`, () => {
        expect(findPropertyCoverPages([page], label)).toHaveLength(expected);
      });
    }
  }

  it('refuses a design none of those documents is for', () => {
    for (const [, page] of documents) {
      expect(findPropertyCoverPages([page], sandpiper(51, 'Stradbroke 180'))).toHaveLength(0);
    }
  });

  it('refuses a lot the page does not designate at all', () => {
    expect(findPropertyCoverPages([LOT_51_MIAMI_190_PAGE_1], sandpiper(99, 'Miami 190')))
      .toHaveLength(0);
  });

  it('refuses a bare lot number with nothing else in common', () => {
    // Corroboration is required: "Lot 51" alone, from another estate entirely,
    // must not collect Sandpiper's cover.
    expect(findPropertyCoverPages(
      [LOT_51_MIAMI_190_PAGE_1], 'Lot 51 - Wattle Grove, Chisholm VIC 3064'))
      .toHaveLength(0);
  });

  it('refuses a page that designates a DIFFERENT lot as well', () => {
    // A stocklist page listing several lots identifies none of them as its
    // subject. The contradiction test is what makes the relaxation safe.
    const twoLots = `${LOT_51_MIAMI_190_PAGE_1}\nLot 52, Sandpiper Estate — $1,401,306`;
    expect(findPropertyCoverPages([twoLots], sandpiper(51, 'Miami 190'))).toHaveLength(0);
  });
});

describe('a label with no lot number keeps the old conjunction', () => {
  it('still requires every token, because it has no discriminator', () => {
    const page = 'Riverbend Estate, Werribee VIC · house and land package · $700,000 · 4 bed';
    expect(findPropertyCoverPages([page], 'Riverbend Estate, Werribee VIC')).toHaveLength(1);
    // One token absent and it is refused, exactly as before.
    expect(findPropertyCoverPages([page], 'Riverbend Estate, Tarneit VIC')).toHaveLength(0);
  });
});

describe('a document that could not be read is not a document that said nothing', () => {
  it('the Covella brochure yields no text at all', () => {
    /*
     * Three pages of designed brochure exported as images. Page 1 carries the
     * lot, the estate, the suburb, the price, both sizes and the facade render
     * — all drawn. Extraction returns nothing, and NOTHING is what a reader
     * that read nothing has learned. `recoverPackageImage` returns
     * `unreachable` for this, so the property is asked again rather than being
     * banked as "the builder supplied no image".
     */
    expect(COVELLA_LOT_914_PAGE_1.trim()).toBe('');
    expect(findPropertyCoverPages([COVELLA_LOT_914_PAGE_1], COVELLA_ADDRESS)).toHaveLength(0);
  });
});
