/**
 * Builder stock normalisation — the rules that must not drift.
 *
 * These tests exist for one class of defect: a stock list that imports as
 * something the file did not say. Every case below is a value the pipeline
 * could plausibly invent — a price it rounded, a status it assumed, two
 * properties it merged — and the assertion is that it does not.
 */
import { describe, expect, it } from 'vitest';
import {
  coerceAvailability, coerceNumber, coercePrice, coercePropertyType, coerceState,
  fieldForHeader, geocodableAddress, identifiesAProperty, normaliseStockRow,
  stockMatchKeys,
} from '../../../supabase/functions/_shared/builderStock/normalise.pure';
import {
  keyRowsByHeader, parseDelimited,
} from '../../../supabase/functions/_shared/builderStock/table.pure';
import {
  classifyStockFile, isAcceptableStockStoragePath, safeObjectName,
  stockFileAcceptAttribute,
} from '../../../supabase/functions/_shared/builderStock/fileTypes.pure';

describe('header aliasing', () => {
  it('ignores case, spacing and punctuation', () => {
    expect(fieldForHeader('Land Size (m2)')).toBe('land_size_sqm');
    expect(fieldForHeader('land_size_m2')).toBe('land_size_sqm');
    expect(fieldForHeader('LANDSIZEM2')).toBe('land_size_sqm');
  });

  it('recognises its own canonical names, which is what a model returns', () => {
    expect(fieldForHeader('building_size_sqm')).toBe('building_size_sqm');
    expect(fieldForHeader('external_reference')).toBe('external_reference');
    expect(fieldForHeader('availability_status')).toBe('availability_status');
  });

  it('returns null for a heading it does not know rather than guessing', () => {
    expect(fieldForHeader('Deposit Required')).toBeNull();
    expect(fieldForHeader('Commission %')).toBeNull();
  });
});

describe('coercion never invents', () => {
  it('keeps the wording of a price that is not a bare number', () => {
    expect(coercePrice('From $749,000')).toEqual({ price: 749000, display: 'From $749,000' });
    expect(coercePrice('$749,000')).toEqual({ price: 749000, display: null });
    expect(coercePrice('POA')).toEqual({ price: null, display: 'POA' });
  });

  it('reads a number out of a messy cell', () => {
    expect(coerceNumber('$1,250,000')).toBe(1250000);
    expect(coerceNumber('3.5')).toBe(3.5);
    expect(coerceNumber('2 + 1')).toBe(2);
    expect(coerceNumber('n/a')).toBeNull();
  });

  it('treats spreadsheet placeholders as silence, not as values', () => {
    const record = normaliseStockRow({ Address: '12 Wattle St', Suburb: 'N/A', Price: '-' });
    expect(record?.suburb).toBeNull();
    expect(record?.price).toBeNull();
  });

  it('defaults availability to unknown rather than to available', () => {
    expect(coerceAvailability('')).toBe('unknown');
    expect(coerceAvailability('Held pending finance')).toBe('on_hold');
    expect(coerceAvailability('SOLD')).toBe('sold');
    expect(coerceAvailability('Released')).toBe('available');
    // A word the table does not know must not become live inventory.
    expect(coerceAvailability('Stage 4 pending council')).toBe('unknown');
  });

  it('normalises states and refuses anything that is not one', () => {
    expect(coerceState('New South Wales')).toBe('NSW');
    expect(coerceState('qld')).toBe('QLD');
    expect(coerceState('Auckland')).toBeNull();
  });

  it('maps property types onto the stored vocabulary', () => {
    expect(coercePropertyType('House & Land Package')).toBe('house_and_land');
    expect(coercePropertyType('Townhome')).toBe('townhouse');
    expect(coercePropertyType('Vacant Land')).toBe('land');
    expect(coercePropertyType('Something else entirely')).toBe('other');
  });

  it('drops an area that is a unit error rather than storing it', () => {
    const record = normaliseStockRow({ Lot: '12', 'Land Size': '4000000' });
    expect(record?.land_size_sqm).toBeNull();
  });
});

describe('rows that are not properties', () => {
  it('drops a totals line', () => {
    expect(normaliseStockRow({ Notes: 'TOTAL', Price: '12,000,000' })).toBeNull();
  });

  it('drops a blank row', () => {
    expect(normaliseStockRow({ Lot: '', Address: '   ' })).toBeNull();
  });

  it('keeps a thin row that still names a property', () => {
    const record = normaliseStockRow({ Lot: '108', Estate: 'Riverbend' });
    expect(record).not.toBeNull();
    expect(identifiesAProperty(record!)).toBe(true);
  });
});

describe('duplicate matching is conservative', () => {
  it('uses the builder reference when there is one', () => {
    const record = normaliseStockRow({ 'Stock Ref': 'RB-108', Suburb: 'Riverbend' })!;
    expect(stockMatchKeys(record).reference).toBe('rb-108');
  });

  it('requires BOTH halves of development + unit', () => {
    const withUnit = normaliseStockRow({ Estate: 'Riverbend', Lot: '108' })!;
    expect(stockMatchKeys(withUnit).developmentUnit)
      .toEqual({ development: 'riverbend', unit: '108' });

    const withoutUnit = normaliseStockRow({ Estate: 'Riverbend', Suburb: 'Tarneit' })!;
    expect(stockMatchKeys(withoutUnit).developmentUnit).toBeNull();
  });

  it('never matches on address alone — two townhouses share one', () => {
    const record = normaliseStockRow({ Address: '12 Wattle St', Suburb: 'Tarneit' })!;
    const keys = stockMatchKeys(record);
    expect(keys.reference).toBeNull();
    expect(keys.developmentUnit).toBeNull();
  });
});

