/**
 * Intake-pack parser.
 *
 * Reads a returned workbook back into a partial `AssessmentPayload`.
 *
 * Two principles govern this file:
 *
 *  1. **Nothing is trusted.** Every value is decoded, range-checked and
 *     attributed to a source. The result is staged for human review, never
 *     written straight over data somebody already entered.
 *  2. **Match by key, not position.** Rows and columns are located by the
 *     stable field key written into the sheet, so inserting rows, sorting a
 *     table or rewording a label cannot silently shift a value into the wrong
 *     field — the failure mode that makes spreadsheet imports dangerous.
 */

import * as XLSX from 'xlsx';
import {
  ALL_PACK_FIELDS, PACK_SECTIONS, type PackField, type PackSection,
} from './schema';
import { decodeValue } from './values';
import { INSTRUCTIONS_SHEET, PACK_MAGIC } from './workbook';
import {
  emptyAssessmentPayload, hydrateAssessmentPayload,
  type AssessmentPayload, type FieldProvenance,
} from '../types';

export interface ParsedFieldValue {
  key: string;
  label: string;
  /** Section title, for grouping in the review UI. */
  section: string;
  step: number;
  path: string;
  value: unknown;
  /** What the sheet actually held, shown when a value could not be decoded. */
  raw: unknown;
  /** Row/collection index for table sections. */
  rowIndex?: number;
}

export interface ParseIssue {
  severity: 'warning' | 'error';
  sheet: string;
  message: string;
}

export interface ParsedPack {
  /** False when the file is not one of our packs at all. */
  recognised: boolean;
  formatVersion: string | null;
  assessmentReference: string | null;
  /** A payload built from the pack, ready to be reviewed and applied. */
  payload: AssessmentPayload;
  /** Flat list of everything read, for the review table. */
  values: ParsedFieldValue[];
  provenance: FieldProvenance[];
  issues: ParseIssue[];
  counts: {
    fields: number;
    entities: number;
    incomePeriods: number;
    addbacks: number;
    portfolioAssets: number;
    liabilities: number;
    tenancies: number;
  };
}

const MAX_TABLE_ROWS = 250;

/** Read a sheet as a dense 2-D array, preserving blanks so indices line up. */
function sheetRows(workbook: XLSX.WorkBook, name: string): unknown[][] {
  const sheet = workbook.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1, defval: '', blankrows: true, raw: true,
  });
}

/** Locate a sheet tolerantly — users rename tabs, and Excel trims stray spaces. */
function findSheetName(workbook: XLSX.WorkBook, wanted: string): string | undefined {
  const normalise = (value: string) => value.trim().toLowerCase();
  const target = normalise(wanted);
  const exact = workbook.SheetNames.find((name) => normalise(name) === target);
  if (exact) return exact;
  // Fall back to the leading section number ("3." in "3. Ownership"), which
  // survives someone renaming "Ownership" to "Borrowers".
  const prefix = target.split(' ')[0];
  if (!prefix || !/^\d/.test(prefix)) return undefined;
  return workbook.SheetNames.find((name) => normalise(name).startsWith(prefix));
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let node = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (typeof node[segment] !== 'object' || node[segment] === null) node[segment] = {};
    node = node[segment] as Record<string, unknown>;
  }
  node[segments[segments.length - 1]] = value;
}

/** Range sanity per field type. Keeps a typo from becoming a $50bn valuation. */
function rangeIssue(field: PackField, value: unknown): string | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return 'is not a finite number';
  if (field.type === 'percent' && (value < -100 || value > 1000)) {
    return `looks wrong as a percentage (${value})`;
  }
  if (field.type === 'money' && Math.abs(value) > 10_000_000_000) {
    return `is implausibly large (${value})`;
  }
  if (field.type === 'number' && Math.abs(value) > 1_000_000_000) {
    return `is implausibly large (${value})`;
  }
  return null;
}

function parseSingleSheet(
  workbook: XLSX.WorkBook, section: PackSection,
  collect: (value: ParsedFieldValue) => void, issues: ParseIssue[],
): void {
  const sheetName = findSheetName(workbook, section.sheetName);
  if (!sheetName) {
    issues.push({
      severity: 'warning', sheet: section.sheetName,
      message: `Sheet "${section.sheetName}" was not found — nothing imported from it.`,
    });
    return;
  }

  const rows = sheetRows(workbook, sheetName);
  rows.forEach((row) => {
    const key = String(row?.[0] ?? '').trim();
    if (!key || !ALL_PACK_FIELDS.has(key)) return;

    const entry = ALL_PACK_FIELDS.get(key)!;
    // Only accept keys that belong to this sheet, so a stray paste of another
    // sheet's rows cannot inject values under the wrong section.
    if (entry.section.id !== section.id) return;

    const raw = row?.[2];
    if (raw == null || String(raw).trim() === '') return;

    const value = decodeValue(key, entry.field.type, raw);
    if (value === undefined) {
      issues.push({
        severity: 'warning', sheet: sheetName,
        message: `"${entry.field.label}" could not be read from "${String(raw)}" — left unset.`,
      });
      return;
    }

    const problem = rangeIssue(entry.field, value);
    if (problem) {
      issues.push({
        severity: 'error', sheet: sheetName,
        message: `"${entry.field.label}" ${problem} — left unset. Check the cell.`,
      });
      return;
    }

    collect({
      key, label: entry.field.label, section: section.title, step: section.step,
      path: entry.field.path, value, raw,
    });
  });
}

