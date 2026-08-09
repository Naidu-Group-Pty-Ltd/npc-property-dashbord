/**
 * Agreement Centre — the Word document.
 *
 * This is the format handed to somebody who is going to take the agreement
 * somewhere else: a lawyer marking it up, or an e-signature platform the
 * business already pays for (DocuSign, PandaDoc, Adobe). It is therefore not
 * a fallback for the PDF — it is the deliverable for the whole manual path,
 * and it is built to look like a document a firm would put its name on.
 *
 * ## The composition
 *
 * The document is TWO Word sections, because the cover deserves a page that
 * ordinary margins would ruin:
 *
 *  1. **The cover** — its own section with zero margins, so the brand canvas
 *     runs edge to edge: the deep brand field carrying the title in white
 *     display type, then the tenant's mark and descriptor on paper, then a
 *     particulars band along the foot. No running chrome touches it.
 *  2. **The body** — normal margins, running header (organisation · title)
 *     and footer (version · `Page N of M` as real fields), opening with a
 *     genuine Word table of contents (dot leaders, live page numbers — the
 *     document asks Word to refresh its fields on open), then one section
 *     per page with an editorial opener.
 *
 * Every colour is a role from `docxTheme.ts` resolved out of the tenant's
 * brand; there is not one literal below. Structure is real — tables, page
 * breaks, `cantSplit` signature rows — so the document survives being edited.
 *
 * ## What it must never do
 *
 * The legal wording comes from the locked content modules and is rendered
 * verbatim; unfilled fields print the template's own `<<INSERT>>` bracket
 * text. This module composes and styles. It does not author, reword, reorder
 * or omit a single clause — see `contentStrategicReferral.pure.ts`.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  HeightRule,
  ImageRun,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';

import {
  agreementTemplate,
  substitutePlain,
  EXECUTION_PANEL_LINES,
  type AgreementBlock,
  type AgreementFieldValues,
  type AgreementSectionDef,
  type AgreementTemplateKey,
  type ClauseGroupBlock,
  type ConsentBlock,
  type CoverBlock,
  type DualPanelBlock,
  type EmailTemplateBlock,
  type ExecutionBlock,
  type GridBlock,
  type GridCellDef,
  type NoteBlock,
  type WorkflowBlock,
} from '@/lib/agreements';
import {
  DOCX_CONTENT_WIDTH,
  DOCX_FONTS,
  DOCX_PAGE,
  DOCX_TYPE,
  resolveDocxPalette,
  type DocxPalette,
} from './docxTheme';

type Child = Paragraph | Table;

/** Points → half-points, the unit every `size` in this file is given in. */
const pt = (points: number) => Math.round(points * 2);

const CHECKBOX_EMPTY = '☐';
const CHECKBOX_CHECKED = '☑';

const SIGNATURE_RULE = '______________________________';
const DATE_RULE = '____ / ____ / ______';
const WITNESS_RULE = '__________________';

/** Column geometry. Four-column grids are label/value twice. */
const LABEL_W = Math.round(DOCX_CONTENT_WIDTH * 0.19);
const VALUE_W = Math.round(DOCX_CONTENT_WIDTH / 2) - LABEL_W;
const HALF_W = Math.round(DOCX_CONTENT_WIDTH / 2);

/** The cover's three bands, in twips. Their sum stays under the page height
 * so the section-break paragraph Word requires never spills to a second page. */
const COVER = {
  // The canvas gave up 1,200 twips to the particulars below it. Forty per cent
  // of an A4 page in one saturated field was a title slide; a third of it,
  // with the rest carrying facts, is a front sheet.
  canvas: 5600,
  foot: 2600,
  middleAtLeast: 7800,
  inset: 1250,
} as const;

export interface AgreementDocxBrand {
  /** The tenant's brand colour in any form `whitelabel_settings` accepts. */
  brandColour?: string | null;
  companyName?: string | null;
  legalName?: string | null;
  abn?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  /** The report mark, already fetched. Failure to fetch simply omits it. */
  logo?: { data: ArrayBuffer; type: 'png' | 'jpg' | 'gif' | 'bmp'; widthPx: number; heightPx: number } | null;
}

// ── Borders ─────────────────────────────────────────────────────────────────

const NONE = { style: BorderStyle.NONE, size: 0, color: 'auto' } as const;

function noBorders() {
  return {
    top: NONE, bottom: NONE, left: NONE, right: NONE,
    insideHorizontal: NONE, insideVertical: NONE,
  };
}

/** Hairlines inside, a confident brand rule along the top. */
function framedGrid(palette: DocxPalette) {
  const line = { style: BorderStyle.SINGLE, size: 2, color: palette.rule } as const;
  return {
    top: { style: BorderStyle.SINGLE, size: 8, color: palette.rule },
    bottom: line, left: line, right: line,
    insideHorizontal: line, insideVertical: line,
  };
}

function panelBorders(palette: DocxPalette) {
  return {
    top: { style: BorderStyle.SINGLE, size: 8, color: palette.rule },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: palette.rule },
    left: { style: BorderStyle.SINGLE, size: 2, color: palette.rule },
    right: { style: BorderStyle.SINGLE, size: 2, color: palette.rule },
    insideHorizontal: NONE,
    insideVertical: { style: BorderStyle.SINGLE, size: 2, color: palette.rule },
  };
}

