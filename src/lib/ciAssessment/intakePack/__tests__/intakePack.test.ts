import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildIntakeWorkbook, INSTRUCTIONS_SHEET, PACK_MAGIC, packFileName } from '../workbook';
import { parseIntakeWorkbook } from '../parseWorkbook';
import { ALL_PACK_FIELDS, PACK_SECTIONS } from '../schema';
import { decodeDate, decodeNumber, decodeTriState, encodeValue, decodeValue } from '../values';
import { DEFAULT_PACK_BRANDING } from '../branding';
import { emptyAssessmentPayload, type AssessmentPayload } from '../../types';
import { runAssessment } from '../../engine';

const AS_AT = new Date('2026-08-03T00:00:00.000Z');

/** Round-trip a workbook through a real serialise/parse cycle, as the UI does. */
function roundTrip(workbook: XLSX.WorkBook) {
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const reread = XLSX.read(bytes, { type: 'array', cellDates: true });
  return parseIntakeWorkbook(reread);
}

/** Write a value into a key/value sheet by field key. */
function setScalar(workbook: XLSX.WorkBook, sheetName: string, key: string, value: unknown) {
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true });
  const index = rows.findIndex((row) => String(row?.[0] ?? '').trim() === key);
  if (index === -1) throw new Error(`Field key ${key} not found on ${sheetName}`);
  rows[index][2] = value as never;
  workbook.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(rows as never);
}

/** Append a row to a table sheet, keyed by the header row of field keys. */
function addTableRow(workbook: XLSX.WorkBook, sheetName: string, values: Record<string, unknown>) {
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true });
  const headerIndex = rows.findIndex((row) => (row ?? []).some(
    (cell) => ALL_PACK_FIELDS.has(String(cell ?? '').trim()),
  ));
  if (headerIndex === -1) throw new Error(`No header row on ${sheetName}`);
  const header = rows[headerIndex].map((cell) => String(cell ?? '').trim());

  // First entirely blank row after the label row.
  let target = headerIndex + 2;
  while (target < rows.length && (rows[target] ?? []).some((cell) => String(cell ?? '').trim() !== '')) {
    target += 1;
  }
  if (!rows[target]) rows[target] = [];

  Object.entries(values).forEach(([key, value]) => {
    const column = header.indexOf(key);
    if (column === -1) throw new Error(`Column ${key} not found on ${sheetName}`);
    rows[target][column] = value as never;
  });

  workbook.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(rows as never);
}

// ---------------------------------------------------------------------------
// Schema integrity
// ---------------------------------------------------------------------------

