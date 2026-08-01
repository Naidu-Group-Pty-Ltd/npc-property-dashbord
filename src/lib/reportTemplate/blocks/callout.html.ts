import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { esc, type HtmlBlockContext } from './_shared.html';

const VARIANT: Record<string, { bg: string; accent: string; fg: string; glyph: string }> = {
  info:    { bg: '#EEF4FB', accent: '#2563EB', fg: '#1E3A8A', glyph: 'i' },
  success: { bg: '#ECFDF3', accent: '#16A34A', fg: '#14532D', glyph: '✓' },
  warning: { bg: '#FFF7ED', accent: '#D97706', fg: '#7C2D12', glyph: '!' },
  danger:  { bg: '#FEF2F2', accent: '#DC2626', fg: '#7F1D1D', glyph: '!' },
  quote:   { bg: '#F4F0E6', accent: '#BF9B50', fg: '#1A1A1A', glyph: '“' },
};

export function renderCalloutHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const v = VARIANT[String(p.variant ?? 'info')] ?? VARIANT.info;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 24);
  const w = Number(p.width ?? ctx.page.width - 48);
  const bg = resolveBindableColor(p.bg ?? v.bg, ctx, v.bg);
  const accent = resolveBindableColor(p.accent ?? v.accent, ctx, v.accent);
  const fg = resolveBindableColor(p.color ?? v.fg, ctx, v.fg);
  const title = resolveBindable(p.title, ctx);
  const body = resolveBindable(p.body, ctx);
  const radius = Number.isFinite(Number(p.radius)) ? Number(p.radius) : 6;

  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;background:${bg};border-radius:${radius}pt;border-left:4pt solid ${accent};padding:14pt 16pt 14pt 44pt;color:${fg};">
    <div style="position:absolute;left:14pt;top:14pt;width:16pt;height:16pt;background:${accent};color:#fff;border-radius:50%;font-weight:700;font-size:11pt;display:flex;align-items:center;justify-content:center;">${esc(v.glyph)}</div>
    ${title ? `<div style="font-weight:700;font-size:11pt;margin-bottom:4pt;">${esc(title)}</div>` : ''}
    ${body ? `<div style="font-size:9.5pt;line-height:1.4;white-space:pre-wrap;">${esc(body)}</div>` : ''}
  </div>`;
}