// ── Type helpers ────────────────────────────────────────────────────────────

interface RunOpts {
  bold?: boolean;
  italics?: boolean;
  size?: number;
  color?: string;
  font?: string;
  allCaps?: boolean;
  characterSpacing?: number;
}

function run(text: string, palette: DocxPalette, opts: RunOpts = {}): TextRun {
  return new TextRun({
    text,
    bold: opts.bold,
    italics: opts.italics,
    size: pt(opts.size ?? DOCX_TYPE.body),
    color: opts.color ?? palette.ink,
    font: opts.font ?? DOCX_FONTS.body,
    allCaps: opts.allCaps,
    characterSpacing: opts.characterSpacing,
  });
}

/** The micro label used on every field, panel title and eyebrow. */
function microLabel(text: string, palette: DocxPalette, color?: string): Paragraph {
  return new Paragraph({
    spacing: { after: 40 },
    children: [run(text, palette, {
      size: DOCX_TYPE.micro,
      color: color ?? palette.mutedInk,
      font: DOCX_FONTS.mono,
      bold: true,
      allCaps: true,
      characterSpacing: 24,
    })],
  });
}

function spacer(after = 120): Paragraph {
  return new Paragraph({ spacing: { after }, children: [] });
}

// ── Cells ───────────────────────────────────────────────────────────────────

function cell(children: Child[], width: number, opts: {
  fill?: string;
  span?: number;
  valign?: 'top' | 'center' | 'bottom';
  margins?: { top: number; bottom: number; left: number; right: number };
} = {}): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: opts.span,
    verticalAlign: opts.valign,
    margins: opts.margins ?? { top: 110, bottom: 110, left: 150, right: 150 },
    shading: opts.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill } : undefined,
    children,
  });
}

// ── Value rendering ─────────────────────────────────────────────────────────

/**
 * A choice cell sets each option on its own line, the box tied to its label
 * with a no-break space. Options used to share one line and wrap wherever the
 * cell ran out — a checkbox stranded at a line end, its label on the next, is
 * the fastest way for a form to stop feeling designed. The selected option is
 * the only one allowed any weight.
 */
function choiceParagraphs(cellDef: GridCellDef, values: AgreementFieldValues, palette: DocxPalette): Paragraph[] {
  const choice = cellDef.choice!;
  const raw = values[choice.fieldKey];
  const selected = raw === null || raw === undefined ? '' : String(raw);
  const optionValues = choice.options.map((option) => option.value);
  const customValue = selected && !optionValues.includes(selected) ? selected : '';

  const out: Paragraph[] = [];
  if (choice.lead) {
    out.push(new Paragraph({
      spacing: { after: 60, line: 264 },
      children: [run(choice.lead, palette, { size: DOCX_TYPE.caption, color: palette.mutedInk })],
    }));
  }
  choice.options.forEach((option, index) => {
    const isOther = option.value === 'other';
    const checked = selected === option.value || (isOther && Boolean(customValue));
    let label = option.label;
    if (isOther) {
      const otherText = choice.otherFieldKey ? values[choice.otherFieldKey] : customValue;
      if (otherText !== null && otherText !== undefined && String(otherText).trim() !== '') {
        label += ` ${String(otherText)}`;
      }
    }
    out.push(new Paragraph({
      spacing: { after: index === choice.options.length - 1 ? 0 : 40, line: 264 },
      children: [
        run(`${checked ? CHECKBOX_CHECKED : CHECKBOX_EMPTY}\u00A0`, palette, {
          size: DOCX_TYPE.caption,
          color: checked ? palette.accentInk : palette.mutedInk,
          bold: checked,
        }),
        run(label, palette, { size: DOCX_TYPE.caption, bold: checked }),
      ],
    }));
  });
  return out;
}

/**
 * A verbatim text cell that is itself a checkbox group — the glyphs are part
 * of the locked agreement text (`☐ Yes   ☐ No`). The wording is untouchable;
 * the line layout is not, so these are set one option per line exactly like a
 * bound choice cell rather than left to wrap wherever the cell runs out —
 * which stranded boxes at line ends all over the registration form.
 */
function checkboxGroupParagraphs(text: string, palette: DocxPalette): Paragraph[] | null {
  const parts = text.trim().split(/\s{2,}/);
  if (parts.length < 2 || !parts.every((part) => /^[☐☑]\s?\S/.test(part))) return null;
  return parts.map((part, index) => {
    const checked = part.startsWith(CHECKBOX_CHECKED);
    return new Paragraph({
      spacing: { after: index === parts.length - 1 ? 0 : 40, line: 264 },
      children: [
        run(`${part.slice(0, 1)}\u00A0`, palette, {
          size: DOCX_TYPE.caption,
          color: checked ? palette.accentInk : palette.mutedInk,
          bold: checked,
        }),
        run(part.slice(1).trimStart(), palette, { size: DOCX_TYPE.caption, bold: checked }),
      ],
    });
  });
}