function parseTableSheet(
  workbook: XLSX.WorkBook, section: PackSection,
  collect: (value: ParsedFieldValue) => void, issues: ParseIssue[],
): Record<string, unknown>[] {
  const sheetName = findSheetName(workbook, section.sheetName);
  if (!sheetName) {
    issues.push({
      severity: 'warning', sheet: section.sheetName,
      message: `Sheet "${section.sheetName}" was not found — nothing imported from it.`,
    });
    return [];
  }

  const rows = sheetRows(workbook, sheetName);

  // Find the header row by looking for one whose cells are known field keys.
  // Scanning rather than assuming row 3 means an extra title line inserted by
  // a user does not break the import.
  let headerIndex = -1;
  for (let index = 0; index < Math.min(rows.length, 12); index += 1) {
    const matches = (rows[index] ?? []).filter(
      (cell) => ALL_PACK_FIELDS.get(String(cell ?? '').trim())?.section.id === section.id,
    ).length;
    if (matches >= 2) { headerIndex = index; break; }
  }

  if (headerIndex === -1) {
    issues.push({
      severity: 'warning', sheet: sheetName,
      message: `Could not find the field-key header row on "${sheetName}". `
        + 'That row must be left intact for the upload to map columns.',
    });
    return [];
  }

  const header = rows[headerIndex] ?? [];
  const columns = header.map((cell) => {
    const key = String(cell ?? '').trim();
    const entry = ALL_PACK_FIELDS.get(key);
    return entry && entry.section.id === section.id ? entry.field : null;
  });

  // Row after the header is the human-label row the generator writes; skip it
  // only when it does not itself look like data.
  const firstDataIndex = headerIndex + 2;
  const items: Record<string, unknown>[] = [];

  for (let rowIndex = firstDataIndex; rowIndex < rows.length; rowIndex += 1) {
    if (items.length >= MAX_TABLE_ROWS) {
      issues.push({
        severity: 'warning', sheet: sheetName,
        message: `Only the first ${MAX_TABLE_ROWS} rows were imported.`,
      });
      break;
    }

    const row = rows[rowIndex] ?? [];
    const item: Record<string, unknown> = {};
    let populated = false;

    columns.forEach((field, columnIndex) => {
      if (!field) return;
      const raw = row[columnIndex];
      if (raw == null || String(raw).trim() === '') return;

      const value = decodeValue(field.key, field.type, raw);
      if (value === undefined) {
        issues.push({
          severity: 'warning', sheet: sheetName,
          message: `Row ${rowIndex + 1}: "${field.label}" could not be read from "${String(raw)}".`,
        });
        return;
      }

      const problem = rangeIssue(field, value);
      if (problem) {
        issues.push({
          severity: 'error', sheet: sheetName,
          message: `Row ${rowIndex + 1}: "${field.label}" ${problem} — left unset.`,
        });
        return;
      }

      setPath(item, field.path, value);
      populated = true;
      collect({
        key: field.key, label: field.label, section: section.title, step: section.step,
        path: field.path, value, raw, rowIndex: items.length,
      });
    });

    // A row is only an item if the user actually wrote something in it. Blank
    // template rows must not become empty entities and liabilities.
    if (populated) items.push(item);
  }

  return items;
}

/** Stable-ish ids for imported rows, derived from the sheet position. */
function makeId(prefix: string, index: number): string {
  return `${prefix}-import-${index + 1}`;
}

