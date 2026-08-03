/**
 * Intake-pack Word document.
 *
 * A branded interview script for sitting with a client — printable, editable,
 * and organised as questions to ask rather than fields to populate.
 *
 * Branding follows `REPORT_RULES.md` §5 rather than doing whatever Word allows:
 *
 *   Cover           the mark, top-left, with generous clear space
 *   Running header  wordmark TEXT only — never a repeated image. An image in a
 *                   page-margin box is fragile across a long document
 *   Footer          page counters and the trading name; no mark
 *
 * The logo is embedded as bytes, not linked, so the document renders with no
 * network and leaks no fetch back to us each time a client opens it.
 *
 * This document is deliberately NOT parsed back. A Word file's structure does
 * not survive real-world editing reliably enough to drive a financial
 * calculation, and a silent mis-mapping would be worse than asking someone to
 * use the spreadsheet. The workbook is the machine-readable half; this is the
 * human half, and it says so on its face.
 */

import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun,
  PageNumber, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { PACK_SECTIONS, type PackField, type PackSection } from './schema';
import { DEFAULT_PACK_BRANDING, bareHex, fitLogo, type PackBranding } from './branding';

export interface BuildDocumentOptions {
  branding?: PackBranding;
  assessmentReference?: string;
  assessmentTitle?: string;
  generatedAt?: Date;
}

const CELL_MARGIN = { top: 90, bottom: 90, left: 130, right: 130 };

const MUTED = '6B7280';
const HAIRLINE = 'D8D8D8';
const RULE = 'E5E7EB';

/** A light rule between rows; a full grid makes a long form feel like a tax return. */
const SUBTLE_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 1, color: HAIRLINE },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: HAIRLINE },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: HAIRLINE },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

function heading(
  text: string, brandHex: string,
  level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_2,
) {
  return new Paragraph({
    heading: level,
    spacing: { before: 300, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 6 } },
    children: [new TextRun({ text, color: bareHex(brandHex), bold: true })],
  });
}

function body(text: string, options: { italic?: boolean; size?: number; color?: string } = {}) {
  return new Paragraph({
    spacing: { after: 110 },
    children: [new TextRun({
      text, italics: options.italic, size: options.size ?? 20, color: options.color,
    })],
  });
}

/** Convert pixels to the twentieths-of-a-point docx measures images in. */
function pxToPt(px: number): number {
  return Math.round(px * 0.75);
}

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
            children: [new TextRun({ text: field.question, size: 20, bold: !field.optional })],
          }),
          ...(guidance
            ? [new Paragraph({
              children: [new TextRun({ text: guidance, size: 16, color: MUTED, italics: true })],
            })]
            : []),
        ],
      }),
      new TableCell({
        width: { size: 42, type: WidthType.PERCENTAGE },
        margins: CELL_MARGIN,
        children: [new Paragraph({
          children: [new TextRun({ text: field.optional ? '(optional)' : '', size: 16, color: MUTED })],
        })],
      }),
    ],
  });
}

