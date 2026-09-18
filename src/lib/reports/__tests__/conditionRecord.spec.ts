/**
 * The recommended Property Risk method — admissibility, the conversion, and
 * the fact that it is prepared and NOT switched on.
 *
 * Every refusal below is a different remedy, which is the point of having six
 * of them: "nobody has sent us an inspection" and "the inspection does not say
 * what it inspected" send an operator to different places.
 */

import { describe, expect, it } from 'vitest';
import {
  ADMISSIBLE_SOURCES,
  CONDITION_METHOD_ACTIVATION,
  CONDITION_MAX_AGE_MONTHS,
  CONDITION_RECORD_METHOD_VERSION,
  CONDITION_REFERENCE,
  INADMISSIBLE_SOURCES,
  MAX_MINOR_DEDUCTION,
  SEVERITY_DEDUCTION,
  assessConditionRecord,
  bestConditionRecord,
  convertFindings,
  type ConditionRecord,
} from '../../../../supabase/functions/_shared/reports/risk/conditionRecord.pure.ts';

const ASOF = '2026-09-18T00:00:00.000Z';

const inspection = (over: Partial<ConditionRecord> = {}): ConditionRecord => ({
  document: {
    kind: 'building_inspection',
    issuer: 'Hunter Building Consultants',
    issuerLicence: 'NSW 123456C',
    issuedOn: '2026-06-02',
    inspectedOn: '2026-05-29',
    reference: 'HBC-2026-4417',
  },
  scope: 'Interior, exterior, roof void and subfloor of the dwelling, and the detached garage.',
  findings: [],
  verification: 'document_held',
  recordedBy: 'operator',
  recordedAt: '2026-06-03',
  ...over,
});

describe('a record needs a document somebody is accountable for', () => {
  it('names the absence rather than scoring it', () => {
    const r = assessConditionRecord(null, ASOF);
    expect(r.admissible).toBe(false);
    expect(r.refusal).toBe('no_record');
    // The statement has to say what would answer it — this is the actionable half.
    expect(r.statement).toContain('building inspection report');
  });

  it('refuses a source nobody issues', () => {
    const r = assessConditionRecord(
      // A typed year dressed as a document.
      inspection({ document: { kind: 'typed_construction_year' as never, issuer: 'operator', issuedOn: '2026-09-16' } }),
      ASOF,
    );
    expect(r.refusal).toBe('inadmissible_source');
  });

  it('lists what it refuses, so a reader can see the typed year was considered', () => {
    expect(Object.keys(INADMISSIBLE_SOURCES)).toContain('typed_construction_year');
    expect(INADMISSIBLE_SOURCES.typed_construction_year).toContain('32 rows');
    // None of the refused kinds may also be admissible.
    for (const k of Object.keys(INADMISSIBLE_SOURCES)) {
      expect(ADMISSIBLE_SOURCES as readonly string[]).not.toContain(k);
    }
  });

  it('refuses an unattributed document', () => {
    expect(assessConditionRecord(
      inspection({ document: { ...inspection().document, issuer: '  ' } }), ASOF,
    ).refusal).toBe('unattributed');
  });

  it('refuses one with no usable date', () => {
    expect(assessConditionRecord(
      inspection({ document: { kind: 'building_inspection', issuer: 'X', issuedOn: 'sometime' } }), ASOF,
    ).refusal).toBe('undated');
  });
});

describe('an absence of findings is a determination only where the scope is recorded', () => {
  it('refuses a scopeless document even when everything else is in order', () => {
    const r = assessConditionRecord(inspection({ scope: undefined }), ASOF);
    expect(r.refusal).toBe('scope_not_recorded');
    expect(r.statement).toContain('cannot be read as a finding');
  });

  it('accepts a scoped inspection that found nothing, and says who looked', () => {
    const r = assessConditionRecord(inspection(), ASOF);
    expect(r.admissible).toBe(true);
    expect(r.refusal).toBeNull();
    expect(r.statement).toContain('no defect or hazard over the scope examined');
    expect(r.statement).toContain('Hunter Building Consultants');
  });

  it('refuses findings transcribed without the document', () => {
    expect(assessConditionRecord(
      inspection({ verification: 'transcribed_only' }), ASOF,
    ).refusal).toBe('not_verified');
  });

  it('declines a document older than the currency window', () => {
    const stale = inspection({
      document: { ...inspection().document, issuedOn: '2020-01-10', inspectedOn: '2020-01-08' },
    });
    const r = assessConditionRecord(stale, ASOF);
    expect(r.refusal).toBe('out_of_currency');
    expect(r.ageMonths! > CONDITION_MAX_AGE_MONTHS).toBe(true);
  });
});