export function parseIntakeWorkbook(workbook: XLSX.WorkBook): ParsedPack {
  const issues: ParseIssue[] = [];
  const values: ParsedFieldValue[] = [];
  const collect = (value: ParsedFieldValue) => values.push(value);

  // ---- Recognise the file -------------------------------------------------
  const instructionsName = findSheetName(workbook, INSTRUCTIONS_SHEET);
  let recognised = false;
  let formatVersion: string | null = null;
  let assessmentReference: string | null = null;

  if (instructionsName) {
    sheetRows(workbook, instructionsName).forEach((row) => {
      const marker = String(row?.[0] ?? '').trim();
      const value = String(row?.[1] ?? '').trim();
      if (marker === '__pack_format' && value === PACK_MAGIC) recognised = true;
      if (marker === '__pack_version') formatVersion = value || null;
      if (marker === '__assessment_reference') assessmentReference = value || null;
    });
  }

  // A workbook without the marker may still be a pack whose first sheet was
  // deleted. Fall back to recognising it by its section sheets rather than
  // rejecting work someone has already done.
  if (!recognised) {
    const knownSheets = PACK_SECTIONS.filter(
      (section) => findSheetName(workbook, section.sheetName),
    ).length;
    if (knownSheets >= 3) {
      recognised = true;
      issues.push({
        severity: 'warning', sheet: INSTRUCTIONS_SHEET,
        message: 'The "Start here" sheet is missing or altered, so this pack could not be '
          + 'matched to an assessment. The data sheets were read normally.',
      });
    }
  }

  const payload = emptyAssessmentPayload();

  if (!recognised) {
    return {
      recognised: false, formatVersion, assessmentReference, payload,
      values: [], provenance: [],
      issues: [{
        severity: 'error', sheet: '—',
        message: 'This file does not look like a Commercial & Industrial intake pack. '
          + 'Download a fresh pack and use that, or enter the details directly.',
      }],
      counts: {
        fields: 0, entities: 0, incomePeriods: 0, addbacks: 0,
        portfolioAssets: 0, liabilities: 0, tenancies: 0,
      },
    };
  }

  // ---- Key/value sections -------------------------------------------------
  const scalar: Record<string, unknown> = {};
  PACK_SECTIONS.filter((section) => section.shape === 'single').forEach((section) => {
    const before = values.length;
    parseSingleSheet(workbook, section, collect, issues);
    values.slice(before).forEach((entry) => setPath(scalar, entry.path, entry.value));
  });

  // ---- Table sections -----------------------------------------------------
  const tables = new Map<string, Record<string, unknown>[]>();
  PACK_SECTIONS.filter((section) => section.shape === 'table').forEach((section) => {
    tables.set(section.id, parseTableSheet(workbook, section, collect, issues));
  });

  // ---- Assemble the payload ----------------------------------------------
  const base = emptyAssessmentPayload(
    (scalar.assessmentType as AssessmentPayload['assessmentType']) ?? 'commercial_investment',
  );

  const entities = (tables.get('ownership') ?? []).map((row, index) => ({
    ...base.ownership.entities[0],
    id: makeId('entity', index),
    entityName: '', structure: 'company' as const, abnAcn: '', ownershipPercent: 0,
    directors: '', trustees: '', beneficiaries: '', isGuarantor: false,
    relatedEntities: '', yearsTrading: 0, industry: '',
    borrowerExperience: 'some' as const, residency: 'australian' as const,
    taxResidency: 'australian' as const, beneficialOwnership: '',
    ...row,
  }));

  const periods = (tables.get('incomePeriods') ?? []).map((row, index) => ({
    id: makeId('period', index),
    label: '', periodEnd: '', basis: 'financial_statements' as const,
    verification: 'unverified' as const,
    salaryWages: 0, businessRevenue: 0, ebitda: 0, ebit: 0, npat: 0,
    depreciation: 0, interestExpense: 0, directorRemuneration: 0,
    distributions: 0, rentReceived: 0, dividends: 0,
    otherRecurringIncome: 0, nonRecurringIncome: 0,
    ...row,
  }));

  // Add-backs reference their period by the label the user typed, so resolve
  // that to the generated period id. An add-back pointing at a period that is
  // not on the income sheet is reported rather than silently dropped.
  const addbacks = (tables.get('addbacks') ?? []).map((row, index) => {
    const periodLabel = String(row.periodLabel ?? '').trim();
    const match = periods.find(
      (period) => String(period.label).trim().toLowerCase() === periodLabel.toLowerCase(),
    );
    if (!match && periodLabel) {
      issues.push({
        severity: 'warning', sheet: '4b. Add-backs',
        message: `Add-back row ${index + 1} refers to period "${periodLabel}", which is not on `
          + 'the Income sheet. It was attached to the most recent period instead — check it.',
      });
    }
    const { periodLabel: _ignored, ...rest } = row;
    return {
      id: makeId('addback', index),
      periodId: match?.id ?? periods[0]?.id ?? '',
      category: 'one_off' as const, amount: 0, reason: '', source: '', confirmed: false,
      ...rest,
    };
  }).filter((addback) => {
    if (!addback.periodId) {
      issues.push({
        severity: 'warning', sheet: '4b. Add-backs',
        message: 'An add-back was dropped because no financial periods were supplied.',
      });
      return false;
    }
    return true;
  });

  const assets = (tables.get('portfolio') ?? []).map((row, index) => ({
    id: makeId('asset', index),
    address: '', ownershipEntity: '', ownershipPercent: 100,
    assetType: 'commercial' as const, currentValue: 0, valuationDate: '',
    existingLender: '', currentBalance: 0, facilityLimit: 0, interestRate: 0,
    repaymentType: 'principalAndInterest' as const, remainingTermYears: 20,
    annualRepayments: null, annualRent: 0, leaseExpiry: '', vacancyPercent: 0,
    outgoings: 0, managementCosts: 0, rates: 0, insurance: 0, maintenance: 0,
    capitalExpenditure: 0, crossCollateralised: false, clientPropertyId: null,
    ...row,
  }));

  const liabilities = (tables.get('liabilities') ?? []).map((row, index) => ({
    id: makeId('liability', index),
    description: '', liabilityType: 'commercial_facility' as const,
    ownershipEntity: '', lender: '', balance: 0, limit: 0, interestRate: 0,
    repaymentType: 'principalAndInterest' as const, remainingTermYears: 5,
    annualRepayments: null, isContingent: false,
    securedAgainstAssetId: null, clientLiabilityId: null,
    ...row,
  }));

  const tenancies = (tables.get('tenancies') ?? []).map((row, index) => ({
    id: makeId('tenancy', index),
    tenantName: '', areaSqm: 0, annualRent: 0, leaseCommencement: '',
    leaseExpiry: '', optionsYears: 0, annualEscalationPercent: 0,
    tenantQuality: 'unknown' as const, verification: 'unverified' as const,
    ...row,
  }));

  const scalarProperty = (scalar.property ?? {}) as Record<string, unknown>;
  const scalarLoan = (scalar.loan ?? {}) as Record<string, unknown>;
  const scalarLease = (scalar.lease ?? {}) as Record<string, unknown>;
  const scalarOwnership = (scalar.ownership ?? {}) as Record<string, unknown>;

  const assembled = hydrateAssessmentPayload({
    ...base,
    assessmentType: (scalar.assessmentType as AssessmentPayload['assessmentType']) ?? base.assessmentType,
    property: { ...base.property, ...scalarProperty },
    ownership: { ...base.ownership, ...scalarOwnership, entities },
    income: { ...base.income, periods, addbacks },
    portfolio: { ...base.portfolio, assets, liabilities },
    lease: { ...base.lease, ...scalarLease, tenancies },
    loan: { ...base.loan, ...scalarLoan },
  });

  // ---- Cross-sheet sanity -------------------------------------------------
  const entityNames = new Set(
    entities.map((entity) => String(entity.entityName ?? '').trim().toLowerCase()).filter(Boolean),
  );
  if (entityNames.size) {
    [...assets, ...liabilities].forEach((row) => {
      const owner = String((row as { ownershipEntity?: string }).ownershipEntity ?? '').trim();
      if (owner && !entityNames.has(owner.toLowerCase())) {
        issues.push({
          severity: 'warning', sheet: '5. Portfolio / 5b. Liabilities',
          message: `"${owner}" is named as an owner but is not on the Ownership sheet. `
            + 'Add the entity so the group position attributes correctly.',
        });
      }
    });
  }

  const ownershipTotal = entities.reduce(
    (sum, entity) => sum + (Number(entity.ownershipPercent) || 0), 0,
  );
  if (entities.length && Math.abs(ownershipTotal - 100) > 0.5) {
    issues.push({
      severity: 'warning', sheet: '3. Ownership',
      message: `Ownership percentages total ${ownershipTotal.toFixed(1)}%. They must total 100%.`,
    });
  }

  // ---- Provenance ---------------------------------------------------------
  const capturedAt = new Date().toISOString();
  const provenance: FieldProvenance[] = values.map((entry) => ({
    field: entry.rowIndex == null ? entry.path : `${entry.section}[${entry.rowIndex}].${entry.path}`,
    source: 'document_import',
    sourceRef: 'Intake pack workbook',
    requiresConfirmation: true,
    capturedAt,
  }));

  return {
    recognised: true,
    formatVersion,
    assessmentReference,
    payload: { ...assembled, provenance },
    values,
    provenance,
    issues,
    counts: {
      fields: values.length,
      entities: entities.length,
      incomePeriods: periods.length,
      addbacks: addbacks.length,
      portfolioAssets: assets.length,
      liabilities: liabilities.length,
      tenancies: tenancies.length,
    },
  };
}

/** Parse from raw file bytes. */
export function parseIntakeFile(data: ArrayBuffer): ParsedPack {
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });
  return parseIntakeWorkbook(workbook);
}
