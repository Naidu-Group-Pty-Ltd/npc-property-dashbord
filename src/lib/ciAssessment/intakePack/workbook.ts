/**
 * Intake-pack workbook generator.
 *
 * Produces the branded, editable spreadsheet an organisation takes to a client
 * meeting and drops back into the assessment workspace afterwards.
 *
 * Built with ExcelJS rather than SheetJS. SheetJS's community build cannot
 * write cell styles, embed images or declare data validation — a fill set on a
 * cell comes back `patternType: "none"` after a write — so a white-labelled,
 * dropdown-driven workbook is simply not expressible through it. ExcelJS is
 * loaded on demand so it stays out of the main bundle and only costs the user
 * who actually downloads a pack.
 *
 * The file is still read back by SheetJS in `parseWorkbook.ts`. Both speak
 * standard xlsx, and the round-trip tests write with ExcelJS and read with
 * SheetJS precisely to keep that guarantee honest.
 *
 * LAYOUT CONTRACT — the parser depends on this and the tests pin it:
 *
 *   Key/value sheets   the row whose first cell is a known field key holds the
 *                      answer in column C
 *   Table sheets       one row is entirely field keys; the row below it is
 *                      human labels; data follows
 *
 * Field keys are written into the sheet and left visible. A hidden column is
 * lost the moment somebody copies the data into a fresh workbook — which is
 * what people do — so the column is present and simply labelled "do not edit".
 */

import type ExcelJS from 'exceljs';
import {
  BLANK_TABLE_ROWS, PACK_SECTIONS, type PackField, type PackSection,
} from './schema';
import { encodeValue } from './values';
import {
  DEFAULT_PACK_BRANDING, argb, bareHex, fitLogo, type PackBranding,
} from './branding';
import type { AssessmentPayload } from '../types';

/** Marker so the parser can recognise one of our packs with confidence. */
export const PACK_MAGIC = 'NPC-CI-INTAKE-PACK';
export const PACK_FORMAT_VERSION = '2';
export const INSTRUCTIONS_SHEET = 'Start here';
export const PROCEED_SHEET = '7. Proceed';

const KV_HEADERS = ['Field key (do not edit)', 'Question', 'Answer', 'Guidance'];

/** Neutral greys for rules and secondary text. Office cannot resolve CSS tokens. */
const INK = '111827';
const MUTED = '6B7280';
const HAIRLINE = 'D1D5DB';
const PAPER = 'FFFFFF';
const TINT = 'F3F4F6';

export interface BuildPackOptions {
  branding?: PackBranding;
  payload?: AssessmentPayload;
  assessmentReference?: string;
  assessmentTitle?: string;
  generatedAt?: Date;
}

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

/** Number format per field type, so Excel treats money as money. */
function numberFormat(field: PackField): string | undefined {
  switch (field.type) {
    case 'money': return '#,##0';
    case 'percent': return '0.00';
    case 'date': return 'dd/mm/yyyy';
    default: return undefined;
  }
}

/**
 * Excel's list validation is delivered inline and has a hard ~255-character
 * limit. Longer option sets are left free-text with the choices in the guidance
 * column rather than producing a file Excel declares corrupt on open.
 */
function applyValidation(cell: ExcelJS.Cell, field: PackField): void {
  if (!field.options?.length) return;
  const formula = `"${field.options.join(',')}"`;
  if (formula.length > 255) return;
  // A comma inside an option would split it into two list entries.
  if (field.options.some((option) => option.includes(','))) return;

  cell.dataValidation = {
    type: 'list',
    allowBlank: true,
    formulae: [formula],
    showErrorMessage: false,
  };
}

function titleRow(
  sheet: ExcelJS.Worksheet, row: number, text: string, branding: PackBranding, span: number,
): void {
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  cell.font = { bold: true, size: 15, color: { argb: argb(branding.brandHex) } };
  sheet.getRow(row).height = 22;
  if (span > 1) sheet.mergeCells(row, 1, row, span);
}

function introRow(sheet: ExcelJS.Worksheet, row: number, text: string, span: number): void {
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  cell.font = { size: 10, italic: true, color: { argb: argb(`#${MUTED}`) } };
  cell.alignment = { wrapText: true, vertical: 'top' };
  sheet.getRow(row).height = 30;
  if (span > 1) sheet.mergeCells(row, 1, row, span);
}

