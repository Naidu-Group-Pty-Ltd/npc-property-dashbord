/**
 * What a Commercial & Industrial Capacity template may bind, and the contract
 * rules that are easiest to break here.
 *
 * The format's own doc states four. Three of them can be asserted at this layer
 * and are, below: figures come from the stored run rather than a recomputation;
 * the analysis is labelled as model-written wherever it appears; and collections
 * are capped because the page model cannot paginate.
 */
import { describe, it, expect } from 'vitest';
import {
  projectCommercialCapacity, applyCommercialCapacityProjection, CAPS,
} from '../../../../supabase/functions/_shared/commercialCapacityProjection.pure';
import { ANALYSIS_PROVENANCE_NOTE }
  from '../../../../supabase/functions/_shared/reports/commercialCapacity/render.pure';
import { COMMERCIAL_CAPACITY_TEMPLATES }
  from '../../../../scripts/template-library/investmentCompass/commercialCapacity';

const m = (value: number, unit = 'aud') => ({ value, unit });

function snapshot(over: Record<string, any> = {}): any {
  return {
    meta: {
      subject: 'Marlborough Industrial Pty Ltd',
      reference: 'CI-0001',
      title: 'Unit 4, 12 Marlborough St',
      assessedOn: '2026-08-01T00:00:00.000Z',
      assessmentId: 'a1',
      segment: 'industrial',
      assessmentTypeLabel: 'Purchase',
      engineVersion: '1.0.0',
      policyVersion: '2026.08.0',
      lenderProfile: 'Tier 2',
    },
    property: {
      address: '12 Marlborough St',
      assetClass: 'Industrial',
      gstTreatment: 'Going concern',
      lettableArea: m(1200, 'sqm'),
      purchasePrice: m(3_000_000),
      valuation: m(3_050_000),
      valuationBasis: 'As is',
    },
    headline: {
      outcome: 'outside_current_assumptions',
      outcomeLabel: 'Outside current assumptions',
      outcomeReason: 'The debt service coverage ratio falls below the floor.',
      maximumCapacity: m(1_800_000),
      requestedLoan: m(2_400_000),
      difference: m(-600_000),
      requiredContribution: m(600_000),
      bindingConstraint: 'Debt service coverage ratio',
      assessmentRate: m(0.0785, 'rate'),
      loanTerm: m(5, 'years'),
      amortisation: m(20, 'years'),
      monthlyDebtService: m(14_800),
      surplus: m(-2_100),
      sensitisedSurplus: m(-4_300),
    },
    narrative: 'On the figures supplied the facility does not service.',
    ratios: { lvr: m(0.6, 'rate'), dscr: m(1.02, 'ratio'), dscrFloor: m(1.25, 'ratio') },
    constraints: [
      { label: 'DSCR', actual: m(1.02, 'ratio'), limit: m(1.25, 'ratio'), status: 'Fails', binding: true },
      { label: 'LVR', actual: m(0.6, 'rate'), limit: m(0.65, 'rate'), status: 'Passes' },
    ],
    transaction: {
      lines: [{ label: 'Purchase price', amount: m(3_000_000) }],
      totalProjectCost: m(3_180_000),
      borrowerContribution: m(780_000),
      fundingGap: null,
      cashOut: null,
    },
    propertyIncome: {
      lines: [{ label: 'Passing rent', amount: m(210_000) }],
      netOperatingIncome: m(178_000),
      capitalisationRate: m(0.058, 'rate'),
      breakEvenOccupancy: m(0.82, 'rate'),
      wale: m(3.4, 'years'),
      tenantCount: m(2, 'count'),
      tenantConcentration: null,
    },
    businessIncome: { adjustedEbitda: m(0), assessableIncome: m(0), trend: null },
    outstanding: [{ label: 'Signed leases', blocking: true }],
    nextActions: ['Obtain executed leases'],
    warnings: [],
    method: [{ label: 'Debt service', detail: 'Sized on 20-year amortisation' }],
    analysis: null,
    disclaimer: 'Indicative only.',
    ...over,
  };
}

const ANALYSIS = {
  interpretation: 'The deal is short on servicing rather than on security.',
  findings: [
    { title: 'Security is adequate', detail: 'LVR sits inside the ceiling.', significance: 'strength' },
    { title: 'Servicing is short', detail: 'DSCR is 1.02 against a 1.25 floor.', significance: 'risk' },
  ],
  scenarios: [
    {
      name: 'Extend amortisation',
      reasoning: 'A longer amortisation lowers monthly debt service.',
      estimatedImpact: 'DSCR to ~1.20',
      executionRisk: 'medium',
      evidenceRequired: ['Lender term sheet', 'Updated cash flow'],
    },
  ],
  questionsForCredit: ['Is a 25-year amortisation available on this asset class?'],
  model: 'google/gemini-2.5-flash',
  generatedAt: '2026-08-02T00:00:00.000Z',
};