describe('geocodable address', () => {
  it('refuses to hand a suburb alone to a location lookup', () => {
    expect(geocodableAddress({
      address_line: null, suburb: 'Tarneit', state: 'VIC', postcode: '3029',
    })).toBeNull();
  });

  it('builds a full line when there is a street address', () => {
    expect(geocodableAddress({
      address_line: '12 Wattle St', suburb: 'Tarneit', state: 'VIC', postcode: '3029',
    })).toBe('12 Wattle St, Tarneit, VIC, 3029, Australia');
  });
});

describe('delimited parsing', () => {
  it('honours RFC-4180 quoting', () => {
    const rows = parseDelimited('a,b\n"x, y","he said ""hi"""');
    expect(rows).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
  });

  it('sniffs a tab-separated export', () => {
    const rows = parseDelimited('Lot\tPrice\n108\t749000');
    expect(rows[1]).toEqual(['108', '749000']);
  });
});

describe('header row detection', () => {
  it('skips the title rows real stock lists open with', () => {
    const matrix = [
      ['ACME HOMES — STOCK LIST MARCH'],
      [],
      ['Lot', 'Address', 'Suburb', 'Beds', 'Price', 'Status'],
      ['108', '12 Wattle St', 'Tarneit', '4', '$749,000', 'Available'],
    ];
    const keyed = keyRowsByHeader(matrix);
    expect(keyed?.headerRowIndex).toBe(2);
    expect(keyed?.rows).toHaveLength(1);
    expect(keyed?.rows[0].Address).toBe('12 Wattle St');
  });

  it('returns null when nothing looks like a stock table', () => {
    expect(keyRowsByHeader([
      ['Dear Sir or Madam'],
      ['Please find attached our latest release.'],
    ])).toBeNull();
  });

  it('keys a full row end to end', () => {
    const keyed = keyRowsByHeader([
      ['Lot', 'Address', 'Suburb', 'State', 'Postcode', 'Beds', 'Bath', 'Car', 'Land Size (m2)', 'Price', 'Status'],
      ['108', '12 Wattle St', 'Tarneit', 'VIC', '3029', '4', '2', '2', '448', 'From $749,000', 'Available'],
    ])!;
    const record = normaliseStockRow(keyed.rows[0])!;
    expect(record.lot_number).toBe('108');
    expect(record.suburb).toBe('Tarneit');
    expect(record.state).toBe('VIC');
    expect(record.postcode).toBe('3029');
    expect(record.bedrooms).toBe(4);
    expect(record.land_size_sqm).toBe(448);
    expect(record.price).toBe(749000);
    expect(record.price_display).toBe('From $749,000');
    expect(record.availability_status).toBe('available');
  });
});

describe('file classification is not PDF-only', () => {
  it('routes each supported family to its reader', () => {
    expect(classifyStockFile('stock.csv', 'text/csv').kind).toBe('delimited');
    expect(classifyStockFile('stock.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').kind).toBe('spreadsheet');
    expect(classifyStockFile('stock.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document').kind).toBe('word');
    expect(classifyStockFile('stock.pdf', 'application/pdf').kind).toBe('pdf');
    expect(classifyStockFile('stock.jpg', 'image/jpeg').kind).toBe('image');
  });

  it('breaks the legacy Office tie with the extension', () => {
    expect(classifyStockFile('stock.xls', null, 'ambiguous_legacy_office_container').kind)
      .toBe('spreadsheet');
    expect(classifyStockFile('stock.doc', null, 'ambiguous_legacy_office_container').kind)
      .toBe('word');
  });

  it('falls back to the extension when the bytes say nothing', () => {
    expect(classifyStockFile('stock.tsv', null, 'unknown_content_signature').kind)
      .toBe('delimited');
  });

  it('refuses an executable and an unknown type', () => {
    expect(classifyStockFile('payload.exe', null, 'executable_signature').kind).toBe('unsupported');
    expect(classifyStockFile('archive.zip', null, 'unsupported_or_ambiguous_zip').kind)
      .toBe('unsupported');
  });

  it('offers the picker exactly what it can read', () => {
    const accept = stockFileAcceptAttribute();
    for (const extension of ['.csv', '.xlsx', '.xls', '.docx', '.doc', '.pdf', '.jpg', '.png']) {
      expect(accept).toContain(extension);
    }
  });
});

describe('storage paths are treated as hostile', () => {
  it('rejects traversal and anything outside the prefix', () => {
    expect(isAcceptableStockStoragePath('stock-lists/org/id/file.csv')).toBe(true);
    expect(isAcceptableStockStoragePath('stock-lists/../secrets')).toBe(false);
    expect(isAcceptableStockStoragePath('/stock-lists/file.csv')).toBe(false);
    expect(isAcceptableStockStoragePath('documents/file.csv')).toBe(false);
    expect(isAcceptableStockStoragePath(null)).toBe(false);
  });

  it('strips a filename down to something safe', () => {
    expect(safeObjectName('March Stock List (final)/../.xlsx')).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(safeObjectName('list.csv')).toBe('list.csv');
  });
});
