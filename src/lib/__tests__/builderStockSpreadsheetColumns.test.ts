/**
 * Builder Stock — what a stock list SAYS, and the two ways this read it wrong.
 *
 * Measured on the one source live in production: twenty-six published
 * properties, each showing a 428,000 m2 block, no price, no house size, no
 * design, and no document. The spreadsheet behind them states every one of
 * those things. Two defects, both in reading a column heading, and each of
 * them silent.
 *
 *   THE UNIT MARKER WAS DELETED. `normaliseHeader` stripped everything that is
 *   not a letter or a digit, so `LAND $` and `LAND M2` both became `land` —
 *   and `land` is an alias for `land_size_sqm`. Every property imported from a
 *   sheet with both columns had its land PRICE written into its land SIZE:
 *   $428,000 published as a 428,000 m2 block, which is 105 acres. The same
 *   collapse hid `HOUSE $` behind `HOUSE`, and `PACKAGE $` — the number a
 *   buyer is actually quoted — behind `PACKAGE`, which is why not one of the
 *   twenty-six carried a price at all.
 *
 *   THE LINK TARGETS WERE NEVER READ. An uploaded workbook was read with
 *   `sheet_to_json`, which returns what a cell DISPLAYS. A brochure column
 *   displays the word "Brochure" and carries its address as a hyperlink, so
 *   thirteen of the twenty-six reached the image pipeline with no source at
 *   all. The reader that does see targets has been in this repository the
 *   whole time and ran only for a Google Sheets URL — which fetches
 *   `…/export?format=xlsx` to obtain a workbook an upload was already holding.
 *
 * Both are read here against the real column set of a real stock list, because
 * the class of defect is invisible to a fixture written by the same hand as
 * the parser: every heading below is one a builder actually shipped.
 */
import { describe, expect, it } from 'vitest';

import {
  normaliseHeader, normaliseStockRow,
} from '../../../supabase/functions/_shared/builderStock/normalise.pure';
import {
  attachRowHyperlinks, LINK_COLUMN_SUFFIX,
} from '../../../supabase/functions/_shared/builderStock/sheetHyperlinks.pure';
import {
  rowSourceBranches,
} from '../../../supabase/functions/_shared/builderStock/sourceBranches.pure';

/** The heading row of a live house-and-land stock list, verbatim. */
const HEADERS = [
  'ESTATE', 'REGION', 'LOT No', 'SUBURB', 'TITLES', 'LAND M2', 'LAND $', 'HOUSE',
  'FACADE', 'Bed', 'Living', 'Bath', 'Car', 'HOUSE m2', 'HOUSE $', 'PACKAGE $',
  'STATUS', 'DOWNLOAD', 'NOTES',
];

/** One of its rows, verbatim, with the money written the way the sheet writes it. */
const ROW: Record<string, unknown> = {
  ESTATE: 'Winterset Lodge', REGION: 'West', 'LOT No': '231', SUBURB: 'Manor Lakes',
  TITLES: 'Titled', 'LAND M2': '501', 'LAND $': '$405,100', HOUSE: 'Urban 19',
  FACADE: 'Lucia', Bed: '4', Living: '1', Bath: '2', Car: '2',
  'HOUSE m2': '174.65', 'HOUSE $': '$371,000', 'PACKAGE $': '$776,100',
  STATUS: 'Available', DOWNLOAD: 'Brochure', NOTES: '',
};

describe('a unit marker is part of a heading, not punctuation to be stripped', () => {
  it('KEEPS MONEY AND MEASURE APART — the defect that published a 105-acre block', () => {
    expect(normaliseHeader('LAND M2')).not.toBe(normaliseHeader('LAND $'));
    expect(normaliseHeader('HOUSE')).not.toBe(normaliseHeader('HOUSE $'));
    expect(normaliseHeader('HOUSE')).not.toBe(normaliseHeader('HOUSE m2'));
    expect(normaliseHeader('PACKAGE')).not.toBe(normaliseHeader('PACKAGE $'));
    // A percentage is the same shape of mistake and is separated for the same
    // reason, before a `Deposit %` column is silently read as a deposit.
    expect(normaliseHeader('Deposit')).not.toBe(normaliseHeader('Deposit %'));
  });

  it('and still reads a heading however it is spaced, cased or punctuated', () => {
    for (const [a, b] of [
      ['Land Size (m2)', 'land_size_m2'],
      ['LANDSIZEM2', 'Land Size M2'],
      ['Package $', 'PACKAGE  $'],
      ['price $', 'Price $'],
    ]) {
      expect(normaliseHeader(a)).toBe(normaliseHeader(b));
    }
  });

  it('reads every column of a real stock list to the field it means', () => {
    const record = normaliseStockRow(ROW);
    expect(record).not.toBeNull();

    // The land is 501 square metres. It is NOT 405,100.
    expect(record!.land_size_sqm).toBe(501);
    expect(record!.building_size_sqm).toBeCloseTo(174.65, 2);
    // The price is the PACKAGE — what the buyer pays — never a component of it.
    expect(record!.price).toBe(776100);
    // `HOUSE` was unmappable while `HOUSE $` produced the same key: whichever
    // column came last would have written "$371,000" into the design.
    expect(record!.house_design).toBe('Urban 19');
    // And it is `house` alone. `Product`, `Type` and `House Type` answer a
    // different question and belong to `property_type`; a separate test in
    // builderStockDesignEvidence pins that, and this one would notice a
    // heading that answered both.
    expect(normaliseStockRow({ 'LOT No': '1', 'House Type': 'house' })!.house_design)
      .toBeNull();
    expect(record!.development_name).toBe('Winterset Lodge');
    expect(record!.lot_number).toBe('231');
    expect(record!.bedrooms).toBe(4);
    expect(record!.bathrooms).toBe(2);
    expect(record!.car_spaces).toBe(2);
  });

  it('THE BREAKDOWN IS NOT THE PRICE — the components stay out of the fields', () => {
    const record = normaliseStockRow(ROW)!;
    // A card showing the house component as the price understates a $776,100
    // package by $405,100, so neither component is mapped anywhere.
    expect(record.price).not.toBe(405100);
    expect(record.price).not.toBe(371000);
    expect(record.land_size_sqm).not.toBe(405100);
    expect(record.building_size_sqm).not.toBe(371000);
    // They are kept, visibly, where an operator can see what the sheet said.
    expect(record.unmapped['LAND $']).toBe('$405,100');
    expect(record.unmapped['HOUSE $']).toBe('$371,000');
  });

  it('a sheet with only one money column is unaffected', () => {
    // The overwhelming majority: one `Price` column and no `$` anywhere.
    const plain = normaliseStockRow({
      'Lot Number': '7', Suburb: 'Werribee', Price: '$650,000',
      'Land Size': '400', 'Building Size': '180',
    });
    expect(plain).not.toBeNull();
    expect(plain!.price).toBe(650000);
    expect(plain!.land_size_sqm).toBe(400);
    expect(plain!.building_size_sqm).toBe(180);
  });
});

