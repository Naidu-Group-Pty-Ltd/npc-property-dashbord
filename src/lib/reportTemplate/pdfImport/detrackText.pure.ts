/**
 * Recover real words from tracked (letter-spaced) source text.
 *
 * THE ARTIFACT
 * ------------
 * Documents track out their headings — `NAIDU` set as `N A I D U`, standard
 * luxury-brand styling. The PDF positions each letter individually, so the
 * extractor emits one glyph per letter and joins them with spaces: the word
 * becomes `N A I D U`, the real word gaps become multiple spaces, and sometimes
 * a word gap is lost outright. A production import stored exactly this:
 *
 *     "N A I D U   P R O P E R T Y C O N S U L T I N G   S E R V I C E S"
 *
 * Note PROPERTY–CONSULTING: the word boundary is GONE. Rendered as-is this
 * reads as gibberish, edits as gibberish, and searches as gibberish.
 *
 * THE RECONSTRUCTION
 * ------------------
 * Tracked text is words plus a letter-spacing STYLE, so that is what we emit:
 * `NAIDU PROPERTY CONSULTING SERVICES` + `letterSpacing: N pt`. Two evidence
 * sources, in order of authority:
 *
 *   1. Span char-counts from the sidecar's `source_measure`. PDFs draw tracked
 *      text as one span per word, so the span partition IS the word structure —
 *      it recovers boundaries the string has lost (PROPERTY|CONSULTING above).
 *   2. The string's own multi-space runs, which survive as word gaps when the
 *      extractor preserved them. Cannot recover a lost boundary, but never
 *      invents one either.
 *
 * When neither yields a confident answer the text is LEFT ALONE. A wrongly
 * merged heading would be worse than the artifact — the artifact is at least
 * visibly broken, where a wrong merge looks intentional.
 *
 * Pure and deterministic.
 */

/** Minimum single-character tokens before a string is considered tracked. */
export const MIN_TRACKED_TOKENS = 4;

/**
 * Minimum share of tokens that must be single characters. Tracked headings are
 * ~100%; ordinary text with an initial ("J R R Tolkien") stays untouched
 * because the long tokens pull the share down.
 */
export const MIN_SINGLE_CHAR_SHARE = 0.8;

export interface DetrackResult {
  text: string;
  changed: boolean;
  /** Which evidence decided the word boundaries. */
  method: 'span-partition' | 'multi-space' | 'none';
}

/** Is this the letter-spread pattern at all? */
export function looksTracked(raw: string): boolean {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < MIN_TRACKED_TOKENS) return false;
  const single = tokens.filter((t) => [...t].length === 1).length;
  return single / tokens.length >= MIN_SINGLE_CHAR_SHARE;
}

/**
 * Collapse using the string's own spacing: single spaces between letters are
 * tracking, runs of 2+ spaces are word gaps.
 */
function collapseByMultiSpace(raw: string): string {
  return raw
    .trim()
    .split(/\s{2,}/)
    .map((segment) => {
      const tokens = segment.split(' ').filter(Boolean);
      const allSingle = tokens.length > 1 && tokens.every((t) => [...t].length === 1);
      return allSingle ? tokens.join('') : segment;
    })
    .join(' ');
}

/**
 * Partition the letter stream by span char-counts, when they account for it
 * exactly. An inexact partition proves the spans describe something other than
 * this string (a different extractor's view, a multi-line item, spans that
 * include their own spaces) — in which case they must not be trusted for it.
 */
function collapseBySpans(raw: string, spanCharCounts: readonly number[]): string | null {
  const letters = [...raw.replace(/\s+/g, '')];
  const counts = spanCharCounts.filter((n) => Number.isFinite(n) && n >= 1).map((n) => Math.round(n));
  if (counts.length < 2 || counts.length !== spanCharCounts.length) return null;
  const total = counts.reduce((a, b) => a + b, 0);
  if (total !== letters.length) return null;

  const words: string[] = [];
  let at = 0;
  for (const count of counts) {
    words.push(letters.slice(at, at + count).join(''));
    at += count;
  }
  return words.join(' ');
}

/**
 * De-track one string.
 *
 * Span evidence wins when it partitions the letters exactly — it is the only
 * source that can recover a LOST boundary. Otherwise the string's own multi-
 * space gaps are used. A string that does not look tracked is returned as-is.
 */
export function detrackText(
  raw: string,
  spanCharCounts?: readonly number[],
): DetrackResult {
  if (typeof raw !== 'string' || !looksTracked(raw)) {
    return { text: raw, changed: false, method: 'none' };
  }

  if (spanCharCounts && spanCharCounts.length >= 2) {
    const bySpans = collapseBySpans(raw, spanCharCounts);
    if (bySpans !== null && bySpans !== raw) {
      return { text: bySpans, changed: true, method: 'span-partition' };
    }
  }

  const byGaps = collapseByMultiSpace(raw);
  if (byGaps !== raw.trim()) {
    return { text: byGaps, changed: true, method: 'multi-space' };
  }
  return { text: raw, changed: false, method: 'none' };
}

// ── Letter-spacing recovery ──────────────────────────────────────────────────

/** Measures the advance width of `text` in `family` at `sizePt`, in points. */
export type WidthMeasurer = (text: string, family: string, sizePt: number) => number | null;

/**
 * Widest credible tracking, as a multiple of the font size. Beyond this the
 * derivation is more likely wrong than the design is extreme.
 */
export const MAX_TRACKING_EM = 1.5;

/**
 * Average glyph advance as a fraction of font size, used ONLY when nothing can
 * be measured. Roman faces average 0.45–0.55em per glyph; 0.5 splits the
 * difference. An estimate this crude is acceptable for a fallback because the
 * result is clamped and only ever ADDS spacing the design visibly had.
 */
export const FALLBACK_GLYPH_ADVANCE_EM = 0.5;

/**
 * Derive the letter-spacing that makes the de-tracked text occupy the width the
 * source measured for the tracked original.
 *
 * spacing = (measuredWidth − naturalWidth) / (glyphCount − 1)
 *
 * `naturalWidth` comes from the injected measurer (canvas, with the fallback
 * family — the embedded face is not loaded in the measuring document, so the
 * fallback's metrics are the honest approximation available). Without a
 * measurer the glyph-advance estimate above stands in. Returns null rather
 * than a negative or absurd value: tracked text only ever gains spacing.
 */
export function deriveTrackingPt(
  collapsedText: string,
  measuredWidthPt: number,
  fontSizePt: number,
  fontFamily: string,
  measure?: WidthMeasurer | null,
): number | null {
  const glyphs = [...collapsedText];
  if (glyphs.length < 2) return null;
  if (!Number.isFinite(measuredWidthPt) || measuredWidthPt <= 0) return null;
  if (!Number.isFinite(fontSizePt) || fontSizePt <= 0) return null;

  let naturalWidth: number | null = null;
  if (measure) {
    try {
      naturalWidth = measure(collapsedText, fontFamily, fontSizePt);
    } catch {
      naturalWidth = null;
    }
  }
  if (naturalWidth == null || !Number.isFinite(naturalWidth) || naturalWidth <= 0) {
    naturalWidth = glyphs.length * fontSizePt * FALLBACK_GLYPH_ADVANCE_EM;
  }

  const spacing = (measuredWidthPt - naturalWidth) / (glyphs.length - 1);
  if (!Number.isFinite(spacing) || spacing <= 0) return null;
  const clamped = Math.min(spacing, fontSizePt * MAX_TRACKING_EM);
  return Math.round(clamped * 100) / 100;
}
