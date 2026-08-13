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

  it('supports production for the report types that have a real data source', () => {
    // `borrowing_capacity` joined `investment` here when its adapter was built
    // against `borrowing_capacity_assessments` — a typed 35-column table with
    // 143 real rows — then `portfolio` against `portfolio_analysis_reports` (21
    // stored reports) and `comparison` against `property_comparisons` (50).
    // This list is the gate
    // `deriveEntryFacts` reads for `production_ready`, so adding a type to it
    // without a working `buildBindingContext` marks templates report-ready that
    // cannot render one.
    for (const reportType of ['investment', 'borrowing_capacity', 'portfolio', 'comparison']) {
      const adapter = getAdapter(reportType);
      expect(adapter?.supportsProduction, reportType).toBe(true);
      // Still names a fallback: the legacy generator stays until a template is
      // activated for the type.
      expect(adapter?.legacyFallback?.reason, reportType).toBeTruthy();
    }
    expect(supportsProduction('borrowing')).toBe(true);
  });

  it('marks the remaining report types preview-only until adapters are implemented', () => {
    const previewOnlyTypes = ['cashflow', 'qa', 'suburb', 'postcode', 'statewide', 'formara'];

    expect(listAdapters().map((adapter) => adapter.reportType))
      .toEqual(expect.arrayContaining([
        'investment', 'borrowing_capacity', 'portfolio', 'comparison', ...previewOnlyTypes,
      ]));
    for (const reportType of previewOnlyTypes) {
      const adapter = getAdapter(reportType);
      expect(adapter?.supportsProduction, reportType).toBe(false);
      expect(adapter?.legacyFallback?.reason, reportType).toBeTruthy();
    }
  });

  it('returns null for unconfigured report types so the UI can show a not-configured state', () => {
    expect(getAdapter('made_up_report')).toBeNull();
    expect(supportsProduction('made_up_report')).toBe(false);
  });
});
