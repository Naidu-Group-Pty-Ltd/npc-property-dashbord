/**
 * The Word document's design system.
 *
 * The PDF path composes through `reportDesign/` and inherits a whole
 * stylesheet. A `.docx` has no stylesheet to inherit — Word resolves fonts,
 * sizes and colours per run — so the values that stylesheet would have given
 * us are written down once here and consumed by `docx.ts`. There is not one
 * colour literal in the builder; every colour is a role resolved from the
 * tenant's brand.
 *
 * Two constraints shaped these choices:
 *
 *  - **The reader may not have our fonts.** A `.docx` referencing a webfont
 *    silently falls back to whatever Word picks, which is how a premium
 *    document ends up set in Times New Roman on someone else's laptop. The
 *    pairing below is metric-safe on Windows and macOS: Georgia for display,
 *    Calibri for body, Consolas for the micro labels.
 *  - **The reader may edit it.** This is the format handed to somebody who
 *    will re-upload it to DocuSign or PandaDoc, so structure has to survive
 *    editing: real tables rather than tab-aligned text, real page breaks
 *    rather than empty paragraphs, and rows that cannot split across pages.
 */

/** Word sizes are half-points; these are points. */
export const DOCX_TYPE = {
  coverTitle: 34,
  coverSubtitle: 12,
  coverCompany: 12,
  coverDescriptor: 10.5,
  sectionHeading: 14,
  sectionBadge: 12,
  clauseHeading: 11.5,
  body: 10,
  caption: 9,
  micro: 7.5,
} as const;

/** Twips. 1440 = 1 inch, 567 = 1cm. */
export const DOCX_PAGE = {
  /** A4 portrait. */
  widthTwip: 11906,
  heightTwip: 16838,
  marginX: 1134,
  marginTop: 1418,
  marginBottom: 1134,
  headerTwip: 680,
  footerTwip: 567,
} as const;

export const DOCX_CONTENT_WIDTH = DOCX_PAGE.widthTwip - DOCX_PAGE.marginX * 2;

export const DOCX_FONTS = {
  display: 'Georgia',
  body: 'Calibri',
  mono: 'Consolas',
} as const;

export interface DocxPalette {
  /** The tenant's brand colour, as 6-digit hex without `#`. */
  accent: string;
  /** Brand colour darkened for text on paper — keeps small type legible. */
  accentInk: string;
  /** A pale wash of the brand colour, for header bands and label cells. */
  accentWash: string;
  /**
   * The cover canvas — the brand deepened until white display type carries
   * on it. A vivid brand at full strength vibrates behind 30pt serif; pulled
   * toward ink it reads as a material instead of a highlight.
   */
  accentDeep: string;
  /** Muted companion text ON the deep canvas (eyebrows, descriptors). */
  onDeepMuted: string;
  /** Body text. Near-black rather than black: black prints heavier than it reads. */
  ink: string;
  /** Secondary text — labels, captions, the things that support a value. */
  mutedInk: string;
  /** Hairlines. */
  rule: string;
  /** Neutral panel fill. */
  panel: string;
  /** Text sitting on the accent itself. */
  onAccent: string;
}

const HEX = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** `#1F4D8F`, `#1f4`, `210 65% 34%` (the HSL triplet form) → `1F4D8F`. */
export function toDocxHex(value: unknown, fallback = '1F3352'): string {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;

  const hex = HEX.exec(raw);
  if (hex) {
    const digits = hex[1];
    const full = digits.length === 3
      ? digits.split('').map((c) => c + c).join('')
      : digits;
    return full.toUpperCase();
  }

  // `43 74% 49%` — the bare HSL triplet `whitelabel_settings` also accepts.
  const hsl = /^(\d{1,3})\s+(\d{1,3})%\s+(\d{1,3})%$/.exec(raw);
  if (hsl) {
    const [h, s, l] = [Number(hsl[1]) / 360, Number(hsl[2]) / 100, Number(hsl[3]) / 100];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channel = (t: number) => {
      let x = t;
      if (x < 0) x += 1;
      if (x > 1) x -= 1;
      if (x < 1 / 6) return p + (q - p) * 6 * x;
      if (x < 1 / 2) return q;
      if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
      return p;
    };
    const rgb = s === 0
      ? [l, l, l]
      : [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
    return rgb
      .map((c) => Math.round(c * 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }

  return fallback;
}

function channels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function fromChannels(rgb: number[]): string {
  return rgb
    .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** Mix toward white. `amount` 0 → unchanged, 1 → white. */
function tint(hex: string, amount: number): string {
  const rgb = channels(hex);
  return fromChannels(rgb.map((c) => c + (255 - c) * amount));
}

/** Mix toward black. */
function shade(hex: string, amount: number): string {
  const rgb = channels(hex);
  return fromChannels(rgb.map((c) => c * (1 - amount)));
}

/** WCAG relative luminance, for the two decisions below that depend on it. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Resolve the document palette from one brand colour.
 *
 * `accentInk` is darkened when the brand is light, because a pale gold set at
 * 7.5pt on white is decoration rather than text — the same floor the print
 * palette enforces. `onAccent` flips to ink on a light brand for the same
 * reason, so a badge on a yellow band is still readable.
 */
export function resolveDocxPalette(brandColour: unknown): DocxPalette {
  const accent = toDocxHex(brandColour);
  const brandLuminance = luminance(accent);
  // The canvas must end up dark enough for white type whatever the brand is:
  // a light brand is pulled down hard, a mid brand moderately, a dark brand
  // barely at all.
  const accentDeep = brandLuminance > 0.5
    ? shade(accent, 0.62)
    : brandLuminance > 0.15
      ? shade(accent, 0.38)
      : shade(accent, 0.12);
  return {
    accent,
    accentInk: brandLuminance > 0.35 ? shade(accent, 0.45) : accent,
    accentWash: tint(accent, 0.92),
    accentDeep,
    onDeepMuted: tint(accentDeep, 0.62),
    ink: '1A1A1A',
    mutedInk: '6B6B6B',
    rule: 'D9D6D0',
    panel: 'F6F5F2',
    onAccent: brandLuminance > 0.6 ? '1A1A1A' : 'FFFFFF',
  };
}
