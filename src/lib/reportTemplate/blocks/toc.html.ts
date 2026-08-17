import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { esc, type HtmlBlockContext } from './_shared.html';

export function renderTocHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? ctx.page.width - 48);
  const title = resolveBindable(p.title ?? 'Contents', ctx);
  const titleSize = Number(p.titleSize ?? 22);
  const size = Number(p.size ?? 11);
  const lh = Number(p.lineHeight ?? 18);
  const titleColor = resolveBindableColor(p.titleColor ?? 'token:primary', ctx, '#BF9B50');
  const color = resolveBindableColor(p.color ?? 'token:text', ctx, '#1A1A1A');
  const idxColor = resolveBindableColor(p.indexColor ?? 'token:muted', ctx, '#888');
  const pages = ctx.pages ?? [];

  /**
   * A contents list names sections, not sheets.
   *
   * This mapped one row per rendered page, and a section that runs long is many
   * pages: the Investment Compass sets aside 40 for the report body, so a real
   * document listed "The report", "The report (2)" … "The report (40)" and its
   * contents filled two whole pages. A page that declares `tocContinues` folds
   * into the entry above it — it is still rendered and still numbered, it just
   * does not open a second line about the same section. The numbering stays the
   * document's own page number, so the entry points at where the section
   * starts.
   *
   * The flag is set by the master (see `PageSchema.tocContinues`); nothing here
   * infers a continuation from a page's name.
   */
  const entries = pages
    .map((pg, i) => ({ pg, i }))
    .filter(({ pg, i }) => i === 0 || pg.tocContinues !== true);

  const rows = entries.map(({ pg, i }, n) =>
    `<div style="display:flex;justify-content:space-between;line-height:${lh}pt;font-size:${size}pt;color:${color};">
      <span>${n + 1}. ${esc(pg.name || `Page ${i + 1}`)}</span>
      <span style="color:${idxColor};">${i + 1}</span>
    </div>`,
  ).join('');

  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;">
    ${title ? `<div style="color:${titleColor};font-weight:700;font-size:${titleSize}pt;margin-bottom:${titleSize * 0.6}pt;font-family:var(--font-heading, Helvetica);">${esc(title)}</div>` : ''}
    ${rows}
  </div>`;
}
