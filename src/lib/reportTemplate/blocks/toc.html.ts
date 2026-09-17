import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { esc, type HtmlBlockContext } from './_shared.html';
import { fitTocEntries, splitTocColumns, tocOmittedLine } from './tocFit';

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

  /**
   * The list fits the page it is printed on — see `tocFit.ts`. A 41-section
   * document used to run off the foot of this page and be drawn, invisibly,
   * under the next page's blocks. The foot reserve is the master's footer zone;
   * a master that draws a taller foot declares `bottomReserve`.
   */
  const bottomReserve = Number(p.bottomReserve ?? 64);
  const titlePt = title ? titleSize * 1.6 : 0;
  const fit = fitTocEntries({
    entries: entries.length, availablePt: ctx.page.height - y - bottomReserve, titlePt,
    lineHeightPt: lh, sizePt: size,
  });
  const lines = entries.slice(0, fit.shown).map(({ pg, i }, n) => ({
    label: `${n + 1}. ${pg.name || `Page ${i + 1}`}`, page: String(i + 1), target: i,
  }));
  if (fit.omitted) lines.push({ label: tocOmittedLine(fit.omitted), page: '', target: null });

  /**
   * A contents entry goes to its section.
   *
   * The list named the page and could not reach it: measured on a 36-page
   * Templates render, the file carried 48 bookmarks and **zero** link
   * annotations, so the only way through the document was the reader's own
   * page field. `autoToc` has always linked; this list, which is the one the
   * catalogue's masters draw, never did.
   *
   * The destination is exact rather than inferred. `renderPage` is handed
   * `visiblePages` and stamps `id="tpl-page-<index into that array>"`, and
   * `ctx.pages` is that same array — so `i` here and the anchor there are one
   * index. An entry folded into the one above it (`tocContinues`) keeps
   * pointing at where its section STARTS, which is the page number it already
   * prints. The omitted-count line names no page and is therefore not a link.
   */
  const row = (line: { label: string; page: string; target: number | null }) => {
    // The ANCHOR CARRIES TEXT AND NOTHING ELSE. Measured on WeasyPrint 69.0:
    // `<a>` wrapping plain text tags as a conforming `/Link`, and the moment
    // it contains an element — one `<span>`, the whole flex row — PDF/UA
    // clause 7.18.5 test 1 fails, 32 checks on the 36-page render. So the row
    // stays a flex box, the label alone is the link, and the folio beside it
    // is not. `text-decoration`/`color` are restated because the engine's own
    // stylesheet gives an anchor blue underlined text, which would repaint
    // every contents page in the catalogue.
    const label = `min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
    const inner = (line.target === null
      ? `<span style="${label}">${esc(line.label)}</span>`
      : `<a href="#tpl-page-${line.target}" style="${label}text-decoration:none;color:${color};">${esc(line.label)}</a>`)
      + `<span style="color:${idxColor};flex:none;">${esc(line.page)}</span>`;
    return `<div style="display:flex;justify-content:space-between;gap:8pt;`
      + `line-height:${fit.lineHeightPt.toFixed(2)}pt;font-size:${fit.sizePt.toFixed(2)}pt;color:${color};">${inner}</div>`;
  };
  const columns = splitTocColumns(lines, fit.columns).map((col) => col.map(row).join(''));
  const body = fit.columns === 1
    ? columns[0]
    : `<div style="display:flex;gap:18pt;align-items:flex-start;">${columns.map((c) => `<div style="flex:1 1 0;min-width:0;">${c}</div>`).join('')}</div>`;

  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;">
    ${title ? `<div style="color:${titleColor};font-weight:700;font-size:${titleSize}pt;margin-bottom:${titleSize * 0.6}pt;font-family:var(--font-heading, Helvetica);">${esc(title)}</div>` : ''}
    ${body}
  </div>`;
}