function sectionBlock(section: PackSection, brandHex: string): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [
    heading(section.title, brandHex),
    body(section.intro, { italic: true, color: MUTED }),
  ];

  if (section.shape === 'table') {
    blocks.push(body(
      'Record one entry per item. Add extra copies of this block as needed, or use the matching '
      + 'sheet in the workbook where there are several.',
      { italic: true, size: 18, color: MUTED },
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
    heading('Next steps', branding.brandHex),
    body('Complete this once the figures have been discussed with the client.', { italic: true, color: MUTED }),
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

    heading('Supporting documents to collect', branding.brandHex),
    body('Bring these back with the completed pack.', { italic: true, color: MUTED }),
    ...documents.map((document) => new Paragraph({
      spacing: { after: 70 },
      children: [new TextRun({ text: `☐   ${document}`, size: 20 })],
    })),

    heading('Declaration', branding.brandHex),
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

/** Website, email, phone, address and ABN — the ABN exists nowhere else. */
function contactBlock(branding: PackBranding): (Paragraph | Table)[] {
  if (!branding.contactRows.length) return [];
  return [
    heading(branding.companyName, branding.brandHex),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: SUBTLE_BORDERS,
      rows: branding.contactRows.map((row) => new TableRow({
        children: [
          new TableCell({
            width: { size: 22, type: WidthType.PERCENTAGE }, margins: CELL_MARGIN,
            children: [new Paragraph({
              children: [new TextRun({ text: row.label, size: 18, bold: true, color: MUTED })],
            })],
          }),
          new TableCell({
            width: { size: 78, type: WidthType.PERCENTAGE }, margins: CELL_MARGIN,
            children: [new Paragraph({ children: [new TextRun({ text: row.value, size: 18 })] })],
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

  // ---- Cover mark -------------------------------------------------------
  const coverMark: Paragraph[] = [];
  if (branding.logo) {
    // ~40mm wide / 20mm tall bounding box, aspect preserved and never enlarged.
    const { width, height } = fitLogo(branding.logo, 200, 96);
    coverMark.push(new Paragraph({
      spacing: { after: 220 },
      children: [new ImageRun({
        // `docx` types the buffer as Buffer; Uint8Array is what it actually reads.
        data: branding.logo.data as unknown as Buffer,
        transformation: { width: pxToPt(width), height: pxToPt(height) },
        // ExcelJS spells it "jpeg", docx spells it "jpg". The pack stores the
        // ExcelJS spelling, so translate rather than carrying two fields.
        type: branding.logo.extension === 'jpeg' ? 'jpg' : 'png',
      })],
    }));
  }

  const children: (Paragraph | Table)[] = [
    ...coverMark,
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({
        text: branding.companyName, bold: true, size: 26, color: bareHex(branding.brandHex),
      })],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 140 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: bareHex(branding.accentHex), space: 8 } },
      children: [new TextRun({
        text: 'Commercial & Industrial finance intake',
        bold: true, size: 40, color: bareHex(branding.brandHex),
      })],
    }),
    body(
      `${options.assessmentTitle ?? 'New assessment'}`
      + `${options.assessmentReference ? `  ·  ${options.assessmentReference}` : ''}`
      + `  ·  ${generatedAt.toLocaleDateString('en-AU')}`,
      { italic: true, size: 18, color: MUTED },
    ),

    body(
      'This is an interview guide. Work through it with the client and record their answers. '
      + 'To load the answers straight into the assessment, use the workbook version of this pack — '
      + 'it is the machine-readable half and maps every answer back automatically.',
      { italic: true, color: MUTED },
    ),

    heading('A note on ownership structures', branding.brandHex),
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
    ...contactBlock(branding),

    heading('Important', branding.brandHex),
    body(
      'This pack is an information-gathering tool. It is not a credit approval, a pre-approval, an '
      + 'offer of finance, financial advice or legal advice, and it does not represent the credit '
      + 'policy of any particular lender.',
      { italic: true, size: 18, color: MUTED },
    ),
  ];

  return new Document({
    creator: branding.companyName,
    title: 'Commercial & Industrial finance intake pack',
    description: 'Client fact-find and interview guide',
    sections: [{
      properties: {},
      // Wordmark text, not the mark — §5. A repeated image in a margin box is
      // fragile across a document this long.
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 4 } },
            children: [new TextRun({
              text: `${branding.companyName}  ·  Commercial & Industrial finance intake`,
              size: 15, color: MUTED,
            })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: `${branding.companyName}   `, size: 15, color: MUTED }),
              new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 15, color: MUTED }),
            ],
          })],
        }),
      },
      children,
    }],
  });
}

/** Serialise the document to a Blob for download. */
export async function documentToBlob(document: Document): Promise<Blob> {
  return Packer.toBlob(document);
}