function cellValueText(cellDef: GridCellDef, key: AgreementTemplateKey, values: AgreementFieldValues): string {
  if (cellDef.template) return substitutePlain(cellDef.template, key, values);
  if (cellDef.fieldKey) return substitutePlain(`{{${cellDef.fieldKey}}}`, key, values);
  return cellDef.text ?? '';
}

/**
 * A value is set in the muted ink when it is still the template's own bracket
 * text, so a reader can see at a glance what has not been completed — the same
 * signal the PDF gives with `.agc-unfilled`.
 */
function isUnfilled(text: string): boolean {
  return /^<<.*>>$/.test(text.trim()) || text.trim() === '';
}

function valueParagraph(text: string, palette: DocxPalette): Paragraph {
  return new Paragraph({
    spacing: { after: 0, line: 264 },
    children: [run(text || '—', palette, {
      color: isUnfilled(text) ? palette.mutedInk : palette.ink,
    })],
  });
}

// ── The cover section ───────────────────────────────────────────────────────

/** One full-width band of the cover: a single shaded cell, edge to edge. */
function coverBand(
  children: Child[],
  palette: DocxPalette,
  opts: { fill?: string; heightTwip?: number; rule?: (typeof HeightRule)[keyof typeof HeightRule] },
): TableRow {
  return new TableRow({
    height: opts.heightTwip
      ? { value: opts.heightTwip, rule: opts.rule ?? HeightRule.EXACT }
      : undefined,
    cantSplit: true,
    children: [new TableCell({
      width: { size: DOCX_PAGE.widthTwip, type: WidthType.DXA },
      verticalAlign: VerticalAlign.CENTER,
      shading: opts.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill } : undefined,
      margins: { top: 200, bottom: 200, left: COVER.inset, right: COVER.inset },
      children,
    })],
  });
}

function centred(children: TextRun[], spacing: { before?: number; after?: number; line?: number } = {}): Paragraph {
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing, children });
}

/** A left-aligned cover line. Covers are set flush left, not centred. */
function coverLine(
  children: TextRun[],
  spacing: { before?: number; after?: number; line?: number } = {},
): Paragraph {
  return new Paragraph({ alignment: AlignmentType.LEFT, spacing, children });
}

/**
 * The particulars panel — who is bound, and on what terms.
 *
 * Set as a label/value table with hairline separators, the way the front sheet
 * of an executed agreement reads. The value column is the display serif: these
 * are proper nouns and dates, not form data, and setting them in the body face
 * makes the panel look like a form the reader has to fill in rather than a
 * statement of who the parties are.
 *
 * An unfilled value keeps its `<<INSERT>>` bracket in the muted ink — the same
 * signal every other unbound field in the document gives.
 */
function particularsPanel(
  block: CoverBlock,
  key: AgreementTemplateKey,
  values: AgreementFieldValues,
  palette: DocxPalette,
): Table {
  const width = DOCX_PAGE.widthTwip - COVER.inset * 2;
  const labelW = Math.round(width * 0.21);
  const hair = { style: BorderStyle.SINGLE, size: 4, color: palette.rule } as const;

  return new Table({
    width: { size: width, type: WidthType.DXA },
    columnWidths: [labelW, width - labelW],
    borders: {
      top: NONE, bottom: NONE, left: NONE, right: NONE,
      insideHorizontal: hair, insideVertical: NONE,
    },
    rows: block.particulars.map((entry) => {
      const text = substitutePlain(entry.value, key, values);
      return new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: labelW, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 130, bottom: 130, left: 0, right: 160 },
            children: [new Paragraph({
              spacing: { after: 0 },
              children: [run(entry.label, palette, {
                size: DOCX_TYPE.micro,
                font: DOCX_FONTS.mono,
                bold: true,
                allCaps: true,
                characterSpacing: 30,
                color: palette.labelInk,
              })],
            })],
          }),
          new TableCell({
            width: { size: width - labelW, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 130, bottom: 130, left: 0, right: 0 },
            children: [new Paragraph({
              spacing: { after: 0, line: 264 },
              children: [run(text || '—', palette, {
                size: DOCX_TYPE.coverDescriptor,
                font: DOCX_FONTS.display,
                color: isUnfilled(text) ? palette.mutedInk : palette.ink,
              })],
            })],
          }),
        ],
      });
    }),
  });
}

