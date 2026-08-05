/**
 * The worked example, in the three forms it is consumed in.
 *
 * The template is a document you fill in elsewhere; the example is a reference
 * you read. Those are different jobs, so the example is offered two ways — as
 * the same two files, filled in, for anyone who wants them open beside the
 * blank ones; and as a structure the app can render directly, so the common
 * case ("what does a good answer look like here?") does not require leaving the
 * page, downloading anything, or having Excel installed at all.
 *
 * Both come from `sample.ts` through the ordinary generators. There is no
 * second template and no checked-in binary, so the example cannot describe a
 * pack that no longer exists.
 */

import {
  buildIntakeWorkbook, packFileName, projectPackRow, workbookToBlob, PROCEED_QUESTIONS,
} from './workbook';
import { buildIntakeDocument, documentToBlob } from './document';
import { DEFAULT_PACK_BRANDING, type PackBranding } from './branding';
import {
  PACK_SECTIONS, type PackField, type PackSection,
} from './schema';
import { encodeValue, toDisplayValue } from './values';
import {
  SAMPLE_DETAILS, SAMPLE_NOTES, SAMPLE_PROCEED, SAMPLE_SUMMARY, sampleAssessment,
} from './sample';
import type { AssessmentPayload } from '../types';

export { SAMPLE_SUMMARY };

/** A reference to hand to the generators so the example is unmistakable. */
export const WORKED_EXAMPLE_REFERENCE = 'EXAMPLE-CI-2026-001';

function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, segment) => {
    if (node == null || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[segment];
  }, source);
}

/**
 * The same encoding the files use, including `preserveZeroes` — a guarantor at
 * 0% has to read as "0" here exactly as it does in the workbook, or the viewer
 * becomes a second, disagreeing description of the same example.
 */
function encoded(field: PackField, source: unknown): string {
  const value = encodeValue(
    field.key, field.type, readPath(source, field.path), { preserveZeroes: true },
  );
  if (value === '') return '';
  // Formatted the way the workbook's cell formats render it, so the viewer and
  // the file show a reader the same thing.
  return toDisplayValue(field.type, value);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

const FILE_OPTIONS = {
  payload: sampleAssessment(),
  details: SAMPLE_DETAILS,
  proceed: SAMPLE_PROCEED,
  assessmentReference: WORKED_EXAMPLE_REFERENCE,
  assessmentTitle: 'Worked example',
  preserveZeroes: true,
  sample: true as const,
};

/** The filled workbook, branded as the organisation's own. */
export async function buildWorkedExampleWorkbook(branding?: PackBranding): Promise<Blob> {
  const workbook = await buildIntakeWorkbook({ ...FILE_OPTIONS, branding });
  return workbookToBlob(workbook);
}

/** The filled interview guide, branded as the organisation's own. */
export async function buildWorkedExampleDocument(branding?: PackBranding): Promise<Blob> {
  return documentToBlob(buildIntakeDocument({ ...FILE_OPTIONS, branding }));
}

export function workedExampleFileName(
  branding: PackBranding | undefined, extension: 'xlsx' | 'docx',
): string {
  return packFileName(
    branding ?? DEFAULT_PACK_BRANDING, WORKED_EXAMPLE_REFERENCE, extension, 'example',
  );
}

// ---------------------------------------------------------------------------
// Readable form
// ---------------------------------------------------------------------------

export interface ExampleAnswer {
  key: string;
  label: string;
  question: string;
  /** The recorded answer, formatted the way the pack writes it. */
  value: string;
  /** Why it is written that way. Present only where the format is non-obvious. */
  note?: string;
  required: boolean;
}

export interface ExampleEntry {
  /** "Entity 1", "Period 2" — absent on key/value sections. */
  label?: string;
  answers: ExampleAnswer[];
}

export interface ExampleSection {
  id: string;
  sheetName: string;
  title: string;
  intro: string;
  shape: PackSection['shape'];
  entries: ExampleEntry[];
  /** Answered fields over total fields, so a reader can see how complete it is. */
  answered: number;
  total: number;
}

const BLOCK_NOUNS: Record<string, string> = {
  ownership: 'Entity',
  incomePeriods: 'Period',
  addbacks: 'Add-back',
  portfolio: 'Property',
  liabilities: 'Liability',
  tenancies: 'Tenancy',
};

/**
 * `withNotes` is false for every repeat of a block.
 *
 * The note explains the *format* of an answer, not the answer, so repeating it
 * against Entity 2, Property 2 and Tenancy 2 is noise the reader has to skim
 * past three times to reach the thing that differs.
 */
function answersFor(
  section: PackSection, source: unknown, withNotes: boolean,
): ExampleAnswer[] {
  return section.fields.map((field) => ({
    key: field.key,
    label: field.label,
    question: field.question,
    value: encoded(field, source),
    note: withNotes ? SAMPLE_NOTES[field.key] : undefined,
    required: !field.optional,
  }));
}

/**
 * The example as browsable sections.
 *
 * Values are produced by `encodeValue` — the same function that writes the
 * spreadsheet — so what the viewer shows is character-for-character what the
 * downloaded file contains. A viewer that formatted its own numbers would
 * quietly become a second, disagreeing description of the same example.
 */
export function workedExampleSections(payload?: AssessmentPayload): ExampleSection[] {
  const source = payload ?? sampleAssessment();

  const sections = PACK_SECTIONS.map<ExampleSection>((section) => {
    const entries: ExampleEntry[] = [];

    if (section.shape === 'single') {
      entries.push({ answers: answersFor(section, source, true) });
    } else {
      const items = section.collectionPath
        ? (readPath(source, section.collectionPath) as unknown[] | undefined) ?? []
        : [];
      const noun = BLOCK_NOUNS[section.id] ?? 'Entry';
      items.forEach((item, index) => {
        entries.push({
          label: `${noun} ${index + 1}`,
          answers: answersFor(section, projectPackRow(section, item, source), index === 0),
        });
      });
    }

    const all = entries.flatMap((entry) => entry.answers);
    return {
      id: section.id,
      sheetName: section.sheetName,
      title: section.title,
      intro: section.intro,
      shape: section.shape,
      entries,
      answered: all.filter((answer) => answer.value !== '').length,
      total: all.length,
    };
  });

  // The Next steps sheet sits outside the field schema — it collects intent
  // rather than inputs — but it is part of what a reader wants to see filled.
  const proceedAnswers: ExampleAnswer[] = PROCEED_QUESTIONS.map((entry) => ({
    key: entry.key,
    label: entry.question,
    question: entry.question,
    value: SAMPLE_PROCEED.answers?.[entry.key] ?? '',
    required: false,
  }));

  sections.push({
    id: 'proceed',
    sheetName: '7. Proceed',
    title: 'Next steps',
    intro: 'What happens after the meeting, agreed with the client while you are still with them.',
    shape: 'single',
    entries: [{ answers: proceedAnswers }],
    answered: proceedAnswers.filter((answer) => answer.value !== '').length,
    total: proceedAnswers.length,
  });

  return sections;
}
