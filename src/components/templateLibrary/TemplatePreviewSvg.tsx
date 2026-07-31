/**
 * Schematic page preview rendered straight from the template schema.
 *
 * Deliberately not a PDF and not a stored image. `render-template-pdf` returns
 * 24-hour signed URLs from a private bucket, so a persisted thumbnail URL would
 * break the following day; and rendering a real PDF per card would put a
 * multi-second, metered round-trip on the browse path. An SVG drawn from the
 * schema is instant, always matches the current design, and costs nothing.
 *
 * The approach follows `PageTemplatesMarketplaceDialog`'s existing preview,
 * which does the same thing for starter page presets.
 */
import { useMemo } from 'react';

interface Props {
  /** `preview_schema` from a list row, or a full schema from a detail fetch. */
  schema: unknown;
  /** Which page to draw. List rows only carry page 1. */
  pageIndex?: number;
  className?: string;
  /** Announced to assistive technology in place of the drawing. */
  label: string;
}

interface Rect { x: number; y: number; w: number; h: number; kind: string }

const TEXTUAL = new Set([
  'text', 'text-block', 'disclaimer', 'pull-quote', 'faq', 'definition-list',
  'footer', 'page-number', 'toc', 'auto-toc', 'signature',
]);
const MEDIA = new Set(['image', 'gallery', 'map', 'hero', 'cover', 'image-text', 'before-after', 'qr']);
const CHARTY = /^(chart|heatmap|sparkline|kpi|scorecard|progress|metric)/;

/** Blocks may be flow-positioned or absolutely placed; both carry width/height. */
function toRect(block: any, index: number, pageW: number, pageH: number): Rect | null {
  const props = block?.props ?? {};
  const kind = String(block?.type ?? '');
  if (!kind) return null;

  const x = Number(props.x ?? 24);
  const y = Number(props.y ?? 40 + index * 64);
  const w = Number(props.width ?? pageW - 48);
  const h = Number(props.height ?? (TEXTUAL.has(kind) ? 42 : 96));

  if (![x, y, w, h].every(Number.isFinite)) return null;
  // Clamp rather than drop: a block hanging off the page should still hint at
  // its presence, and the schematic is not a fidelity tool.
  return {
    x: Math.max(0, Math.min(x, pageW)),
    y: Math.max(0, Math.min(y, pageH)),
    w: Math.max(4, Math.min(w, pageW)),
    h: Math.max(3, Math.min(h, pageH)),
    kind,
  };
}

export function TemplatePreviewSvg({ schema, pageIndex = 0, className, label }: Props) {
  const { width, height, rects } = useMemo(() => {
    const pages = Array.isArray((schema as any)?.pages) ? (schema as any).pages : [];
    const page = pages[pageIndex] ?? pages[0];
    const w = Number(page?.size?.width ?? 595);
    const h = Number(page?.size?.height ?? 842);
    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    return {
      width: w,
      height: h,
      rects: blocks
        .map((b: any, i: number) => toRect(b, i, w, h))
        .filter((r: Rect | null): r is Rect => r !== null)
        .slice(0, 60),
    };
  }, [schema, pageIndex]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label={label}
    >
      <rect x={0} y={0} width={width} height={height} className="fill-card" />
      {rects.map((r, i) => {
        // Semantic tokens only — the schematic must re-skin with the dashboard
        // theme rather than baking in a palette.
        const tone = MEDIA.has(r.kind)
          ? 'fill-muted'
          : CHARTY.test(r.kind)
            ? 'fill-primary/25'
            : TEXTUAL.has(r.kind)
              ? 'fill-foreground/15'
              : 'fill-foreground/10';
        return (
          <rect
            key={i}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            rx={4}
            className={tone}
          />
        );
      })}
      {rects.length === 0 && (
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize={28}
        >
          No preview
        </text>
      )}
    </svg>
  );
}