function coverSectionChildren(
  block: CoverBlock,
  key: AgreementTemplateKey,
  values: AgreementFieldValues,
  palette: DocxPalette,
  brand: AgreementDocxBrand,
): Child[] {
  const companyDisplay = substitutePlain(block.companyNameToken, key, values);

  // Band 1 — the brand canvas. Deep field, white display type, set flush left.
  //
  // Left, not centred: a centred title over a centred subtitle over a centred
  // rule is the composition of a certificate, and it is what made the previous
  // cover read as ceremonial rather than contractual. Flush left also fixes
  // the ragged three-line title, which broke to an orphaned "REFERRAL".
  const canvas = coverBand([
    coverLine([run(companyDisplay, palette, {
      size: DOCX_TYPE.coverCompany,
      font: DOCX_FONTS.mono,
      bold: true,
      allCaps: true,
      characterSpacing: 66,
      color: palette.onDeepMuted,
    })], { after: 640 }),
    ...block.titleLines.map((line, index) => coverLine([
      run(line, palette, {
        size: DOCX_TYPE.coverTitle,
        font: DOCX_FONTS.display,
        color: 'FFFFFF',
      }),
    ], { after: index === block.titleLines.length - 1 ? 420 : 40 })),
    // A short hairline holds the issuer line to the title instead of letting
    // it drift in the field.
    new Paragraph({
      spacing: { after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: palette.onDeepMuted, space: 1 } },
      indent: { right: Math.round((DOCX_PAGE.widthTwip - COVER.inset * 2) * 0.62) },
      children: [],
    }),
    coverLine([run(block.issuedByLine, palette, {
      size: DOCX_TYPE.micro,
      font: DOCX_FONTS.mono,
      bold: true,
      allCaps: true,
      characterSpacing: 44,
      color: palette.onDeepMuted,
    })], { after: 0 }),
  ], palette, { fill: palette.accentDeep, heightTwip: COVER.canvas });

  // Band 2 — paper. The mark, then the particulars: who is bound, and on what
  // terms. This is the half of the cover that carries information.
  const middleChildren: Child[] = [];
  if (brand.logo) {
    const targetH = 64;
    const ratio = brand.logo.heightPx > 0 ? brand.logo.widthPx / brand.logo.heightPx : 3;
    middleChildren.push(new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 420 },
      children: [new ImageRun({
        type: brand.logo.type,
        data: brand.logo.data,
        transformation: { width: Math.round(targetH * ratio), height: targetH },
      })],
    }));
  }
  middleChildren.push(
    coverLine([run('PARTICULARS', palette, {
      size: DOCX_TYPE.micro,
      font: DOCX_FONTS.mono,
      bold: true,
      allCaps: true,
      characterSpacing: 40,
      color: palette.labelInk,
    })], { after: 60 }),
    new Paragraph({
      spacing: { after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: palette.accent, space: 2 } },
      indent: { right: Math.round((DOCX_PAGE.widthTwip - COVER.inset * 2) * 0.82) },
      children: [],
    }),
    particularsPanel(block, key, values, palette),
  );
  const middle = coverBand(middleChildren, palette, {
    heightTwip: COVER.middleAtLeast, rule: HeightRule.ATLEAST,
  });

  // Band 3 — the foot. Version line and the review statement, flush left so
  // the whole page shares one edge.
  const foot = coverBand([
    new Paragraph({
      spacing: { after: 140 },
      children: [run(substitutePlain(block.versionLine, key, values), palette, {
        size: DOCX_TYPE.caption,
        font: DOCX_FONTS.mono,
        characterSpacing: 20,
        color: palette.ink,
      })],
    }),
    coverLine([run(block.reviewStatement, palette, {
      size: DOCX_TYPE.micro,
      italics: true,
      color: palette.mutedInk,
    })], { after: 0 }),
  ], palette, { fill: palette.panel, heightTwip: COVER.foot });

  return [new Table({
    width: { size: DOCX_PAGE.widthTwip, type: WidthType.DXA },
    columnWidths: [DOCX_PAGE.widthTwip],
    borders: noBorders(),
    rows: [canvas, middle, foot],
  })];
}

// ── The body ────────────────────────────────────────────────────────────────

/** The editorial section opener: eyebrow rule, real Heading 1, dek, brand rule. */
function sectionOpener(section: AgreementSectionDef, palette: DocxPalette, breakBefore: boolean): Child[] {
  const header = section.header!;
  const subline = [header.hint, header.sub].filter(Boolean).join('  ·  ');
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: breakBefore,
      keepNext: true,
      spacing: { after: 60 },
      children: [
        run(`${header.badge}`, palette, {
          size: DOCX_TYPE.sectionHeading,
          font: DOCX_FONTS.display,
          color: palette.accentInk,
        }),
        run('   ', palette),
        run(header.heading, palette, {
          size: DOCX_TYPE.sectionHeading,
          font: DOCX_FONTS.display,
          color: palette.ink,
        }),
      ],
    }),
    ...(subline ? [new Paragraph({
      keepNext: true,
      spacing: { after: 120 },
      children: [run(subline, palette, {
        size: DOCX_TYPE.caption, color: palette.mutedInk, italics: true, font: DOCX_FONTS.display,
      })],
    })] : []),
    new Paragraph({
      keepNext: true,
      spacing: { after: 260 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: palette.accent, space: 2 } },
      children: [],
    }),
  ];
}

/** The contents page: a real Word TOC — dot leaders, live page numbers. */
function contentsChildren(title: string, palette: DocxPalette): Child[] {
  return [
    microLabel('Contents', palette, palette.labelInk),
    new Paragraph({
      spacing: { after: 80 },
      children: [run(title, palette, {
        size: DOCX_TYPE.sectionHeading, font: DOCX_FONTS.display, color: palette.ink,
      })],
    }),
    new Paragraph({
      spacing: { after: 260 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: palette.accent, space: 2 } },
      children: [],
    }),
    new TableOfContents('Contents', {
      hyperlink: true,
      headingStyleRange: '1-1',
    }),
  ];
}

