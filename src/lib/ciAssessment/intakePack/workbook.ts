/**
 * Intake-pack workbook generator.
 *
 * Produces the editable spreadsheet an organisation hands to (or fills in with)
 * a prospective client, then drops back into the assessment workspace.
 *
 * Layout contract — the parser depends on this and the round-trip tests pin it:
 *
 *   Key/value sheets   row 1 = title, row 2 = intro, row 3 = column headers,
 *                      rows 4+ = [fieldKey, label, value, guidance]
 *   Table sheets       row 1 = title, row 2 = intro, row 3 = FIELD KEYS,
 *                      row 4 = human labels, rows 5+ = data
 *
 * Field keys always live in the sheet, never off it. A hidden column would be
 * lost the moment someone copies the data into a fresh workbook — which is
 * exactly what people do — so the keys are visible and simply labelled as
 * "do not edit".
 */

import * as XLSX from 'xlsx';
import {
  BLANK_TABLE_ROWS,
  PACK_SECTIONS,
  type PackField,
  type PackSection,
} from './schema';
import { encodeValue } from './values';
import { DEFAULT_PACK_BRANDING, type PackBranding } from './branding';
import type { AssessmentPayload } from '../types';

/** Marker cell so the parser can recognise one of our packs with confidence. */
export const PACK_MAGIC = 'NPC-CI-INTAKE-PACK';
export const PACK_FORMAT_VERSION = '1';
export const INSTRUCTIONS_SHEET = 'Start here';
export const PROCEED_SHEET = '7. Proceed';

/** Column headings on a key/value sheet. */
const KV_HEADERS = ['Field key (do not edit)', 'Question', 'Answer', 'Guidance'];

export interface BuildPackOptions {
  branding?: PackBranding;
  /** Existing assessment values, pre-filled so the pack doubles as a review sheet. */
  payload?: AssessmentPayload;
  assessmentReference?: string;
  assessmentTitle?: string;
  /** Injected for deterministic tests. */
  generatedAt?: Date;
}

/** Read a dotted path out of an object without throwing on a missing branch. */
function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, segment) => {
    if (node == null || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[segment];
  }, source);
}

function guidanceFor(field: PackField): string {
  const parts: string[] = [];
  if (field.help) parts.push(field.help);
  if (field.options?.length) parts.push(`Options: ${field.options.join(' | ')}`);
  if (field.optional) parts.push('Optional.');
  return parts.join(' ');
}

function buildInstructionsSheet(
  branding: PackBranding,
  options: BuildPackOptions,
  generatedAt: Date,
): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    [`${branding.companyName} — Commercial & Industrial finance intake pack`],
    [],
    ['This workbook collects everything needed to assess a commercial or industrial finance transaction.'],
    ['Complete what you can with the client, then drag this file back into the assessment workspace.'],
    [],
    ['How to use it'],
    ['1.', 'Work through the numbered sheets in order. Each row is a question to ask.'],
    ['2.', 'Type answers in the "Answer" column, or add one row per item on the table sheets.'],
    ['3.', 'Leave anything you do not know blank — a blank is safer than a guess.'],
    ['4.', 'Do not edit the "Field key" column or rename the sheets. That is how the upload maps back.'],
    ['5.', 'Save the file, then drop it onto the assessment workspace to populate the assessment.'],
    [],
    ['A note on structures'],
    ['Individuals, trusts and self-managed super funds buy commercial and industrial property just as'],
    ['often as companies do. On the Ownership sheet, record the structure exactly as it will appear on'],
    ['the contract, including trustees and fund members. On the Portfolio and Liabilities sheets, name'],
    ['the entity that holds each asset and debt. That is what lets the assessment work out the whole'],
    ['group position rather than one deal in isolation.'],
    [],
    ['Nothing in this pack is a credit approval, an offer of finance, or financial or legal advice.'],
    [],
    ['Pack details'],
    ['Assessment', options.assessmentTitle ?? 'New assessment'],
    ['Reference', options.assessmentReference ?? '—'],
    ['Generated', generatedAt.toLocaleDateString('en-AU')],
    ['Prepared by', branding.companyName],
    [],
    // Machine-readable markers, kept together at the bottom.
    ['__pack_format', PACK_MAGIC],
    ['__pack_version', PACK_FORMAT_VERSION],
    ['__assessment_reference', options.assessmentReference ?? ''],
  ];
  if (branding.footerNote) rows.push([], [branding.footerNote]);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 26 }, { wch: 78 }];
  return sheet;
}

function buildSingleSheet(section: PackSection, options: BuildPackOptions): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    [section.title],
    [section.intro],
    KV_HEADERS,
  ];

  section.fields.forEach((field) => {
    const current = options.payload ? readPath(options.payload, field.path) : undefined;
    rows.push([
      field.key,
      field.question,
      encodeValue(field.key, field.type, current),
      guidanceFor(field),
    ]);
  });

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 34 }, { wch: 62 }, { wch: 24 }, { wch: 60 }];
  // Freeze the header rows so the question stays visible while scrolling.
  sheet['!freeze'] = { xSplit: 0, ySplit: 3 };
  return sheet;
}

