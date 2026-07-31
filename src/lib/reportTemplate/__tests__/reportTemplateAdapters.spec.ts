import { describe, expect, it } from 'vitest';
import { getAdapter, listAdapters, normaliseReportType, supportsProduction } from '../adapters';

describe('report template adapter registry', () => {
  it('normalises legacy investment aliases to the production investment adapter', () => {
    expect(normaliseReportType('investment_compass')).toBe('investment');
    expect(normaliseReportType('compass')).toBe('investment');
    expect(getAdapter('investment_compass')?.reportType).toBe('investment');
    expect(getAdapter('investment_report')?.supportsProduction).toBe(true);
    expect(supportsProduction('property_investment')).toBe(true);
  });

  it('marks future report types as preview-only until adapters are implemented', () => {
    const previewOnlyTypes = ['portfolio', 'cashflow', 'borrowing_capacity', 'qa', 'suburb', 'postcode', 'statewide', 'comparison', 'formara'];

    expect(listAdapters().map((adapter) => adapter.reportType)).toEqual(expect.arrayContaining(['investment', ...previewOnlyTypes]));
    for (const reportType of previewOnlyTypes) {
      const adapter = getAdapter(reportType);
      expect(adapter?.supportsProduction).toBe(false);
      expect(adapter?.legacyFallback?.reason).toBeTruthy();
    }
  });

  it('returns null for unconfigured report types so the UI can show a not-configured state', () => {
    expect(getAdapter('made_up_report')).toBeNull();
    expect(supportsProduction('made_up_report')).toBe(false);
  });
});