/** Brand-filled header band. Foreground is white — brand colours here are dark. */
function headerCell(cell: ExcelJS.Cell, text: string, branding: PackBranding): void {
  cell.value = text;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(branding.brandHex) } };
  cell.font = { bold: true, size: 10, color: { argb: argb(`#${PAPER}`) } };
  cell.alignment = { vertical: 'middle', wrapText: true };
  cell.border = { bottom: { style: 'thin', color: { argb: argb(`#${HAIRLINE}`) } } };
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

async function buildInstructionsSheet(
  workbook: ExcelJS.Workbook, branding: PackBranding,
  options: BuildPackOptions, generatedAt: Date,
): Promise<void> {
  const sheet = workbook.addWorksheet(INSTRUCTIONS_SHEET, {
    properties: { defaultRowHeight: 15 },
    pageSetup: { paperSize: 9, orientation: 'portrait' },
  });
  sheet.columns = [{ width: 30 }, { width: 88 }];

  // Logo, top-left, with clear space beneath it — REPORT_RULES §5 puts the mark
  // on the cover only, never repeated in a running header.
  let cursor = 1;
  if (branding.logo) {
    const { width, height } = fitLogo(branding.logo, 220, 72);
    const imageId = workbook.addImage({
      buffer: branding.logo.data as unknown as ExcelJS.Buffer,
      extension: branding.logo.extension,
    });
    sheet.addImage(imageId, {
      tl: { col: 0.2, row: 0.3 },
      ext: { width, height },
      editAs: 'oneCell',
    });
    // Reserve vertical space so the mark does not sit on top of the wordmark.
    const rowsNeeded = Math.max(3, Math.ceil(height / 20));
    for (let index = 0; index < rowsNeeded; index += 1) {
      sheet.getRow(cursor + index).height = 20;
    }
    cursor += rowsNeeded + 1;
  }

  titleRow(sheet, cursor, branding.companyName, branding, 2);
  cursor += 1;
  const subtitle = sheet.getCell(cursor, 1);
  subtitle.value = 'Commercial & Industrial finance intake pack';
  subtitle.font = { size: 12, color: { argb: argb(`#${INK}`) } };
  sheet.mergeCells(cursor, 1, cursor, 2);
  cursor += 2;

  const lines: Array<[string, string]> = [
    ['', 'This workbook collects everything needed to assess a commercial or industrial finance transaction.'],
    ['', 'Complete what you can with the client, then drop this file back into the assessment workspace.'],
    ['', ''],
    ['How to use it', ''],
    ['1.', 'Work through the numbered sheets in order. Each row is a question to ask.'],
    ['2.', 'Type answers in the "Answer" column, or add one row per item on the table sheets.'],
    ['3.', 'Where a cell offers a dropdown, use it — typed variations still import, but the list is faster.'],
    ['4.', 'Leave anything you do not know blank. A blank is safer than a guess.'],
    ['5.', 'Do not edit the "Field key" column or rename the sheets. That is how the upload maps back.'],
    ['6.', 'Save the file, then drop it onto the assessment workspace to populate the assessment.'],
    ['', ''],
    ['A note on structures', ''],
    ['', 'Individuals, family trusts and self-managed super funds buy commercial and industrial property'],
    ['', 'just as often as companies do, and each is assessed differently. On the Ownership sheet, record'],
    ['', 'the structure exactly as it will appear on the contract, including trustees and fund members.'],
    ['', 'On the Portfolio and Liabilities sheets, name the entity that holds each asset and debt. That is'],
    ['', 'what lets the assessment combine the whole group into one borrowing position rather than'],
    ['', 'looking at this purchase in isolation.'],
    ['', ''],
  ];

  lines.forEach(([label, text]) => {
    const row = sheet.getRow(cursor);
    row.getCell(1).value = label;
    row.getCell(2).value = text;
    if (label && !/^\d\.$/.test(label)) {
      row.getCell(1).font = { bold: true, size: 11, color: { argb: argb(branding.brandHex) } };
    }
    cursor += 1;
  });

  // Pack details
  sheet.getCell(cursor, 1).value = 'Pack details';
  sheet.getCell(cursor, 1).font = { bold: true, size: 11, color: { argb: argb(branding.brandHex) } };
  cursor += 1;
  ([
    ['Assessment', options.assessmentTitle ?? 'New assessment'],
    ['Reference', options.assessmentReference ?? '—'],
    ['Generated', generatedAt.toLocaleDateString('en-AU')],
    ['Prepared by', branding.companyName],
  ] as Array<[string, string]>).forEach(([label, value]) => {
    sheet.getCell(cursor, 1).value = label;
    sheet.getCell(cursor, 1).font = { color: { argb: argb(`#${MUTED}`) } };
    sheet.getCell(cursor, 2).value = value;
    cursor += 1;
  });
  cursor += 1;

  // Company contact block — website, email, phone, address and ABN. This is the
  // only place an ABN exists in the product, so a client-facing document that
  // omits it is incomplete.
  if (branding.contactRows.length) {
    sheet.getCell(cursor, 1).value = branding.companyName;
    sheet.getCell(cursor, 1).font = { bold: true, size: 11, color: { argb: argb(branding.brandHex) } };
    cursor += 1;
    branding.contactRows.forEach((row) => {
      sheet.getCell(cursor, 1).value = row.label;
      sheet.getCell(cursor, 1).font = { color: { argb: argb(`#${MUTED}`) } };
      sheet.getCell(cursor, 2).value = row.value;
      cursor += 1;
    });
    cursor += 1;
  }

  const disclaimer = sheet.getCell(cursor, 1);
  disclaimer.value = 'This pack is an information-gathering tool. It is not a credit approval, a '
    + 'pre-approval, an offer of finance, financial advice or legal advice.';
  disclaimer.font = { size: 9, italic: true, color: { argb: argb(`#${MUTED}`) } };
  disclaimer.alignment = { wrapText: true, vertical: 'top' };
  sheet.mergeCells(cursor, 1, cursor, 2);
  sheet.getRow(cursor).height = 28;
  cursor += 2;

  // Machine-readable markers. Greyed but present — the parser reads these, and
  // hiding the rows would tempt somebody to delete them.
  ([
    ['__pack_format', PACK_MAGIC],
    ['__pack_version', PACK_FORMAT_VERSION],
    ['__assessment_reference', options.assessmentReference ?? ''],
    ['__brand_snapshot', `${branding.companyName} | ${branding.brandHex} | ${branding.resolvedAt}`],
  ] as Array<[string, string]>).forEach(([marker, value]) => {
    sheet.getCell(cursor, 1).value = marker;
    sheet.getCell(cursor, 2).value = value;
    sheet.getRow(cursor).font = { size: 8, color: { argb: argb(`#${HAIRLINE}`) } };
    cursor += 1;
  });
}

