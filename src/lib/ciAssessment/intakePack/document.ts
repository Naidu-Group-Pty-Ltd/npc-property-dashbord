/**
 * Intake-pack Word document.
 *
 * A branded interview script for sitting with a client — printable, editable,
 * and organised as questions to ask rather than fields to populate.
 *
 * This document is deliberately NOT parsed back. A Word file's structure does
 * not survive real-world editing reliably enough to drive a financial
 * calculation from it, and a silent mis-mapping there would be worse than
 * asking someone to use the spreadsheet. The workbook is the machine-readable
 * half of the pack; this is the human half. The document says so on its face.
 */

import {
  AlignmentType, Document, HeadingLevel, Packer, Paragraph,
  Table, TableCell, TableRow, TextRun, WidthType, BorderStyle,
} from 'docx';
import { PACK_SECTIONS, type PackField, type PackSection } from './schema';
import { DEFAULT_PACK_BRANDING, bareHex, type PackBranding } from './branding';

export interface BuildDocumentOptions {
  branding?: PackBranding;
  assessmentReference?: string;
  assessmentTitle?: string;
  generatedAt?: Date;
}

const CELL_MARGIN = { top: 80, bottom: 80, left: 120, right: 120 };

/** A light rule between rows; a full grid makes a long form feel like a tax return. */
const SUBTLE_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 1, color: 'D8D8D8' },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D8D8D8' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'D8D8D8' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

function heading(text: string, brandHex: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) {
  return new Paragraph({
    heading: level,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text, color: bareHex(brandHex), bold: true })],
  });
}

function body(text: string, options: { italic?: boolean; size?: number } = {}) {
  return new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text, italics: options.italic, size: options.size ?? 20 })],
  });
}

/** A question with a ruled answer line beneath it. */
function questionRow(field: PackField): TableRow {
  const guidance = [
    field.help,
    field.options?.length ? `Options: ${field.options.join(' · ')}` : null,
  ].filter(Boolean).join('  ');

  return new TableRow({
    children: [
      new TableCell({
        width: { size: 58, type: WidthType.PERCENTAGE },
        margins: CELL_MARGIN,
        children: [
          new Paragraph({
            children: [new TextRun({ text: field.question, size: 20 })],
          }),
          ...(guidance
            ? [new Paragraph({
              children: [new TextRun({ text: guidance, size: 16, color: '767676', italics: true })],
            })]
            : []),
        ],
      }),
      new TableCell({
        width: { size: 42, type: WidthType.PERCENTAGE },
        margins: CELL_MARGIN,
        children: [new Paragraph({
          children: [new TextRun({
            text: field.optional ? '(optional)' : '',
            size: 16, color: 'A0A0A0',
          })],
        })],
      }),
    ],
  });
}

function sectionBlock(section: PackSection, brandHex: string): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [
    heading(`${section.title}`, brandHex, HeadingLevel.HEADING_2),
    body(section.intro, { italic: true }),
  ];

  if (section.shape === 'table') {
    blocks.push(body(
      'Record one entry per item. Add extra copies of this block as needed, or use the '
      + 'matching sheet in the spreadsheet where there are several.',
      { italic: true, size: 18 },
    ));
  }

  blocks.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: SUBTLE_BORDERS,
    rows: section.fields.map(questionRow),
  }));

  return blocks;
}