function noteBlock(block: NoteBlock, key: AgreementTemplateKey, values: AgreementFieldValues, palette: DocxPalette): Child[] {
  return [new Table({
    width: { size: DOCX_CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [DOCX_CONTENT_WIDTH],
    borders: {
      top: NONE, bottom: NONE, right: NONE,
      left: { style: BorderStyle.SINGLE, size: 10, color: palette.accent },
      insideHorizontal: NONE, insideVertical: NONE,
    },
    rows: [new TableRow({
      cantSplit: true,
      children: [cell([
        microLabel(block.label, palette, palette.labelInk),
        new Paragraph({
          spacing: { after: 0, line: 276 },
          children: [run(substitutePlain(block.body, key, values), palette, { size: DOCX_TYPE.caption })],
        }),
      ], DOCX_CONTENT_WIDTH, { fill: palette.accentWash })],
    })],
  }), spacer(180)];
}

function gridBlock(block: GridBlock, key: AgreementTemplateKey, values: AgreementFieldValues, palette: DocxPalette): Child[] {
  const twoUp = block.rows.every((cells) => cells.length === 2);
  const rows = block.rows.map((cells) => {
    const rowCells: TableCell[] = [];
    for (const cellDef of cells) {
      const single = cells.length === 1;
      rowCells.push(cell(
        [microLabel(cellDef.label, palette, palette.labelInk)],
        LABEL_W,
        { fill: palette.accentWash, valign: VerticalAlign.CENTER },
      ));
      const text = cellDef.choice ? '' : cellValueText(cellDef, key, values);
      rowCells.push(cell(
        cellDef.choice
          ? choiceParagraphs(cellDef, values, palette)
          : checkboxGroupParagraphs(text, palette) ?? [valueParagraph(text, palette)],
        single ? DOCX_CONTENT_WIDTH - LABEL_W : VALUE_W,
        { span: single && twoUp ? 3 : undefined, valign: VerticalAlign.CENTER },
      ));
    }
    return new TableRow({ cantSplit: true, children: rowCells });
  });

  return [new Table({
    width: { size: DOCX_CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: twoUp ? [LABEL_W, VALUE_W, LABEL_W, VALUE_W] : [LABEL_W, DOCX_CONTENT_WIDTH - LABEL_W],
    borders: framedGrid(palette),
    rows,
  }), spacer(180)];
}

function dualPanelBlock(block: DualPanelBlock, key: AgreementTemplateKey, values: AgreementFieldValues, palette: DocxPalette): Child[] {
  const panel = (side: { title: string; bullets: string[] }) => cell([
    microLabel(side.title, palette, palette.labelInk),
    spacer(40),
    ...side.bullets.map((bullet, index) => new Paragraph({
      spacing: { after: index === side.bullets.length - 1 ? 0 : 100, line: 276 },
      indent: { left: 260, hanging: 260 },
      children: [
        run('•   ', palette, { color: palette.labelInk, bold: true }),
        run(substitutePlain(bullet, key, values), palette, { size: DOCX_TYPE.caption }),
      ],
    })),
  ], HALF_W, { margins: { top: 160, bottom: 160, left: 190, right: 190 } });

  return [new Table({
    width: { size: DOCX_CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [HALF_W, HALF_W],
    borders: panelBorders(palette),
    rows: [new TableRow({ cantSplit: true, children: [panel(block.left), panel(block.right)] })],
  }), spacer(180)];
}

function clauseBlock(block: ClauseGroupBlock, key: AgreementTemplateKey, values: AgreementFieldValues, palette: DocxPalette): Child[] {
  const out: Child[] = [];
  for (const clause of block.clauses) {
    out.push(new Paragraph({
      spacing: { before: 200, after: 120 },
      keepNext: true,
      keepLines: true,
      children: [
        run(`${clause.number}.  `, palette, {
          size: DOCX_TYPE.clauseHeading, font: DOCX_FONTS.display, color: palette.accentInk,
        }),
        run(clause.heading, palette, {
          size: DOCX_TYPE.clauseHeading, font: DOCX_FONTS.display, color: palette.ink,
        }),
      ],
    }));
    clause.subclauses.forEach((sub, index) => {
      out.push(new Paragraph({
        spacing: { after: index === clause.subclauses.length - 1 ? 80 : 90, line: 288 },
        indent: { left: 780, hanging: 780 },
        keepLines: true,
        children: [
          run(sub.number, palette, {
            size: DOCX_TYPE.caption, font: DOCX_FONTS.mono, color: palette.mutedInk,
          }),
          run('\t', palette),
          run(substitutePlain(sub.text, key, values), palette),
        ],
        tabStops: [{ type: TabStopType.LEFT, position: 780 }],
      }));
    });
  }
  out.push(spacer(120));
  return out;
}

function workflowBlock(block: WorkflowBlock, palette: DocxPalette): Child[] {
  const line = { style: BorderStyle.SINGLE, size: 2, color: palette.rule } as const;
  return [new Table({
    width: { size: DOCX_CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [700, 2000, DOCX_CONTENT_WIDTH - 2700],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 8, color: palette.rule },
      bottom: line, left: NONE, right: NONE,
      insideHorizontal: line, insideVertical: NONE,
    },
    rows: block.steps.map((step) => new TableRow({
      cantSplit: true,
      children: [
        // The stage numeral on a solid brand plate — the workflow reads as a
        // designed graphic rather than a table that happens to have numbers.
        cell([centred([run(step.num, palette, {
          size: DOCX_TYPE.clauseHeading, font: DOCX_FONTS.display, color: palette.onAccent,
        })], { after: 0 })], 700, { fill: palette.accent, valign: VerticalAlign.CENTER, margins: { top: 90, bottom: 90, left: 60, right: 60 } }),
        cell([new Paragraph({
          spacing: { after: 0 },
          children: [run(step.title, palette, {
            size: DOCX_TYPE.micro, font: DOCX_FONTS.mono, bold: true, allCaps: true,
            characterSpacing: 26, color: palette.labelInk,
          })],
        })], 2000, { valign: VerticalAlign.CENTER }),
        cell([new Paragraph({
          spacing: { after: 0, line: 264 },
          children: [run(step.text, palette, { size: DOCX_TYPE.caption, color: palette.ink })],
        })], DOCX_CONTENT_WIDTH - 2700, { valign: VerticalAlign.CENTER }),
      ],
    })),
  }), spacer(180)];
}

function emailBlock(block: EmailTemplateBlock, key: AgreementTemplateKey, values: AgreementFieldValues, palette: DocxPalette): Child[] {
  const leftW = Math.round(DOCX_CONTENT_WIDTH * 0.58);
  const left = cell([
    microLabel(block.subjectLabel, palette, palette.labelInk),
    new Paragraph({
      spacing: { after: 180 },
      children: [run(substitutePlain(block.subject, key, values), palette, {
        size: DOCX_TYPE.clauseHeading, font: DOCX_FONTS.display,
      })],
    }),
    ...block.bodyParagraphs.map((paragraph) => new Paragraph({
      spacing: { after: 130, line: 276 },
      children: [run(substitutePlain(paragraph, key, values), palette, { size: DOCX_TYPE.caption })],
    })),
    ...block.signoffLines.map((line, index) => new Paragraph({
      spacing: { after: index === block.signoffLines.length - 1 ? 0 : 30 },
      children: [run(substitutePlain(line, key, values), palette, { size: DOCX_TYPE.caption })],
    })),
  ], leftW, { margins: { top: 160, bottom: 160, left: 190, right: 190 } });

  const right = cell([
    microLabel(block.checklistTitle, palette, palette.labelInk),
    spacer(40),
    ...block.checklist.flatMap((item) => [
      new Paragraph({
        spacing: { after: 20 },
        children: [
          run(`${item.step}  `, palette, {
            size: DOCX_TYPE.caption, font: DOCX_FONTS.display, color: palette.accentInk,
          }),
          run(item.title, palette, {
            size: DOCX_TYPE.micro, font: DOCX_FONTS.mono, bold: true, allCaps: true,
            characterSpacing: 20,
          }),
        ],
      }),
      new Paragraph({
        spacing: { after: 110 },
        indent: { left: 230 },
        children: [run(item.detail, palette, { size: DOCX_TYPE.micro, color: palette.mutedInk })],
      }),
    ]),
    microLabel(block.attachmentsTitle, palette, palette.labelInk),
    ...block.attachments.map((item, index) => new Paragraph({
      spacing: { after: index === block.attachments.length - 1 ? 0 : 50 },
      indent: { left: 230, hanging: 230 },
      children: [
        run('•   ', palette, { color: palette.labelInk }),
        run(item, palette, { size: DOCX_TYPE.caption }),
      ],
    })),
  ], DOCX_CONTENT_WIDTH - leftW, { fill: palette.accentWash, margins: { top: 160, bottom: 160, left: 190, right: 190 } });

  return [new Table({
    width: { size: DOCX_CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [leftW, DOCX_CONTENT_WIDTH - leftW],
    borders: panelBorders(palette),
    rows: [new TableRow({ children: [left, right] })],
  }), spacer(180)];
}

function signatureLine(label: string, value: string, palette: DocxPalette, muted = false): Paragraph {
  return new Paragraph({
    spacing: { after: 140 },
    children: [
      run(`${label} `, palette, {
        size: DOCX_TYPE.micro, font: DOCX_FONTS.mono, color: palette.mutedInk,
      }),
      run(value, palette, {
        size: DOCX_TYPE.caption,
        color: muted ? palette.mutedInk : palette.ink,
      }),
    ],
  });
}

function executionBlock(block: ExecutionBlock, key: AgreementTemplateKey, values: AgreementFieldValues, palette: DocxPalette): Child[] {
  const entityFor = (role: string): string => {
    const source = role === 'partner' ? values.fp_legal_name
      : role === 'loan_writer' ? values.lw_entity
      : values.ba_legal_name;
    return String(source ?? '').trim() || '<<INSERT>>';
  };
  const prefill = (role: string, field: 'name' | 'title'): string => {
    const source = role === 'partner' ? values[`partner_signatory_${field}`]
      : role === 'principal' ? values[`principal_signatory_${field}`]
      : null;
    return String(source ?? '').trim() || '<<INSERT>>';
  };

  return [new Table({
    width: { size: DOCX_CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [HALF_W, HALF_W],
    borders: panelBorders(palette),
    rows: [new TableRow({
      // A signature panel split across a page break is the classic fault in a
      // generated contract; this is the line that prevents it.
      cantSplit: true,
      children: block.parties.map((party) => {
        const entity = entityFor(party.role);
        const name = prefill(party.role, 'name');
        const title = prefill(party.role, 'title');
        return cell([
          microLabel(party.title, palette, palette.labelInk),
          spacer(80),
          signatureLine(EXECUTION_PANEL_LINES.legalEntity, entity, palette, isUnfilled(entity)),
          signatureLine(EXECUTION_PANEL_LINES.signatoryName, name, palette, isUnfilled(name)),
          signatureLine(EXECUTION_PANEL_LINES.signatoryTitle, title, palette, isUnfilled(title)),
          signatureLine(EXECUTION_PANEL_LINES.signature, SIGNATURE_RULE, palette, true),
          signatureLine(EXECUTION_PANEL_LINES.date, DATE_RULE, palette, true),
          new Paragraph({
            spacing: { after: 0 },
            children: [
              run(`${EXECUTION_PANEL_LINES.witness} `, palette, {
                size: DOCX_TYPE.micro, font: DOCX_FONTS.mono, color: palette.mutedInk,
              }),
              run(WITNESS_RULE, palette, { size: DOCX_TYPE.caption, color: palette.mutedInk }),
            ],
          }),
        ], HALF_W, { margins: { top: 180, bottom: 180, left: 200, right: 200 } });
      }),
    })],
  }), spacer(180)];
}

function consentBlock(block: ConsentBlock, key: AgreementTemplateKey, values: AgreementFieldValues, palette: DocxPalette): Child[] {
  return [
    ...noteBlock({ kind: 'note', label: block.label, body: block.body }, key, values, palette),
    new Table({
      width: { size: DOCX_CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [LABEL_W, VALUE_W, LABEL_W, VALUE_W],
      borders: framedGrid(palette),
      rows: [new TableRow({
        cantSplit: true,
        children: [
          cell([microLabel(block.signatureLabel, palette, palette.labelInk)], LABEL_W, { fill: palette.accentWash, valign: VerticalAlign.CENTER }),
          cell([valueParagraph(SIGNATURE_RULE, palette)], VALUE_W),
          cell([microLabel(block.dateLabel, palette, palette.labelInk)], LABEL_W, { fill: palette.accentWash, valign: VerticalAlign.CENTER }),
          cell([valueParagraph(DATE_RULE, palette)], VALUE_W),
        ],
      })],
    }),
    spacer(180),
  ];
}

function blockChildren(
  block: AgreementBlock,
  key: AgreementTemplateKey,
  values: AgreementFieldValues,
  palette: DocxPalette,
): Child[] {
  switch (block.kind) {
    case 'note': return noteBlock(block, key, values, palette);
    case 'emailTemplate': return emailBlock(block, key, values, palette);
    case 'grid': return gridBlock(block, key, values, palette);
    case 'dualPanel': return dualPanelBlock(block, key, values, palette);
    case 'clauses': return clauseBlock(block, key, values, palette);
    case 'workflow': return workflowBlock(block, palette);
    case 'execution': return executionBlock(block, key, values, palette);
    case 'consent': return consentBlock(block, key, values, palette);
    default: return [];
  }
}

// ── The document ────────────────────────────────────────────────────────────

export interface AgreementDocxOptions {
  brand?: AgreementDocxBrand;
  /** Include the Section E partner-email pack. On for template exports. */
  includeTemplatePack?: boolean;
}

/**
 * What the tenant's own identity fills in, when the caller has not.
 *
 * A blank template a business downloads should still be *their* document: the
 * cover wordmark, the correspondence sign-off and the issuing party's details
 * are facts we already hold. Explicit values always win — this only fills
 * gaps, so a configured agreement is unaffected.
 */
function brandDerivedValues(brand: AgreementDocxBrand): AgreementFieldValues {
  const text = (value: unknown) => {
    const raw = String(value ?? '').trim();
    return raw || undefined;
  };
  const display = text(brand.companyName) ?? text(brand.legalName);
  return {
    company_name: display,
    ba_display_name: display,
    company_phone: text(brand.phone),
    company_email: text(brand.email),
    company_website: text(brand.website),
    ba_legal_name: text(brand.legalName) ?? display,
    ba_trading_name: text(brand.companyName),
    ba_abn_acn: text(brand.abn),
    ba_address: text(brand.address),
    ba_email: text(brand.email),
  };
}

/** Build the agreement as a `.docx` Blob. */
export async function buildAgreementDocx(
  templateKey: AgreementTemplateKey,
  fieldValues: AgreementFieldValues,
  options: AgreementDocxOptions = {},
): Promise<Blob> {
  const content = agreementTemplate(templateKey);
  const brand = options.brand ?? {};
  const palette = resolveDocxPalette(brand.brandColour);
  const includePack = options.includeTemplatePack !== false;

  // Gap-fill only: an explicitly-supplied value, including a deliberately
  // empty one, is never overwritten by the tenant's defaults.
  const derived = brandDerivedValues(brand);
  const values: AgreementFieldValues = { ...derived };
  for (const [key, value] of Object.entries(fieldValues)) {
    if (value !== null && value !== undefined && String(value).trim() !== '') values[key] = value;
    else if (!(key in derived)) values[key] = value;
  }

  const sections = content.sections.filter(
    (section) => section.audience === 'always' || includePack,
  );
  const mastheadName = (brand.companyName || brand.legalName || '').trim();

  // The cover — its own zero-margin section.
  const coverSource = sections.find((section) => !section.header)?.blocks[0];
  const coverChildren = coverSource?.kind === 'cover'
    ? coverSectionChildren(coverSource, templateKey, values, palette, brand)
    : [];

  // The body — contents, then one page per section.
  const body: Child[] = contentsChildren(content.title, palette);
  for (const section of sections) {
    if (!section.header) continue;
    body.push(...sectionOpener(section, palette, true));
    for (const block of section.blocks) {
      body.push(...blockChildren(block, templateKey, values, palette));
    }
  }

  const pageGeometry = {
    size: { width: DOCX_PAGE.widthTwip, height: DOCX_PAGE.heightTwip },
  };

  const doc = new Document({
    creator: mastheadName || 'Agreement Centre',
    title: content.title,
    description: content.issuedByLine,
    // The TOC carries live page numbers; asking Word to refresh fields on
    // open is what keeps them true without the reader knowing to press F9.
    features: { updateFields: true },
    styles: {
      default: {
        document: { run: { font: DOCX_FONTS.body, size: pt(DOCX_TYPE.body), color: palette.ink } },
        // The section openers claim Heading 1, which is what feeds the TOC
        // and Word's navigation pane.
        heading1: {
          run: { font: DOCX_FONTS.display, size: pt(DOCX_TYPE.sectionHeading), color: palette.ink, bold: false },
          paragraph: { spacing: { before: 0, after: 120 } },
        },
      },
      paragraphStyles: [
        {
          id: 'TOC1',
          name: 'toc 1',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: DOCX_FONTS.body, size: pt(DOCX_TYPE.body), color: palette.ink },
          paragraph: { spacing: { before: 60, after: 60 } },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            ...pageGeometry,
            margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 },
          },
        },
        children: coverChildren,
      },
      {
        properties: {
          page: {
            ...pageGeometry,
            margin: {
              top: DOCX_PAGE.marginTop,
              bottom: DOCX_PAGE.marginBottom,
              left: DOCX_PAGE.marginX,
              right: DOCX_PAGE.marginX,
              header: DOCX_PAGE.headerTwip,
              footer: DOCX_PAGE.footerTwip,
            },
          },
        },
        headers: {
          default: new Header({
            children: [new Paragraph({
              spacing: { after: 0 },
              border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: palette.rule, space: 6 } },
              tabStops: [{ type: TabStopType.RIGHT, position: DOCX_CONTENT_WIDTH }],
              children: [
                run(mastheadName, palette, {
                  size: DOCX_TYPE.micro, font: DOCX_FONTS.mono, bold: true, color: palette.accentInk,
                  allCaps: true, characterSpacing: 26,
                }),
                run('\t', palette),
                run(content.title, palette, {
                  size: DOCX_TYPE.micro, font: DOCX_FONTS.mono, color: palette.mutedInk,
                }),
              ],
            })],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              spacing: { before: 0 },
              tabStops: [{ type: TabStopType.RIGHT, position: DOCX_CONTENT_WIDTH }],
              children: [
                run('▪ ', palette, { size: DOCX_TYPE.micro, color: palette.accent }),
                run(content.documentVersion ? `Version ${content.documentVersion}` : '', palette, {
                  size: DOCX_TYPE.micro, font: DOCX_FONTS.mono, color: palette.mutedInk,
                }),
                run('\t', palette),
                new TextRun({
                  children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
                  size: pt(DOCX_TYPE.micro),
                  font: DOCX_FONTS.mono,
                  color: palette.mutedInk,
                }),
              ],
            })],
          }),
        },
        children: body,
      },
    ],
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

/**
 * Fetch the tenant's report mark for embedding.
 *
 * Best-effort by design: a mark that will not load must not stop a download,
 * so every failure path returns null and the cover falls back to the wordmark.
 */
export async function loadDocxLogo(url: string | null | undefined): Promise<AgreementDocxBrand['logo']> {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    const type = contentType.includes('png') ? 'png'
      : /jpe?g/.test(contentType) ? 'jpg'
        : contentType.includes('gif') ? 'gif'
          : contentType.includes('bmp') ? 'bmp'
            : null;
    // SVG has no pixel dimensions and `ImageRun` cannot embed it.
    if (!type) return null;
    const data = await response.arrayBuffer();
    const size = await new Promise<{ width: number; height: number } | null>((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve(null);
      image.src = url;
    });
    if (!size || !size.width || !size.height) return null;
    return { data, type, widthPx: size.width, heightPx: size.height };
  } catch {
    return null;
  }
}