function buildSingleSheet(
  workbook: ExcelJS.Workbook, section: PackSection, branding: PackBranding,
  options: BuildPackOptions,
): void {
  const sheet = workbook.addWorksheet(section.sheetName.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = [{ width: 34 }, { width: 64 }, { width: 26 }, { width: 62 }];

  titleRow(sheet, 1, section.title, branding, 4);
  introRow(sheet, 2, section.intro, 4);

  const header = sheet.getRow(3);
  KV_HEADERS.forEach((label, index) => headerCell(header.getCell(index + 1), label, branding));
  header.height = 22;

  section.fields.forEach((field, index) => {
    const rowNumber = 4 + index;
    const row = sheet.getRow(rowNumber);

    const keyCell = row.getCell(1);
    keyCell.value = field.key;
    keyCell.font = { size: 8, color: { argb: argb(`#${MUTED}`) } };

    const questionCell = row.getCell(2);
    questionCell.value = field.question;
    questionCell.alignment = { wrapText: true, vertical: 'top' };
    if (!field.optional) questionCell.font = { bold: true, size: 10 };

    const answerCell = row.getCell(3);
    const current = options.payload ? readPath(options.payload, field.path) : undefined;
    const encoded = encodeValue(field.key, field.type, current);
    if (encoded !== '') answerCell.value = encoded;
    // The answer cell is the only one anybody should type in, so it is the only
    // one that looks like an input.
    answerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(`#${PAPER}`) } };
    answerCell.border = {
      top: { style: 'hair', color: { argb: argb(`#${HAIRLINE}`) } },
      left: { style: 'thin', color: { argb: argb(branding.accentHex) } },
      bottom: { style: 'hair', color: { argb: argb(`#${HAIRLINE}`) } },
      right: { style: 'hair', color: { argb: argb(`#${HAIRLINE}`) } },
    };
    const format = numberFormat(field);
    if (format) answerCell.numFmt = format;
    applyValidation(answerCell, field);

    const guidanceCell = row.getCell(4);
    guidanceCell.value = guidanceFor(field);
    guidanceCell.font = { size: 9, color: { argb: argb(`#${MUTED}`) } };
    guidanceCell.alignment = { wrapText: true, vertical: 'top' };

    if (index % 2 === 1) {
      [1, 2, 4].forEach((column) => {
        row.getCell(column).fill = {
          type: 'pattern', pattern: 'solid', fgColor: { argb: argb(`#${TINT}`) },
        };
      });
    }
  });
}