describe('figures are restated, never recomputed', () => {
  const { capacity } = projectCommercialCapacity(snapshot());

  it('unwraps Measures to the bare value a filter can format', () => {
    expect((capacity.headline as any).maximumCapacity).toBe(1_800_000);
    expect((capacity.headline as any).assessmentRate).toBeCloseTo(0.0785);
    // Not the Measure object — a template has no syntax to reach into one.
    expect((capacity.headline as any).maximumCapacity).not.toHaveProperty('value');
  });

  it('publishes both versions, so a figure can be checked against what produced it', () => {
    expect((capacity.meta as any).engineVersion).toBe('1.0.0');
    expect((capacity.meta as any).policyVersion).toBe('2026.08.0');
  });

  it('derives no totals of its own', () => {
    // The transaction total is the engine's, not lines summed here. Summing
    // would be a second engine, and a document that disagrees with the
    // calculator a broker was looking at is worse than one with a gap.
    const t = capacity.transaction as any;
    expect(t.totalProjectCost).toBe(3_180_000);
    expect(t.lines[0].amount).toBe(3_000_000);
    expect(t.totalProjectCost).not.toBe(t.lines[0].amount);
  });
});

describe('a decline is the corpus, so it is named rather than implied', () => {
  const { capacity } = projectCommercialCapacity(snapshot());
  const h = () => capacity.headline as any;

  it('names a shortfall as a shortfall and publishes it unsigned', () => {
    // Every assessment in production is short. A master reading `difference`
    // alone prints a negative under a heading that says "headroom".
    expect(h().differenceLabel).toBe('Shortfall');
    expect(h().differenceAbsolute).toBe(600_000);
    expect(h().isShortfall).toBe(true);
  });

  it('says headroom when there is headroom, and publishes no shortfall flag', () => {
    const up = projectCommercialCapacity(snapshot({
      headline: { ...snapshot().headline, difference: m(250_000) },
    })).capacity.headline as any;
    expect(up.differenceLabel).toBe('Headroom');
    expect(up.isShortfall).toBeUndefined();
  });

  it('carries the binding test, which is what the document turns on', () => {
    expect(h().bindingConstraint).toBe('Debt service coverage ratio');
    expect((capacity.constraints as any[])[0].binding).toBe(true);
    expect((capacity.constraints as any[])[1].binding).toBeUndefined();
  });
});

describe('the analysis is labelled as model-written, or it is not published', () => {
  it('publishes the provenance note alongside the analysis', () => {
    const { capacity } = projectCommercialCapacity(snapshot({ analysis: ANALYSIS }));
    expect(capacity.analysisProvenance).toBe(ANALYSIS_PROVENANCE_NOTE);
    expect((capacity.analysis as any).interpretation).toContain('short on servicing');
    expect((capacity.analysis as any).model).toBe('google/gemini-2.5-flash');
  });

  it('publishes neither when there is no analysis', () => {
    const { capacity } = projectCommercialCapacity(snapshot());
    expect(capacity.analysis).toBeUndefined();
    expect(capacity.analysisProvenance).toBeUndefined();
  });

  it('keeps significance as the judgement it is', () => {
    const { capacity } = projectCommercialCapacity(snapshot({ analysis: ANALYSIS }));
    const findings = (capacity.analysis as any).findings;
    expect(findings.map((f: any) => f.significance)).toEqual(['strength', 'risk']);
  });

  it('joins evidence into something a table cell can print', () => {
    const { capacity } = projectCommercialCapacity(snapshot({ analysis: ANALYSIS }));
    expect((capacity.analysis as any).scenarios[0].evidence)
      .toBe('Lender term sheet; Updated cash flow');
  });
});

describe('collections are capped and absent means absent', () => {
  it('caps constraints and says how many there were', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      label: `Test ${i}`, actual: m(1, 'ratio'), limit: m(2, 'ratio'), status: 'Passes',
    }));
    const { capacity } = projectCommercialCapacity(snapshot({ constraints: many }));
    expect((capacity.constraints as any[]).length).toBe(CAPS.constraints);
    expect(capacity.constraintCount).toBe(14);
    expect(capacity.constraintsOmitted).toContain('6 further tests');
  });

  it('never publishes an empty string or a null', () => {
    const { capacity } = projectCommercialCapacity(snapshot({
      narrative: '', warnings: [], method: [], outstanding: [], nextActions: [],
      property: { ...snapshot().property, valuationBasis: '', valuation: null },
    }));
    const walk = (v: unknown): void => {
      if (v === '' || v === null) throw new Error('published an empty value');
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    expect(() => walk(capacity)).not.toThrow();
    expect(capacity.narrative).toBeUndefined();
    expect(capacity.method).toBeUndefined();
    expect((capacity.property as any).valuation).toBeUndefined();
  });

  it('writes nothing at all when the snapshot is empty', () => {
    const target: Record<string, unknown> = {};
    applyCommercialCapacityProjection(target, {} as any);
    expect(target.capacity).toBeUndefined();
  });
});

describe('the fifty masters', () => {
  it('exist, uniquely', () => {
    expect(COMMERCIAL_CAPACITY_TEMPLATES).toHaveLength(50);
    expect(new Set(COMMERCIAL_CAPACITY_TEMPLATES.map((t) => t.slug)).size).toBe(50);
  });

  it('never draw the model prose without the sentence saying a model wrote it', () => {
    // The contract's fourth rule, enforced structurally rather than by review.
    for (const master of COMMERCIAL_CAPACITY_TEMPLATES) {
      for (const page of master.schema.pages as any[]) {
        const json = JSON.stringify(page);
        if (json.includes('{{capacity.analysis.interpretation}}')) {
          expect(json, `${master.slug}: ${page.name} prints the reading unlabelled`)
            .toContain('{{capacity.analysisProvenance}}');
        }
      }
    }
  });
});