describe('the conversion only ever deducts', () => {
  it('starts at the declared reference when nothing was found', () => {
    expect(convertFindings([])).toBe(CONDITION_REFERENCE);
  });

  it('never rises above the reference, whatever it is handed', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      element: `element ${i}`, severity: 'minor_defect' as const,
    }));
    expect(convertFindings(many)).toBeLessThan(CONDITION_REFERENCE);
    // ...and minor findings alone cannot exhaust the scale.
    expect(convertFindings(many)).toBe(CONDITION_REFERENCE - MAX_MINOR_DEDUCTION);
  });

  it('ranks the severities by what the finding obliges', () => {
    expect(SEVERITY_DEDUCTION.safety_hazard).toBeGreaterThan(SEVERITY_DEDUCTION.major_defect);
    expect(SEVERITY_DEDUCTION.major_defect).toBeGreaterThan(SEVERITY_DEDUCTION.minor_defect);
  });

  it('describes what it read, in the issuer’s units', () => {
    const r = assessConditionRecord(inspection({
      findings: [
        { element: 'Subfloor bearer', severity: 'major_defect' },
        { element: 'Balustrade height', severity: 'safety_hazard' },
        { element: 'Gutter corrosion', severity: 'minor_defect' },
      ],
    }), ASOF);
    expect(r.statement).toContain('1 safety hazard, 1 major defect and 1 minor defect');
    expect(r.provisionalObservation).toBe(
      CONDITION_REFERENCE - SEVERITY_DEDUCTION.safety_hazard
        - SEVERITY_DEDUCTION.major_defect - SEVERITY_DEDUCTION.minor_defect,
    );
  });

  it('floors at zero rather than going negative', () => {
    const wrecked = Array.from({ length: 12 }, (_, i) => ({
      element: `e${i}`, severity: 'safety_hazard' as const,
    }));
    expect(convertFindings(wrecked)).toBe(0);
  });
});

describe('preparing a method is not activating it', () => {
  it('ships with no activation decision', () => {
    // This is the assertion that makes switching it on a visible act.
    expect(CONDITION_METHOD_ACTIVATION).toBeNull();
  });

  it('publishes no observation even from a fully admissible record', () => {
    const r = assessConditionRecord(inspection(), ASOF);
    expect(r.admissible).toBe(true);
    expect(r.observation).toBeNull();
    // The diagnostic value is still computed, so the method can be reviewed.
    expect(r.provisionalObservation).toBe(CONDITION_REFERENCE);
    expect(r.statement).toContain('no condition scale is authorised');
  });

  it('carries a version, so a stored reading names its basis', () => {
    expect(CONDITION_RECORD_METHOD_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(assessConditionRecord(inspection(), ASOF).version)
      .toBe(CONDITION_RECORD_METHOD_VERSION);
  });
});

describe('choosing between records', () => {
  it('prefers by scope and recency, never by outcome', () => {
    const wideButOlder = inspection({
      document: { ...inspection().document, inspectedOn: '2026-01-04', issuedOn: '2026-01-05' },
      findings: [{ element: 'Roof', severity: 'major_defect' }],
    });
    const narrowerButNewer: ConditionRecord = {
      document: {
        kind: 'vendor_statement', issuer: 'Vendor', issuedOn: '2026-08-01',
      },
      scope: 'Matters known to the vendor.',
      findings: [],
      verification: 'document_held',
    };
    // The inspection wins although it is older AND carries the worse finding.
    expect(bestConditionRecord([narrowerButNewer, wideButOlder])?.document.kind)
      .toBe('building_inspection');
  });

  it('answers null where nothing admissible is held', () => {
    expect(bestConditionRecord([])).toBeNull();
  });
});
