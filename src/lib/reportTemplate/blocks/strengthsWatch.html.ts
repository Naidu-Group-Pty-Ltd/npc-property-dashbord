import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { esc, type HtmlBlockContext } from './_shared.html';

export function renderStrengthsWatchHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? ctx.page.width - 48);
  const strengths = Array.isArray(p.strengths) ? (p.strengths as string[]) : [];
  const watch = Array.isArray(p.watch) ? (p.watch as string[]) : [];
  const strengthsTitle = resolveBindable(p.strengthsTitle ?? 'Strengths', ctx);
  const watchTitle = resolveBindable(p.watchTitle ?? 'Watch Points', ctx);
  // Strengths and watch points are semantic, so they keep a semantic colour —
  // but the template's own, not a fixed screen green and orange that fought
  // every palette they landed in. Fallbacks are the previous literals.
  const positive = resolveBindableColor(p.positiveColor ?? '#16A34A', ctx, '#16A34A');
  const caution = resolveBindableColor(p.cautionColor ?? '#D97706', ctx, '#D97706');
  const onFill = resolveBindableColor(p.onFillColor ?? '#FFFFFF', ctx, '#FFFFFF');
  const textColor = resolveBindableColor(p.color ?? '#1A1A1A', ctx, '#1A1A1A');
  const radius = Number.isFinite(Number(p.radius)) ? Number(p.radius) : 0;

  const column = (title: string, items: string[], color: string, glyph: string) => {
    const li = items.map((it) => {
      const text = resolveBindable(it, ctx);
      return `<div style="display:flex;gap:8pt;align-items:flex-start;margin-bottom:8pt;">
        <span style="background:${color};color:${onFill};border-radius:50%;width:14pt;height:14pt;display:inline-flex;align-items:center;justify-content:center;font-size:8pt;font-weight:700;flex-shrink:0;">${esc(glyph)}</span>
        <span style="color:${textColor};font-size:9.5pt;line-height:1.35;">${esc(text)}</span>
      </div>`;
    }).join('');
    return `<div>
      <div style="background:${color};color:${onFill};font-weight:700;font-size:10pt;padding:6pt 12pt;text-transform:uppercase;letter-spacing:0.08em;border-radius:${radius}pt;margin-bottom:10pt;">${esc(title)}</div>
      ${li}
    </div>`;
  };

  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;display:grid;grid-template-columns:1fr 1fr;gap:14pt;">
    ${column(String(strengthsTitle), strengths, positive, '+')}
    ${column(String(watchTitle), watch, caution, '!')}
  </div>`;
}