function buildTableSheet(
  workbook: ExcelJS.Workbook, section: PackSection, branding: PackBranding,
  options: BuildPackOptions,
): void {
  const sheet = workbook.addWorksheet(section.sheetName.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const span = section.fields.length;
  sheet.columns = section.fields.map((field) => ({
    width: field.type === 'longtext' ? 44 : Math.max(16, Math.min(32, field.label.length + 6)),
  }));

  titleRow(sheet, 1, section.title, branding, span);
  introRow(sheet, 2, section.intro, span);

  // Row 3 is the field keys the parser matches on; row 4 is what a human reads.
  const keyRow = sheet.getRow(3);
  section.fields.forEach((field, index) => {
    const cell = keyRow.getCell(index + 1);
    cell.value = field.key;
    cell.font = { size: 8, color: { argb: argb(`#${MUTED}`) } };
  });

  const labelRow = sheet.getRow(4);
  section.fields.forEach((field, index) => {
    headerCell(labelRow.getCell(index + 1), field.optional ? field.label : `${field.label} *`, branding);
  });
  labelRow.height = 30;

  const existing = section.collectionPath
    ? (readPath(options.payload, section.collectionPath) as unknown[] | undefined)
    : undefined;

  let rowNumber = 5;
  (existing ?? []).forEach((item) => {
    const row = sheet.getRow(rowNumber);
    section.fields.forEach((field, index) => {
      const encoded = encodeValue(field.key, field.type, readPath(item, field.path));
      if (encoded !== '') row.getCell(index + 1).value = encoded;
    });
    rowNumber += 1;
  });

  // Leave room to write. A form with no blank lines invites people to work
  // around it in a separate document, defeating the round-trip entirely.
  const blanks = Math.max(BLANK_TABLE_ROWS - (existing?.length ?? 0), 4);
  const lastRow = rowNumber + blanks - 1;

  for (; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    section.fields.forEach((field, index) => {
      const cell = row.getCell(index + 1);
      cell.border = {
        top: { style: 'hair', color: { argb: argb(`#${HAIRLINE}`) } },
        bottom: { style: 'hair', color: { argb: argb(`#${HAIRLINE}`) } },
        left: { style: 'hair', color: { argb: argb(`#${HAIRLINE}`) } },
        right: { style: 'hair', color: { argb: argb(`#${HAIRLINE}`) } },
      };
      const format = numberFormat(field);
      if (format) cell.numFmt = format;
      applyValidation(cell, field);
    });
  }

  sheet.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4, column: span },
  };
}