function proceedBlock(branding: PackBranding): (Paragraph | Table)[] {
  const questions = [
    'Does the client wish to proceed with a finance application?',
    'If yes, what is the preferred settlement timeframe?',
    'Which lender or lenders have they already approached, if any?',
    'Is there an existing broker or adviser involved?',
    'What conditions or concerns do they want addressed first?',
    'Who is the primary contact, and what is the best number and email?',
  ];

  const documents = [
    'Contract of sale or heads of agreement',
    'Current lease(s) and any rent roll',
    'Last two years of financial statements and tax returns',
    'Most recent notices of assessment',
    'Trust deed or SMSF trust deed and investment strategy, where applicable',
    'Company constitution and ASIC extract, where applicable',
    'Rates and insurance notices for the property',
    'Statements for existing loans, cards and equipment finance',
    'Identification for every borrower, director, trustee and guarantor',
  ];

  return [
    heading('Next steps', branding.brandHex, HeadingLevel.HEADING_2),
    body('Complete this once the figures have been discussed with the client.', { italic: true }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: SUBTLE_BORDERS,
      rows: questions.map((question) => new TableRow({
        children: [
          new TableCell({
            width: { size: 58, type: WidthType.PERCENTAGE }, margins: CELL_MARGIN,
            children: [new Paragraph({ children: [new TextRun({ text: question, size: 20 })] })],
          }),
          new TableCell({
            width: { size: 42, type: WidthType.PERCENTAGE }, margins: CELL_MARGIN,
            children: [new Paragraph('')],
          }),
        ],
      })),
    }),

    heading('Supporting documents to collect', branding.brandHex, HeadingLevel.HEADING_2),
    body('Bring these back with the completed pack.', { italic: true }),
    ...documents.map((document) => new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: `☐   ${document}`, size: 20 })],
    })),

    heading('Declaration', branding.brandHex, HeadingLevel.HEADING_2),
    body(
      'The information recorded in this pack has been provided by the client and is, to the best of '
      + 'their knowledge, accurate at the date below. It will be verified against source documents '
      + 'before any finance application is made.',
    ),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: SUBTLE_BORDERS,
      rows: ['Client name', 'Signature', 'Date', `Completed by (${branding.companyName})`]
        .map((label) => new TableRow({
          children: [
            new TableCell({
              width: { size: 30, type: WidthType.PERCENTAGE }, margins: CELL_MARGIN,
              children: [new Paragraph({ children: [new TextRun({ text: label, size: 20, bold: true })] })],
            }),
            new TableCell({
              width: { size: 70, type: WidthType.PERCENTAGE }, margins: CELL_MARGIN,
              children: [new Paragraph('')],
            }),
          ],
        })),
    }),
  ];
}

/** Build the branded interview document. */
export function buildIntakeDocument(options: BuildDocumentOptions = {}): Document {
  const branding = options.branding ?? DEFAULT_PACK_BRANDING;
  const generatedAt = options.generatedAt ?? new Date();

  const children: (Paragraph | Table)[] = [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 60 },
      children: [new TextRun({
        text: branding.companyName, bold: true, size: 28, color: bareHex(branding.brandHex),
      })],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 120 },
      children: [new TextRun({
        text: 'Commercial & Industrial finance intake',
        bold: true, size: 36, color: bareHex(branding.brandHex),
      })],
    }),
    body(
      `${options.assessmentTitle ?? 'New assessment'}`
      + `${options.assessmentReference ? `  ·  ${options.assessmentReference}` : ''}`
      + `  ·  ${generatedAt.toLocaleDateString('en-AU')}`,
      { italic: true, size: 18 },
    ),

    body(
      'This is an interview guide. Work through it with the client and record their answers. '
      + 'To load the answers straight into the assessment, use the spreadsheet version of this '
      + 'pack — it is the machine-readable half and maps every answer back automatically.',
      { italic: true },
    ),

    heading('A note on ownership structures', branding.brandHex, HeadingLevel.HEADING_2),
    body(
      'Individuals, family trusts and self-managed super funds acquire commercial and industrial '
      + 'property just as often as companies do, and each is assessed differently. Record the '
      + 'structure exactly as it will appear on the contract — including trustees and fund members — '
      + 'and name the owning entity against every existing property and debt. That is what allows '
      + 'the assessment to combine the whole group into one borrowing position rather than looking '
      + 'at this purchase in isolation.',
    ),

    ...PACK_SECTIONS.flatMap((section) => sectionBlock(section, branding.brandHex)),
    ...proceedBlock(branding),

    heading('Important', branding.brandHex, HeadingLevel.HEADING_2),
    body(
      'This pack is an information-gathering tool. It is not a credit approval, a pre-approval, an '
      + 'offer of finance, financial advice or legal advice, and it does not represent the credit '
      + 'policy of any particular lender.',
      { italic: true, size: 18 },
    ),
    ...(branding.footerNote ? [body(branding.footerNote, { italic: true, size: 18 })] : []),
  ];

  return new Document({
    creator: branding.companyName,
    title: 'Commercial & Industrial finance intake pack',
    description: 'Client fact-find and interview guide',
    sections: [{ properties: {}, children }],
  });
}

/** Serialise the document to a Blob for download. */
export async function documentToBlob(document: Document): Promise<Blob> {
  return Packer.toBlob(document);
}