describe('an uploaded workbook keeps the addresses its cells point at', () => {
  const BROCHURE = 'https://example.invalid/docs/Lot-231-Winterset-Lodge.pdf';

  /** Two kept rows, at sheet rows 2 and 4 — a banner and a blank in between. */
  function keyed() {
    return {
      headers: HEADERS,
      rowIndexes: [2, 4],
      rows: [
        { ...ROW },
        { ...ROW, 'LOT No': '516', DOWNLOAD: 'Brochure' },
      ] as Array<Record<string, unknown>>,
      links: [
        HEADERS.map(() => null),
        HEADERS.map(() => null),
        HEADERS.map((_h, c) => (c === 17 ? BROCHURE : null)),
        HEADERS.map(() => null),
        HEADERS.map((_h, c) => (c === 17 ? `${BROCHURE}?two` : null)),
      ] as Array<Array<string | null>>,
    };
  }

  it('attaches each row\'s own target, under the same name the other path uses', () => {
    const input = keyed();
    const result = attachRowHyperlinks(input);

    expect(result.columnsAdded).toEqual([`DOWNLOAD${LINK_COLUMN_SUFFIX}`]);
    expect(result.linksResolved).toBe(2);
    // Row-by-row, taken from the sheet row each kept row actually came from —
    // `position + 1` was never that row, because a banner or a blank line
    // shifts every property below it onto the next one's document.
    expect(input.rows[0]['DOWNLOAD URL']).toBe(BROCHURE);
    expect(input.rows[1]['DOWNLOAD URL']).toBe(`${BROCHURE}?two`);
  });

  it('and the brochure then reaches the image pipeline as an ordinary column', () => {
    const input = keyed();
    attachRowHyperlinks(input);
    const record = normaliseStockRow(input.rows[0])!;
    // `DOWNLOAD URL` is not a heading this product knows, so it lands in
    // `unmapped` — which is exactly where `rowSourceBranches` reads addresses.
    // Nothing downstream had to be taught anything.
    expect(record.unmapped['DOWNLOAD URL']).toBe(BROCHURE);
    const branches = rowSourceBranches(record.unmapped);
    expect(branches).toHaveLength(1);
    expect(branches[0]).toMatchObject({ url: BROCHURE, kind: 'document' });
  });

  it('adds nothing at all to a sheet whose cells point nowhere', () => {
    const input = keyed();
    input.links = input.links.map((row) => row.map(() => null));
    const result = attachRowHyperlinks(input);
    expect(result).toEqual({ columnsAdded: [], linksResolved: 0 });
    expect(Object.keys(input.rows[0])).toEqual(Object.keys(ROW));
  });

  it('gives a row with no target a blank rather than no column', () => {
    const input = keyed();
    input.links[4] = HEADERS.map(() => null);
    const result = attachRowHyperlinks(input);
    expect(result.linksResolved).toBe(1);
    // Every row has the same shape, so a missing document is a blank cell
    // rather than a column that is not there.
    expect(input.rows[1]['DOWNLOAD URL']).toBe('');
    // And a blank cell says nothing, so it reaches `unmapped` as nothing and
    // the row owns no source — which is the honest reading of a property whose
    // builder did not attach a document.
    const record = normaliseStockRow(input.rows[1])!;
    expect(record.unmapped['DOWNLOAD URL']).toBeUndefined();
    expect(rowSourceBranches(record.unmapped)).toEqual([]);
  });

  it('NEVER OVERWRITES a column the builder wrote themselves', () => {
    const mine = 'https://example.invalid/mine.pdf';
    const input = keyed();
    input.headers = [...HEADERS, 'DOWNLOAD URL'];
    input.rows = input.rows.map((row) => ({ ...row, 'DOWNLOAD URL': mine }));
    const result = attachRowHyperlinks(input);
    expect(result.columnsAdded).toEqual([]);
    expect(input.rows[0]['DOWNLOAD URL']).toBe(mine);
  });
});