function buildProceedSheet(workbook: ExcelJS.Workbook, branding: PackBranding): void {
  const sheet = workbook.addWorksheet(PROCEED_SHEET, {
    pageSetup: { paperSize: 9, orientation: 'portrait' },
  });
  sheet.columns = [{ width: 66 }, { width: 52 }];

  titleRow(sheet, 1, 'Next steps', branding, 2);
  introRow(sheet, 2, 'Complete this with the client once the figures above have been discussed.', 2);

  let cursor = 4;
  headerCell(sheet.getCell(cursor, 1), 'Question', branding);
  headerCell(sheet.getCell(cursor, 2), 'Answer', branding);
  cursor += 1;

  const questions = [
    'Does the client wish to proceed with a finance application?',
    'If yes, what is the preferred settlement timeframe?',
    'Which lender or lenders have they already approached, if any?',
    'Is there an existing broker or adviser involved?',
    'What conditions or concerns do they want addressed first?',
    'Who is the primary contact, and what is the best number and email?',
  ];
  questions.forEach((question) => {
    sheet.getCell(cursor, 1).value = question;
    sheet.getCell(cursor, 1).alignment = { wrapText: true, vertical: 'top' };
    const answer = sheet.getCell(cursor, 2);
    answer.border = {
      bottom: { style: 'thin', color: { argb: argb(`#${HAIRLINE}`) } },
      left: { style: 'thin', color: { argb: argb(branding.accentHex) } },
    };
    cursor += 1;
  });
  cursor += 1;

  sheet.getCell(cursor, 1).value = 'Supporting documents to collect';
  sheet.getCell(cursor, 1).font = { bold: true, size: 11, color: { argb: argb(branding.brandHex) } };
  cursor += 1;
  sheet.getCell(cursor, 1).value = 'Bring these back with the completed pack and drop them into the workspace alongside this file.';
  sheet.getCell(cursor, 1).font = { size: 9, italic: true, color: { argb: argb(`#${MUTED}`) } };
  cursor += 1;

  [
    'Contract of sale or heads of agreement',
    'Current lease(s) and any rent roll',
    'Last two years of financial statements and tax returns',
    'Most recent notices of assessment',
    'Trust deed or SMSF trust deed and investment strategy, where applicable',
    'Company constitution and ASIC extract, where applicable',
    'Rates and insurance notices for the property',
    'Statements for existing loans, cards and equipment finance',
    'Identification for every borrower, director, trustee and guarantor',
  ].forEach((document) => {
    sheet.getCell(cursor, 1).value = '☐';
    sheet.getCell(cursor, 2).value = document;
    cursor += 1;
  });
  cursor += 1;

  sheet.getCell(cursor, 1).value = 'Declaration';
  sheet.getCell(cursor, 1).font = { bold: true, size: 11, color: { argb: argb(branding.brandHex) } };
  cursor += 1;
  const declaration = sheet.getCell(cursor, 1);
  declaration.value = 'The information recorded in this pack has been provided by the client and is, to '
    + 'the best of their knowledge, accurate at the date below. It will be verified against source '
    + 'documents before any finance application is made.';
  declaration.font = { size: 9, color: { argb: argb(`#${INK}`) } };
  declaration.alignment = { wrapText: true, vertical: 'top' };
  sheet.mergeCells(cursor, 1, cursor, 2);
  sheet.getRow(cursor).height = 40;
  cursor += 2;

  ['Client name', 'Signature', 'Date', `Completed by (${branding.companyName})`].forEach((label) => {
    sheet.getCell(cursor, 1).value = label;
    sheet.getCell(cursor, 1).font = { bold: true, size: 10 };
    sheet.getCell(cursor, 2).border = {
      bottom: { style: 'thin', color: { argb: argb(`#${INK}`) } },
    };
    cursor += 1;
  });
  cursor += 1;

  if (branding.contactRows.length) {
    branding.contactRows.forEach((row) => {
      sheet.getCell(cursor, 1).value = `${row.label}: ${row.value}`;
      sheet.getCell(cursor, 1).font = { size: 9, color: { argb: argb(`#${MUTED}`) } };
      cursor += 1;
    });
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Load ExcelJS on demand so it never enters the main bundle. */
async function loadExcelJs(): Promise<typeof ExcelJS> {
  const module = await import('exceljs');
  return (module.default ?? module) as unknown as typeof ExcelJS;
}

/** Build the complete branded workbook. */
export async function buildIntakeWorkbook(
  options: BuildPackOptions = {},
): Promise<ExcelJS.Workbook> {
  const branding = options.branding ?? DEFAULT_PACK_BRANDING;
  const generatedAt = options.generatedAt ?? new Date();

  const Excel = await loadExcelJs();
  const workbook = new Excel.Workbook();
  workbook.creator = branding.companyName;
  workbook.company = branding.companyName;
  workbook.title = 'Commercial & Industrial finance intake pack';
  workbook.description = 'Client fact-find and interview workbook';
  workbook.created = generatedAt;
  workbook.modified = generatedAt;

  await buildInstructionsSheet(workbook, branding, options, generatedAt);
  PACK_SECTIONS.forEach((section) => {
    if (section.shape === 'table') buildTableSheet(workbook, section, branding, options);
    else buildSingleSheet(workbook, section, branding, options);
  });
  buildProceedSheet(workbook, branding);

  return workbook;
}

/** Serialise the workbook to a Blob for download. */
export async function workbookToBlob(workbook: ExcelJS.Workbook): Promise<Blob> {
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
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

export { bareHex };
