/**
 * The register → evidence-point adapter: the keys the scorer reads, the
 * grain and footing every point carries, and the horizons it refuses.
 */
import { describe, expect, it } from 'vitest';

import type { EvidenceSubject } from '@/lib/reports/market/marketEvidence.pure';
import { mayEnterProductionEvidence, mayReachClientReport } from '@/lib/reports/market/marketEvidence.pure';
import type { SalesMedianRow } from '@/lib/reports/market/openData/salesRegister.pure';
import {
  SALES_REGISTER_SOURCES,
  dwellingPreference,
  openDataSalesPoints,
  salesRegisterSourceFor,
} from '@/lib/reports/market/openDataSalesEvidence.pure';

const QUARTERS = ['-03', '-06', '-09', '-12'];

/** A quarterly series from `fromYear` to `2026-03`, growing `annual` per cent a year. */
function series(
  area: string, areaKind: SalesMedianRow['areaKind'], dwellingType: SalesMedianRow['dwellingType'],
  start: number, annual: number, fromYear = 2015, state: SalesMedianRow['state'] = 'QLD',
): SalesMedianRow[] {
  const rows: SalesMedianRow[] = [];
  let value = start;
  const q = Math.pow(1 + annual / 100, 1 / 4);
  for (let year = fromYear; year <= 2026; year++) {
    for (const m of QUARTERS) {
      const period = `${year}${m}`;
      if (period > '2026-03') break;
      rows.push({ state, areaKind, area, dwellingType, period, medianPrice: Math.round(value), salesCount: 500 });
      value *= q;
    }
  }
  return rows;
}

const subject: EvidenceSubject = { suburb: 'Morayfield', postcode: '4506', state: 'QLD', dwellingType: 'house', resolvedFrom: 'coordinate' };

describe('the points a series becomes', () => {
  const rows = [...series('Moreton Bay (C)', 'lga', 'house', 400000, 6), ...series('Moreton Bay (C)', 'lga', 'attached', 300000, 4)];
  const bench = series('Total (all monitored regions)', 'region', 'house', 420000, 5);
  const result = openDataSalesPoints({
    subject, askedDwelling: 'house', areaKind: 'lga', area: 'Moreton Bay (C)', rows, benchmarkRows: bench, source: SALES_REGISTER_SOURCES.QLD,
  });

  it('draws every growth key the scorer reads, from the asked dwelling type', () => {
    expect(Object.keys(result.points).sort()).toEqual([
      'benchmarkGrowth1Year', 'benchmarkGrowth3YearCagr', 'benchmarkGrowth5YearCagr', 'benchmarkMedianPrice',
      'growth10YearCagr', 'growth1Year', 'growth3YearCagr', 'growth5YearCagr', 'medianPrice', 'priceSeries', 'salesCount',
    ]);
    expect(result.dwellingType).toBe('house');
    expect(result.dwellingTypeMatched).toBe(true);
    expect(result.latestPeriod).toBe('2026-03');
    expect(result.pricedPeriods).toBe(45);
    expect(result.points.growth5YearCagr!.value).toBeCloseTo(6, 0);
    expect(result.points.growth1Year!.value).toBeCloseTo(6, 0);
    expect(result.points.priceSeries!.value).toHaveLength(45);
    expect(result.points.priceSeries!.value[0]).toEqual({ period: '2015-03', value: 400000 });
  });

  it('stamps the publisher\'s grain, the area, the quarter and the open footing on every point', () => {
    for (const [key, p] of Object.entries(result.points)) {
      if (key.startsWith('benchmark')) continue;
      expect(p!.level, key).toBe('lga');
      expect(p!.areaName, key).toBe('Moreton Bay (C) local government area, QLD');
      expect(p!.provider, key).toBe('qld_qgso_rlda');
      expect(p!.asOf, key).toBe('2026-03-31');
      expect(p!.sampleSize, key).toBe(500);
      expect(p!.periodsAvailable, key).toBe(45);
      expect(p!.licensingStatus, key).toBe('open');
      expect(p!.acquisition, key).toBe('open_public');
      expect(mayReachClientReport(p!), key).toBe(true);
      expect(mayEnterProductionEvidence(p!), key).toBe(true);
      expect(p!.sourceNote, key).toContain("Queensland Government Statistician's Office");
    }
    expect(result.points.growth5YearCagr!.method).toBe('calculated');
    expect(result.points.medianPrice!.method).toBe('observed');
    expect(result.points.growth5YearCagr!.sourceNote).toContain('March 2021 quarter to March 2026 quarter');
  });

  it('draws the benchmark at state grain from the publisher\'s total', () => {
    expect(result.points.benchmarkMedianPrice!.level).toBe('state');
    expect(result.points.benchmarkGrowth5YearCagr!.value).toBeCloseTo(5, 0);
    expect(result.points.benchmarkMedianPrice!.areaName).toBe('QLD (all areas the publisher monitors)');
  });
});

