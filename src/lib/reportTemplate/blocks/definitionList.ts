/**
 * Definition list — jsPDF.
 *
 * One of three blocks an ACTIVE production template uses that the browser
 * renderer could not draw: 122 instances across fourteen templates, every one
 * of which painted `drawExtrasPlaceholder`'s dashed "renders in HTML/PDF
 * pipeline" box. That was invisible while WeasyPrint drew production
 * documents; RC-3 draws them here, so it stops being invisible.
 *
 * Props: x, y, width, title?, items[] of `{ term, definition }`.
 *
 * The term sits on its own line in bold and the definition wraps beneath it,
 * rather than the two sharing a row. Measured against the HTML twin's own
 * output: a term column wide enough for "Lenders Mortgage Insurance" leaves a
 * definition column too narrow to read at 9pt in a 547pt block, and the
 * stacked form is what the HTML renderer collapses to below its own
 * breakpoint anyway.
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { hex } from './_shared';

interface DefinitionItem { term: string; definition: string }

/** Accepts the authored shape and the two aliases the HTML twin tolerates. */
function readItems(raw: unknown): DefinitionItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      return {
        term: String(o.term ?? o.label ?? o.name ?? '').trim(),
        definition: String(o.definition ?? o.value ?? o.description ?? '').trim(),
      };
    })
    .filter((it) => it.term || it.definition);
}

export function drawDefinitionListBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  let y = Number(p.y ?? 80);
  const w = Number(p.width ?? page.width - 48);

  const ink = hex(resolveBindableColor(p.color ?? 'token:foreground', ctx, '#1A1A1A'));
  const muted = hex(resolveBindableColor(p.mutedColor ?? 'token:muted', ctx, '#666666'));
  const rule = hex(resolveBindableColor(p.ruleColor ?? 'token:border', ctx, '#E2E2E2'));

  const title = resolveBindable(p.title, ctx);
  if (title) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(ink.r, ink.g, ink.b);
    doc.text(title, x, y);
    y += 14;
  }

  const items = readItems(p.items ?? p.data);
  // An authored list with nothing in it draws nothing at all — no heading rule
  // hanging over empty space, and above all no placeholder.
  if (items.length === 0) return;

  for (const [i, item] of items.entries()) {
    if (i > 0) {
      doc.setDrawColor(rule.r, rule.g, rule.b);
      doc.setLineWidth(0.4);
      doc.line(x, y - 7, x + w, y - 7);
    }

    if (item.term) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(ink.r, ink.g, ink.b);
      const termLines = doc.splitTextToSize(item.term, w) as string[];
      doc.text(termLines, x, y);
      y += termLines.length * 12;
    }

    if (item.definition) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(muted.r, muted.g, muted.b);
      const defLines = doc.splitTextToSize(item.definition, w) as string[];
      doc.text(defLines, x, y);
      y += defLines.length * 11;
    }

    y += 10;
  }
}
