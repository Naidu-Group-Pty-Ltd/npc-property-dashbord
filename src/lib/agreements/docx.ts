/**
 * Agreement Centre — DOCX export, built in the browser.
 *
 * The manual path: a user who wants to manage an agreement outside the portal
 * downloads a Word document generated from the SAME locked content module and
 * the SAME field values as every other representation — there is no second
 * copy of the wording to drift. Unfilled fields print the template's original
 * `<<INSERT>>` brackets, so the export works exactly like the supplied
 * document when incomplete, and like the completed agreement when not.
 *
 * The export always carries the full template pack (Section E email page
 * included): DOCX is the hand-issuance format, and that page exists for
 * hand issuance.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

import {
  agreementTemplate,
  substitutePlain,
  EXECUTION_PANEL_LINES,
  type AgreementBlock,
  type AgreementFieldValues,
  type AgreementTemplateKey,
  type ExecutionBlock,
  type GridBlock,
  type GridCellDef,
} from '@/lib/agreements';

const PAGE_CONTENT_DXA = 9026;
const HALF = PAGE_CONTENT_DXA / 2;
const LABEL = 1800;
const VALUE = PAGE_CONTENT_DXA / 2 - LABEL;

const CHECKBOX_EMPTY = '☐';
const CHECKBOX_CHECKED = '☑';

type Child = Paragraph | Table;

function label(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({ text, bold: true, size: 15, allCaps: true, color: '666666' })],
  });
}

function bodyPara(text: string, opts: { bold?: boolean; size?: number; after?: number } = {}): Paragraph {
  return new Paragraph({
    spacing: { after: opts.after ?? 120 },
    children: [new TextRun({ text, bold: opts.bold, size: opts.size ?? 20 })],
  });
}

function cellOf(children: Child[], widthDxa: number, shaded = false): TableCell {
  return new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    shading: shaded ? { type: ShadingType.CLEAR, fill: 'F5F4F0' } : undefined,
    children,
  });
}

function choiceText(cell: GridCellDef, values: AgreementFieldValues): string {
  const choice = cell.choice!;
  const raw = values[choice.fieldKey];
  const selected = raw === null || raw === undefined ? '' : String(raw);
  const optionValues = choice.options.map((option) => option.value);
  const customValue = selected && !optionValues.includes(selected) ? selected : '';

  const parts = choice.options.map((option) => {
    const isOther = option.value === 'other';
    const checked = selected === option.value || (isOther && Boolean(customValue));
    let text = `${checked ? CHECKBOX_CHECKED : CHECKBOX_EMPTY} ${option.label}`;
    if (isOther) {
      const otherText = choice.otherFieldKey ? values[choice.otherFieldKey] : customValue;
      if (otherText !== null && otherText !== undefined && String(otherText).trim() !== '') {
        text += ` ${String(otherText)}`;
      }
    }
    return text;
  });
  return `${choice.lead ? `${choice.lead} ` : ''}${parts.join('   ')}`;
}

function cellValueText(cell: GridCellDef, key: AgreementTemplateKey, values: AgreementFieldValues): string {
  if (cell.choice) return choiceText(cell, values);
  if (cell.template) return substitutePlain(cell.template, key, values);
  if (cell.fieldKey) return substitutePlain(`{{${cell.fieldKey}}}`, key, values);
  return cell.text ?? '';
}

function gridTable(block: GridBlock, key: AgreementTemplateKey, values: AgreementFieldValues): Table {
  const rows = block.rows.map((cells) => {
    const rowCells: TableCell[] = [];
    for (const cell of cells) {
      rowCells.push(cellOf([label(cell.label)], LABEL, true));
      rowCells.push(cellOf(
        [bodyPara(cellValueText(cell, key, values), { after: 0 })],
        cells.length === 1 ? PAGE_CONTENT_DXA - LABEL : VALUE,
      ));
    }
    return new TableRow({ children: rowCells });
  });
  const twoUp = block.rows.every((cells) => cells.length === 2);
  return new Table({
    width: { size: PAGE_CONTENT_DXA, type: WidthType.DXA },
    columnWidths: twoUp ? [LABEL, VALUE, LABEL, VALUE] : [LABEL, PAGE_CONTENT_DXA - LABEL],
    rows,
  });
}

function signaturePanel(title: string, entity: string, name: string, roleTitle: string): TableCell {
  return cellOf([
    bodyPara(title, { bold: true, size: 18, after: 120 }),
    bodyPara(`${EXECUTION_PANEL_LINES.legalEntity} ${entity}`),
    bodyPara(`${EXECUTION_PANEL_LINES.signatoryName} ${name}`),
    bodyPara(`${EXECUTION_PANEL_LINES.signatoryTitle} ${roleTitle}`),
    bodyPara(`${EXECUTION_PANEL_LINES.signature} ______________________________`),
    bodyPara(`${EXECUTION_PANEL_LINES.date} ____ / ____ / ______`),
    bodyPara(`${EXECUTION_PANEL_LINES.witness} __________________`, { after: 0 }),
  ], HALF);
}

function executionTable(block: ExecutionBlock, key: AgreementTemplateKey, values: AgreementFieldValues): Table {
  const entityFor = (role: string): string => {
    const source = role === 'partner' ? values.fp_legal_name
      : role === 'loan_writer' ? values.lw_entity
      : values.ba_legal_name;
    const text = String(source ?? '').trim();
    return text || '<<INSERT>>';
  };
  const prefill = (role: string, field: 'name' | 'title'): string => {
    const source = role === 'partner' ? values[`partner_signatory_${field}`]
      : role === 'principal' ? values[`principal_signatory_${field}`]
      : null;
    const text = String(source ?? '').trim();
    return text || '<<INSERT>>';
  };
  return new Table({
    width: { size: PAGE_CONTENT_DXA, type: WidthType.DXA },
    columnWidths: [HALF, HALF],
    rows: [new TableRow({
      children: block.parties.map((party) => signaturePanel(
        party.title,
        entityFor(party.role),
        prefill(party.role, 'name'),
        prefill(party.role, 'title'),
      )),
    })],
  });
}

function blockChildren(
  block: AgreementBlock,
  key: AgreementTemplateKey,
  values: AgreementFieldValues,
): Child[] {
  switch (block.kind) {
    case 'cover':
      return [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 2400, after: 240 },
          children: [new TextRun({ text: substitutePlain(block.companyNameToken, key, values), bold: true, size: 28 })],
        }),
        ...block.titleLines.map((line, index) => new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: index === block.titleLines.length - 1 ? 240 : 0 },
          children: [new TextRun({ text: line, bold: true, size: 56 })],
        })),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          children: [new TextRun({ text: block.issuedByLine, size: 18, allCaps: true, color: '666666' })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 360 },
          children: [new TextRun({ text: block.descriptor, size: 20, italics: true })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 360 },
          children: [new TextRun({ text: block.badges.join('   ·   '), size: 16, color: '666666' })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: substitutePlain(block.versionLine, key, values), size: 18 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: block.reviewStatement, size: 16, color: '888888' })],
          pageBreakBefore: false,
        }),
        new Paragraph({ children: [], pageBreakBefore: false, spacing: { after: 0 } }),
      ];
    case 'note':
      return [new Paragraph({
        spacing: { before: 120, after: 160 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: '999999', space: 8 } },
        children: [
          new TextRun({ text: `${block.label} — `, bold: true, size: 18 }),
          new TextRun({ text: substitutePlain(block.body, key, values), size: 18 }),
        ],
      })];
    case 'emailTemplate':
      return [
        label(block.subjectLabel),
        bodyPara(substitutePlain(block.subject, key, values), { bold: true }),
        ...block.bodyParagraphs.map((p) => bodyPara(substitutePlain(p, key, values))),
        ...block.signoffLines.map((line) => bodyPara(substitutePlain(line, key, values), { after: 20 })),
        bodyPara('', { after: 60 }),
        bodyPara(block.checklistTitle, { bold: true }),
        ...block.checklist.map((item) => bodyPara(`${item.step}. ${item.title} — ${item.detail}`, { after: 40 })),
        bodyPara(block.attachmentsTitle, { bold: true }),
        ...block.attachments.map((item) => new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 20 },
          children: [new TextRun({ text: item, size: 20 })],
        })),
      ];
    case 'grid':
      return [gridTable(block, key, values)];
    case 'dualPanel':
      return [new Table({
        width: { size: PAGE_CONTENT_DXA, type: WidthType.DXA },
        columnWidths: [HALF, HALF],
        rows: [new TableRow({
          children: [block.left, block.right].map((side) => cellOf([
            bodyPara(side.title, { bold: true, size: 18 }),
            ...side.bullets.map((bullet) => new Paragraph({
              bullet: { level: 0 },
              spacing: { after: 60 },
              children: [new TextRun({ text: substitutePlain(bullet, key, values), size: 18 })],
            })),
          ], HALF)),
        })],
      })];
    case 'clauses':
      return block.clauses.flatMap((clause) => [
        bodyPara(`${clause.number}. ${clause.heading}`, { bold: true, size: 22, after: 80 }),
        ...clause.subclauses.map((sub) =>
          bodyPara(`${sub.number} ${substitutePlain(sub.text, key, values)}`, { after: 80 })),
      ]);
    case 'workflow':
      return [new Table({
        width: { size: PAGE_CONTENT_DXA, type: WidthType.DXA },
        columnWidths: [700, 2200, 6126],
        rows: block.steps.map((step) => new TableRow({
          children: [
            cellOf([bodyPara(step.num, { bold: true, after: 0 })], 700, true),
            cellOf([bodyPara(step.title, { bold: true, after: 0 })], 2200),
            cellOf([bodyPara(step.text, { after: 0 })], 6126),
          ],
        })),
      })];
    case 'execution':
      return [executionTable(block, key, values)];
    case 'consent':
      return [
        new Paragraph({
          spacing: { before: 120, after: 160 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: '999999', space: 8 } },
          children: [
            new TextRun({ text: `${block.label} — `, bold: true, size: 18 }),
            new TextRun({ text: substitutePlain(block.body, key, values), size: 18 }),
          ],
        }),
        new Table({
          width: { size: PAGE_CONTENT_DXA, type: WidthType.DXA },
          columnWidths: [LABEL, VALUE, LABEL, VALUE],
          rows: [new TableRow({
            children: [
              cellOf([label(block.signatureLabel)], LABEL, true),
              cellOf([bodyPara('______________________________', { after: 0 })], VALUE),
              cellOf([label(block.dateLabel)], LABEL, true),
              cellOf([bodyPara('____ / ____ / ______', { after: 0 })], VALUE),
            ],
          })],
        }),
      ];
    default:
      return [];
  }
}

/** Build the agreement as a .docx Blob, ready for `saveAs`-style download. */
export async function buildAgreementDocx(
  templateKey: AgreementTemplateKey,
  values: AgreementFieldValues,
): Promise<Blob> {
  const content = agreementTemplate(templateKey);
  const children: Child[] = [];

  for (const section of content.sections) {
    if (section.header) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
        spacing: { after: 60 },
        children: [new TextRun({
          text: `${section.header.badge}  ·  ${section.header.heading}`,
          bold: true,
          size: 26,
        })],
      }));
      const subline = [section.header.hint, section.header.sub].filter(Boolean).join(' · ');
      if (subline) {
        children.push(new Paragraph({
          spacing: { after: 200 },
          children: [new TextRun({ text: subline, italics: true, size: 18, color: '666666' })],
        }));
      }
    }
    for (const block of section.blocks) {
      children.push(...blockChildren(block, templateKey, values));
      children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    }
  }

  const doc = new Document({
    creator: 'Agreement Centre',
    title: content.title,
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 20 } },
      },
    },
    sections: [{ children }],
  });

  return Packer.toBlob(doc);
}

export function agreementDocxFileName(
  title: string,
  partnerName: string | null,
  versionText: string,
): string {
  const slug = (value: string) => value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return [slug(title), partnerName ? slug(partnerName) : '', versionText]
    .filter(Boolean).join('-') + '.docx';
}