describe('what the adapter refuses', () => {
  it('computes a horizon only where the same quarter exists that many years earlier', () => {
    const short = series('Isaac (R)', 'lga', 'house', 300000, 3, 2024);
    const r = openDataSalesPoints({ subject, askedDwelling: 'house', areaKind: 'lga', area: 'Isaac (R)', rows: short, source: SALES_REGISTER_SOURCES.QLD });
    expect(r.points.growth1Year).toBeDefined();
    expect(r.points.growth3YearCagr).toBeUndefined();
    expect(r.points.growth5YearCagr).toBeUndefined();
    expect(r.notes.some((n) => /No priced quarter 3 years before/.test(n))).toBe(true);
  });

  it('falls back to all-dwellings data and says so, never a different area', () => {
    const rows = series('2155', 'postcode', 'any', 1200000, 5, 2019, 'NSW');
    const r = openDataSalesPoints({
      subject: { ...subject, state: 'NSW', postcode: '2155', suburb: 'Kellyville' },
      askedDwelling: 'house', areaKind: 'postcode', area: '2155', rows, source: SALES_REGISTER_SOURCES.NSW,
    });
    expect(r.dwellingType).toBe('any');
    expect(r.dwellingTypeMatched).toBe(false);
    expect(r.points.medianPrice!.dwellingTypeMatched).toBe(false);
    expect(r.points.medianPrice!.level).toBe('postcode');
    expect(r.points.medianPrice!.areaName).toBe('postcode 2155, NSW');
    expect(r.points.medianPrice!.provider).toBe('nsw_dcj_rent_sales');
    expect(r.notes[0]).toMatch(/houses not priced for 2155; all dwellings used instead/);
  });

  it('answers nothing for land, for an empty register and for a series of one', () => {
    const rows = series('Moreton Bay (C)', 'lga', 'house', 400000, 6);
    expect(openDataSalesPoints({ subject, askedDwelling: 'land', areaKind: 'lga', area: 'Moreton Bay (C)', rows, source: SALES_REGISTER_SOURCES.QLD }).points).toEqual({});
    const none = openDataSalesPoints({ subject, askedDwelling: 'house', areaKind: 'lga', area: 'Nowhere (S)', rows: [], source: SALES_REGISTER_SOURCES.QLD });
    expect(none.points).toEqual({});
    expect(none.notes[0]).toMatch(/No priced quarter for Nowhere/);
    const suppressed = rows.map((r) => ({ ...r, medianPrice: null }));
    expect(openDataSalesPoints({ subject, askedDwelling: 'house', areaKind: 'lga', area: 'Moreton Bay (C)', rows: suppressed, source: SALES_REGISTER_SOURCES.QLD }).points).toEqual({});
    const one = openDataSalesPoints({ subject, askedDwelling: 'house', areaKind: 'lga', area: 'Moreton Bay (C)', rows: rows.slice(-1), source: SALES_REGISTER_SOURCES.QLD });
    expect(Object.keys(one.points)).toEqual(['medianPrice', 'salesCount']);
  });

  it('knows which states have a register, and in what order dwelling series are tried', () => {
    expect(salesRegisterSourceFor('QLD')!.areaKind).toBe('lga');
    expect(salesRegisterSourceFor('NSW')!.areaKind).toBe('postcode');
    expect(salesRegisterSourceFor('VIC')).toBeNull();
    expect(salesRegisterSourceFor(null)).toBeNull();
    expect(dwellingPreference('house')).toEqual(['house', 'any']);
    expect(dwellingPreference('attached')).toEqual(['attached', 'any']);
    expect(dwellingPreference('any')).toEqual(['any', 'house', 'attached']);
    expect(dwellingPreference('land')).toEqual([]);
  });
});
