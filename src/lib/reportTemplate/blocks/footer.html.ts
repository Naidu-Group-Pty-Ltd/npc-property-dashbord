import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { esc, type HtmlBlockContext } from './_shared.html';

export function renderFooterHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const h = Number(p.height ?? 28);
  const bg = resolveBindableColor(p.bg ?? 'token:bg', ctx, '#0D0D0D');
  const color = resolveBindableColor(p.color ?? 'token:muted', ctx, '#999999');
  const text = resolveBindable(p.text, ctx);
  const align = (p.align as string) || 'center';
  // A footer that sits on the paper reads as part of the page; one that fills
  // with `token:bg` reads as a slab. Templates that want the rule opt in.
  const rule = p.ruleColor
    ? `border-top:0.5pt solid ${resolveBindableColor(p.ruleColor, ctx, '#DCDCDC')};`
    : '';
  return `<div style="position:absolute;left:0;right:0;bottom:0;height:${h}pt;background:${bg};color:${color};${rule}display:flex;align-items:center;justify-content:${align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'};padding:0 24pt;font-size:8pt;">
    ${text ? esc(text) : ''}
  </div>`;
}