describe('pack schema', () => {
  it('has globally unique field keys', () => {
    const keys = PACK_SECTIONS.flatMap((section) => section.fields.map((field) => field.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps every sheet name within Excel’s 31-character limit', () => {
    PACK_SECTIONS.forEach((section) => {
      expect(section.sheetName.length).toBeLessThanOrEqual(31);
    });
  });

  it('gives every field an interview question', () => {
    PACK_SECTIONS.forEach((section) => {
      section.fields.forEach((field) => {
        expect(field.question.trim().length).toBeGreaterThan(0);
      });
    });
  });

  it('declares a collection path for every table section', () => {
    PACK_SECTIONS.filter((section) => section.shape === 'table').forEach((section) => {
      expect(section.collectionPath).toBeTruthy();
    });
  });

  it('offers individual, trust and SMSF structures, not just company', () => {
    const structure = ALL_PACK_FIELDS.get('entity.structure');
    expect(structure).toBeTruthy();
    expect(structure!.field.options).toEqual(
      expect.arrayContaining(['Individual', 'Trust', 'SMSF', 'Corporate trustee', 'Partnership']),
    );
  });

  it('asks who owns each portfolio asset and liability', () => {
    expect(ALL_PACK_FIELDS.has('asset.ownershipEntity')).toBe(true);
    expect(ALL_PACK_FIELDS.has('liability.ownershipEntity')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

describe('buildIntakeWorkbook', () => {
  it('creates a sheet for every section plus instructions and proceed', () => {
    const workbook = buildIntakeWorkbook({ generatedAt: AS_AT });
    expect(workbook.SheetNames).toContain(INSTRUCTIONS_SHEET);
    expect(workbook.SheetNames).toContain('7. Proceed');
    PACK_SECTIONS.forEach((section) => {
      expect(workbook.SheetNames).toContain(section.sheetName);
    });
  });

  it('stamps a machine-readable format marker', () => {
    const workbook = buildIntakeWorkbook({ generatedAt: AS_AT });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets[INSTRUCTIONS_SHEET], { header: 1, defval: '' },
    );
    const marker = rows.find((row) => String(row?.[0]) === '__pack_format');
    expect(marker?.[1]).toBe(PACK_MAGIC);
  });

  it('carries the white-label company name', () => {
    const workbook = buildIntakeWorkbook({
      generatedAt: AS_AT,
      branding: { ...DEFAULT_PACK_BRANDING, companyName: 'Acme Finance Group' },
    });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets[INSTRUCTIONS_SHEET], { header: 1, defval: '' },
    );
    expect(JSON.stringify(rows)).toContain('Acme Finance Group');
  });

  it('writes field keys onto every sheet so the parser can map columns', () => {
    const workbook = buildIntakeWorkbook({ generatedAt: AS_AT });
    PACK_SECTIONS.forEach((section) => {
      const flat = JSON.stringify(XLSX.utils.sheet_to_json(
        workbook.Sheets[section.sheetName], { header: 1, defval: '' },
      ));
      section.fields.forEach((field) => expect(flat).toContain(field.key));
    });
  });

  it('leaves blank rows on table sheets to write into', () => {
    const workbook = buildIntakeWorkbook({ generatedAt: AS_AT });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets['3. Ownership'], { header: 1, defval: '', blankrows: true },
    );
    expect(rows.length).toBeGreaterThan(6);
  });

  it('builds a sensible filename', () => {
    expect(packFileName(
      { ...DEFAULT_PACK_BRANDING, companyName: 'Acme Finance Group' }, 'CI-202608-X9K9U', 'xlsx',
    )).toBe('Acme-Finance-Group-CI-intake-CI-202608-X9K9U.xlsx');
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe('pack round-trip', () => {
  it('rejects a workbook that is not one of our packs', () => {
    const foreign = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      foreign, XLSX.utils.aoa_to_sheet([['Name', 'Value'], ['Anything', 1]]), 'Sheet1',
    );
    const parsed = parseIntakeWorkbook(foreign);
    expect(parsed.recognised).toBe(false);
    expect(parsed.issues[0].severity).toBe('error');
  });

  it('recognises a freshly generated, unfilled pack and imports nothing from it', () => {
    const parsed = roundTrip(buildIntakeWorkbook({ generatedAt: AS_AT }));
    expect(parsed.recognised).toBe(true);
    // Blank template rows must not become empty entities or liabilities.
    expect(parsed.counts.entities).toBe(0);
    expect(parsed.counts.portfolioAssets).toBe(0);
    expect(parsed.counts.liabilities).toBe(0);
  });

  it('round-trips scalar transaction values', () => {
    const workbook = buildIntakeWorkbook({ generatedAt: AS_AT });
    setScalar(workbook, '1. Transaction', 'property.address', '45 Industrial Drive');
    setScalar(workbook, '1. Transaction', 'property.suburb', 'Wetherill Park');
    setScalar(workbook, '1. Transaction', 'property.state', 'NSW');
    setScalar(workbook, '1. Transaction', 'property.purchasePrice', 5_000_000);
    setScalar(workbook, '1. Transaction', 'property.gstTreatment', 'Going concern (GST-free)');
    setScalar(workbook, '1. Transaction', 'loan.requestedLoan', 3_250_000);
    setScalar(workbook, '1. Transaction', 'loan.actualRatePercent', 6.75);

    const parsed = roundTrip(workbook);
    expect(parsed.payload.property.address).toBe('45 Industrial Drive');
    expect(parsed.payload.property.suburb).toBe('Wetherill Park');
    expect(parsed.payload.property.state).toBe('NSW');
    expect(parsed.payload.property.purchasePrice).toBe(5_000_000);
    expect(parsed.payload.property.gstTreatment).toBe('going_concern');
    expect(parsed.payload.loan.requestedLoan).toBe(3_250_000);
    expect(parsed.payload.loan.actualRatePercent).toBe(6.75);
  });

  it('decodes select labels back to engine codes', () => {
    const workbook = buildIntakeWorkbook({ generatedAt: AS_AT });
    setScalar(workbook, '1. Transaction', 'assessment.type', 'Industrial investment');
    setScalar(workbook, '1. Transaction', 'property.assetClass', 'Cold storage');
    setScalar(workbook, '1. Transaction', 'loan.repaymentType', 'Interest only');

    const parsed = roundTrip(workbook);
    expect(parsed.payload.assessmentType).toBe('industrial_investment');
    expect(parsed.payload.property.assetClass).toBe('cold_storage');
    expect(parsed.payload.loan.repaymentType).toBe('interestOnly');
  });

  it('is not confused by re-ordered rows, because it matches on key', () => {
    const workbook = buildIntakeWorkbook({ generatedAt: AS_AT });
    setScalar(workbook, '1. Transaction', 'property.purchasePrice', 4_000_000);

    // Reverse the data rows entirely.
    const sheet = workbook.Sheets['1. Transaction'];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true });
    const reordered = [...rows.slice(0, 3), ...rows.slice(3).reverse()];
    workbook.Sheets['1. Transaction'] = XLSX.utils.aoa_to_sheet(reordered as never);

    expect(roundTrip(workbook).payload.property.purchasePrice).toBe(4_000_000);
  });
});

// ---------------------------------------------------------------------------
// Entity structures — the case the brief specifically called out
// ---------------------------------------------------------------------------

describe('ownership structures', () => {
  it('imports an individual, a family trust and an SMSF together', () => {
    const workbook = buildIntakeWorkbook({ generatedAt: AS_AT });
    addTableRow(workbook, '3. Ownership', {
      'entity.name': 'Jane Smith', 'entity.structure': 'Individual',
      'entity.ownershipPercent': 40,
    });
    addTableRow(workbook, '3. Ownership', {
      'entity.name': 'Smith Family Trust', 'entity.structure': 'Trust',
      'entity.ownershipPercent': 35, 'entity.trustees': 'Smith Holdings Pty Ltd',
      'entity.beneficiaries': 'Jane Smith, John Smith',
    });
    addTableRow(workbook, '3. Ownership', {
      'entity.name': 'Smith Super Fund', 'entity.structure': 'SMSF',
      'entity.ownershipPercent': 25, 'entity.trustees': 'Smith Super Pty Ltd',
      'entity.beneficiaries': 'Jane Smith, John Smith',
    });

    const parsed = roundTrip(workbook);
    expect(parsed.counts.entities).toBe(3);

    const structures = parsed.payload.ownership.entities.map((entity) => entity.structure);
    expect(structures).toEqual(['individual', 'trust', 'smsf']);

    const smsf = parsed.payload.ownership.entities[2];
    expect(smsf.entityName).toBe('Smith Super Fund');
    expect(smsf.trustees).toBe('Smith Super Pty Ltd');
    expect(smsf.beneficiaries).toContain('Jane Smith');
  });

  it('routes an SMSF borrower to specialist review once calculated', () => {
    const workbook = buildIntakeWorkbook({ generatedAt: AS_AT });
    addTableRow(workbook, '3. Ownership', {
      'entity.name': 'Smith Super Fund', 'entity.structure': 'SMSF', 'entity.ownershipPercent': 100,
    });
    setScalar(workbook, '2. Purpose', 'ownership.borrowingPurpose', 'Acquisition of a warehouse as a fund investment.');
    setScalar(workbook, '2. Purpose', 'ownership.purposeIsPredominantlyBusiness', 'Yes');

    const parsed = roundTrip(workbook);
    const result = runAssessment(parsed.payload, { asAt: AS_AT });
    expect(result.compliance.requiresSpecialistReview).toBe(true);
    expect(result.compliance.flags.some((flag) => flag.code === 'SMSF_BORROWER')).toBe(true);
  });

  it('warns when ownership percentages do not total 100', () => {
    const workbook = buildIntakeWorkbook({ generatedAt: AS_AT });
    addTableRow(workbook, '3. Ownership', {
      'entity.name': 'Jane Smith', 'entity.structure': 'Individual', 'entity.ownershipPercent': 40,
    });
    const parsed = roundTrip(workbook);
    expect(parsed.issues.some((issue) => issue.message.includes('total 100%'))).toBe(true);
  });

  it('warns when an asset names an owner absent from the ownership sheet', () => {
    const workbook = buildIntakeWorkbook({ generatedAt: AS_AT });
    addTableRow(workbook, '3. Ownership', {
      'entity.name': 'Jane Smith', 'entity.structure': 'Individual', 'entity.ownershipPercent': 100,
    });
    addTableRow(workbook, '5. Portfolio', {
      'asset.address': '9 Other Road', 'asset.ownershipEntity': 'Unlisted Trust',
      'asset.currentValue': 800_000, 'asset.currentBalance': 400_000,
    });
    const parsed = roundTrip(workbook);
    expect(parsed.issues.some((issue) => issue.message.includes('Unlisted Trust'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Portfolio, liabilities and income
// ---------------------------------------------------------------------------

describe('portfolio and income import', () => {
  it('imports portfolio assets with their owning entity', () => {
    const workbook = buildIntakeWorkbook({ generatedAt: AS_AT });
    addTableRow(workbook, '3. Ownership', {
      'entity.name': 'Smith Family Trust', 'entity.structure': 'Trust', 'entity.ownershipPercent': 100,
    });
    addTableRow(workbook, '5. Portfolio', {
      'asset.address': '12 Example Road', 'asset.ownershipEntity': 'Smith Family Trust',
      'asset.assetType': 'Industrial', 'asset.currentValue': 3_000_000,
      'asset.currentBalance': 1_500_000, 'asset.interestRate': 6.5, 'asset.annualRent': 210_000,
    });

    const parsed = roundTrip(workbook);
    expect(parsed.counts.portfolioAssets).toBe(1);
    const asset = parsed.payload.portfolio.assets[0];
    expect(asset.address).toBe('12 Example Road');
    expect(asset.ownershipEntity).toBe('Smith Family Trust');
    expect(asset.assetType).toBe('industrial');
    expect(asset.currentValue).toBe(3_000_000);
  });

  it('imports liabilities and preserves the contingent flag', () => {
    const workbook = buildIntakeWorkbook({ generatedAt: AS_AT });
    addTableRow(workbook, '5b. Liabilities', {
      'liability.description': 'Director guarantee', 'liability.liabilityType': 'Guarantee',
      'liability.balance': 400_000, 'liability.isContingent': 'Yes',
    });
    const parsed = roundTrip(workbook);
    expect(parsed.payload.portfolio.liabilities[0].isContingent).toBe(true);
    expect(parsed.payload.portfolio.liabilities[0].liabilityType).toBe('guarantee');
  });

  it('links add-backs to their period by label', () => {
    const workbook = buildIntakeWorkbook({ generatedAt: AS_AT });
    addTableRow(workbook, '4. Income', {
      'period.label': 'FY2025', 'period.periodEnd': '2025-06-30', 'period.ebitda': 620_000,
    });
    addTableRow(workbook, '4b. Add-backs', {
      'addback.periodLabel': 'FY2025', 'addback.category': 'One-off / non-recurring',
      'addback.amount': 45_000, 'addback.reason': 'Settled legal dispute, will not recur.',
      'addback.source': 'FY2025 statements note 7', 'addback.confirmed': 'Yes',
    });

    const parsed = roundTrip(workbook);
    expect(parsed.counts.addbacks).toBe(1);
    expect(parsed.payload.income.addbacks[0].periodId).toBe(parsed.payload.income.periods[0].id);
    expect(parsed.payload.income.addbacks[0].confirmed).toBe(true);
  });

  it('flags an add-back whose period does not exist', () => {
    const workbook = buildIntakeWorkbook({ generatedAt: AS_AT });
    addTableRow(workbook, '4. Income', { 'period.label': 'FY2025', 'period.periodEnd': '2025-06-30' });
    addTableRow(workbook, '4b. Add-backs', {
      'addback.periodLabel': 'FY2019', 'addback.amount': 10_000,
      'addback.reason': 'x', 'addback.source': 'y',
    });
    const parsed = roundTrip(workbook);
    expect(parsed.issues.some((issue) => issue.message.includes('FY2019'))).toBe(true);
  });

  it('imports tenancies for the property being acquired', () => {
    const workbook = buildIntakeWorkbook({ generatedAt: AS_AT });
    addTableRow(workbook, '6. Tenancies', {
      'tenancy.tenantName': 'National Logistics Pty Ltd', 'tenancy.annualRent': 350_000,
      'tenancy.leaseExpiry': '2031-01-01', 'tenancy.tenantQuality': 'National tenant',
    });
    const parsed = roundTrip(workbook);
    expect(parsed.payload.lease.tenancies[0].tenantName).toBe('National Logistics Pty Ltd');
    expect(parsed.payload.lease.tenancies[0].tenantQuality).toBe('national');
  });
});

// ---------------------------------------------------------------------------
// Robustness — how people actually fill in spreadsheets
// ---------------------------------------------------------------------------

describe('value decoding', () => {
  it('accepts money written the way people type it', () => {
    expect(decodeNumber('$1,250,000')).toBe(1_250_000);
    expect(decodeNumber('1.25m')).toBe(1_250_000);
    expect(decodeNumber('850k')).toBe(850_000);
    expect(decodeNumber('(500)')).toBe(-500);
    expect(decodeNumber('  7.25 % ')).toBe(7.25);
    expect(decodeNumber('')).toBeUndefined();
    expect(decodeNumber('not a number')).toBeUndefined();
  });

  it('reads Australian day-first dates without shifting the month', () => {
    expect(decodeDate('03/08/2026')).toBe('2026-08-03');
    expect(decodeDate('3.8.2026')).toBe('2026-08-03');
    expect(decodeDate('2026-08-03')).toBe('2026-08-03');
    expect(decodeDate(new Date(2026, 7, 3))).toBe('2026-08-03');
    expect(decodeDate('rubbish')).toBeUndefined();
  });

  it('keeps "not yet known" distinct from "no"', () => {
    expect(decodeTriState('Yes')).toBe(true);
    expect(decodeTriState('No')).toBe(false);
    expect(decodeTriState('Not yet known')).toBeNull();
    expect(decodeTriState('')).toBeUndefined();
  });

  it('treats a fractional percentage as a percentage', () => {
    expect(decodeValue('asset.interestRate', 'percent', 0.065)).toBeCloseTo(6.5, 5);
    expect(decodeValue('asset.interestRate', 'percent', 6.5)).toBe(6.5);
  });

  it('writes zero as blank so the pack reads as an empty form', () => {
    expect(encodeValue('property.stampDuty', 'money', 0)).toBe('');
    expect(encodeValue('property.stampDuty', 'money', 275_000)).toBe(275_000);
  });

  it('rejects an implausible figure rather than importing it', () => {
    const workbook = buildIntakeWorkbook({ generatedAt: AS_AT });
    setScalar(workbook, '1. Transaction', 'property.purchasePrice', 99_000_000_000);
    const parsed = roundTrip(workbook);
    expect(parsed.payload.property.purchasePrice).toBe(0);
    expect(parsed.issues.some((issue) => issue.severity === 'error')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pre-fill and end-to-end
// ---------------------------------------------------------------------------

describe('pre-filled pack', () => {
  function populated(): AssessmentPayload {
    const payload = emptyAssessmentPayload('industrial_investment');
    payload.property.address = '45 Industrial Drive';
    payload.property.purchasePrice = 5_000_000;
    payload.loan.requestedLoan = 3_250_000;
    payload.loan.actualRatePercent = 6.75;
    payload.ownership.entities = [{
      id: 'entity-1', entityName: 'Smith Family Trust', structure: 'trust',
      abnAcn: '12 345 678 901', ownershipPercent: 100, directors: '',
      trustees: 'Smith Holdings Pty Ltd', beneficiaries: 'Jane Smith',
      isGuarantor: true, relatedEntities: '', yearsTrading: 8, industry: 'Logistics',
      borrowerExperience: 'experienced', residency: 'australian',
      taxResidency: 'australian', beneficialOwnership: 'Jane Smith 100%',
    }];
    return payload;
  }

  it('pre-fills an existing assessment and reads it straight back', () => {
    const parsed = roundTrip(buildIntakeWorkbook({ payload: populated(), generatedAt: AS_AT }));

    expect(parsed.payload.property.address).toBe('45 Industrial Drive');
    expect(parsed.payload.property.purchasePrice).toBe(5_000_000);
    expect(parsed.payload.loan.requestedLoan).toBe(3_250_000);
    expect(parsed.counts.entities).toBe(1);
    expect(parsed.payload.ownership.entities[0].structure).toBe('trust');
    expect(parsed.payload.ownership.entities[0].trustees).toBe('Smith Holdings Pty Ltd');
  });

  it('marks every imported value as requiring confirmation', () => {
    const parsed = roundTrip(buildIntakeWorkbook({ payload: populated(), generatedAt: AS_AT }));
    expect(parsed.provenance.length).toBeGreaterThan(0);
    parsed.provenance.forEach((entry) => {
      expect(entry.requiresConfirmation).toBe(true);
      expect(entry.source).toBe('document_import');
    });
  });

  it('produces a payload the engine can calculate without throwing', () => {
    const parsed = roundTrip(buildIntakeWorkbook({ payload: populated(), generatedAt: AS_AT }));
    expect(() => runAssessment(parsed.payload, { asAt: AS_AT })).not.toThrow();
  });

  it('carries the assessment reference back for matching', () => {
    const parsed = roundTrip(buildIntakeWorkbook({
      assessmentReference: 'CI-202608-X9K9U', generatedAt: AS_AT,
    }));
    expect(parsed.assessmentReference).toBe('CI-202608-X9K9U');
  });
});