function buildTableSheet(section: PackSection, options: BuildPackOptions): XLSX.WorkSheet {
  const keys = section.fields.map((field) => field.key);
  const labels = section.fields.map((field) => (
    field.optional ? field.label : `${field.label} *`
  ));

  const rows: (string | number)[][] = [
    [section.title],
    [section.intro],
    keys,
    labels,
  ];

  // Pre-fill from an existing assessment where one is supplied.
  const existing = section.collectionPath
    ? (readPath(options.payload, section.collectionPath) as unknown[] | undefined)
    : undefined;

  (existing ?? []).forEach((item) => {
    rows.push(section.fields.map((field) => (
      encodeValue(field.key, field.type, readPath(item, field.path))
    )));
  });

  // Leave room to write. A form with no blank lines invites people to work
  // around it in a separate document, which defeats the round-trip entirely.
  const blanks = Math.max(BLANK_TABLE_ROWS - (existing?.length ?? 0), 3);
  for (let index = 0; index < blanks; index += 1) {
    rows.push(section.fields.map(() => ''));
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = section.fields.map((field) => ({
    wch: field.type === 'longtext' ? 48 : Math.max(16, Math.min(34, field.label.length + 6)),
  }));
  sheet['!freeze'] = { xSplit: 0, ySplit: 4 };
  return sheet;
}

/**
 * The proceed sheet.
 *
 * Captured as free text rather than parsed back into the payload — a decision
 * to proceed is a commercial conversation, and the workspace asks for it again
 * explicitly before anything is linked to a client record.
 */
function buildProceedSheet(branding: PackBranding): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    ['Next steps'],
    ['Complete this with the client once the figures above have been discussed.'],
    [],
    ['Question', 'Answer'],
    ['Does the client wish to proceed with a finance application?', ''],
    ['If yes, what is the preferred settlement timeframe?', ''],
    ['Which lender or lenders have they already approached, if any?', ''],
    ['Is there an existing broker or adviser involved?', ''],
    ['What conditions or concerns do they want addressed first?', ''],
    ['Who is the primary contact, and what is the best number and email?', ''],
    [],
    ['Supporting documents to collect'],
    ['Bring these back with the completed pack. Drop them into the workspace alongside this file.'],
    ['☐', 'Contract of sale or heads of agreement'],
    ['☐', 'Current lease(s) and any rent roll'],
    ['☐', 'Last two years of financial statements and tax returns'],
    ['☐', 'Most recent notices of assessment'],
    ['☐', 'Trust deed or SMSF trust deed and investment strategy, where applicable'],
    ['☐', 'Company constitution and ASIC extract, where applicable'],
    ['☐', 'Rates and insurance notices for the property'],
    ['☐', 'Statements for existing loans, cards and equipment finance'],
    ['☐', 'Identification for every borrower, director, trustee and guarantor'],
    [],
    ['Declaration'],
    ['The information recorded in this pack has been provided by the client and is, to the best of'],
    ['their knowledge, accurate at the date below. It will be verified against source documents'],
    ['before any finance application is made.'],
    [],
    ['Client name', ''],
    ['Signature', ''],
    ['Date', ''],
    [`Completed by (${branding.companyName})`, ''],
    [],
    ['This pack is an information-gathering tool. It is not a credit approval, an offer of finance,'],
    ['financial advice or legal advice.'],
  ];

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 62 }, { wch: 50 }];
  return sheet;
}

/** Build the complete workbook. */
export function buildIntakeWorkbook(options: BuildPackOptions = {}): XLSX.WorkBook {
  const branding = options.branding ?? DEFAULT_PACK_BRANDING;
  const generatedAt = options.generatedAt ?? new Date();
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook, buildInstructionsSheet(branding, options, generatedAt), INSTRUCTIONS_SHEET,
  );

  PACK_SECTIONS.forEach((section) => {
    const sheet = section.shape === 'table'
      ? buildTableSheet(section, options)
      : buildSingleSheet(section, options);
    // Excel rejects sheet names over 31 characters; the schema keeps them
    // short, but truncate defensively rather than throwing at download time.
    XLSX.utils.book_append_sheet(workbook, sheet, section.sheetName.slice(0, 31));
  });

  XLSX.utils.book_append_sheet(workbook, buildProceedSheet(branding), PROCEED_SHEET);
  return workbook;
}

/** Serialise the workbook to a Blob for download. */
export function workbookToBlob(workbook: XLSX.WorkBook): Blob {
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([output], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** A filesystem-safe, human-recognisable filename. */
export function packFileName(
  branding: PackBranding,
  reference: string | undefined,
  extension: 'xlsx' | 'docx',
): string {
  const company = branding.companyName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  const ref = (reference ?? 'assessment').replace(/[^a-z0-9-]+/gi, '-');
  return `${company}-CI-intake-${ref}.${extension}`;
}
