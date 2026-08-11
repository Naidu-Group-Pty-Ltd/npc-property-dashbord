// Market Q&A answer formatting — pure, shared by the edge function and the
// client renderer (via src/lib/marketQaAnswerFormat.pure.ts, following the
// brandDesign/reportDesign precedent).
//
// Why this exists: side-by-side trials of the same question produced answers
// whose *structure* differed run to run — a four-entry timeline in one browser,
// one entry in the other — and whose markdown carried model artefacts: `##`
// headings glued mid-paragraph and citation clusters like `[[8], [11]]` that
// the `[[id]]` renderer cannot resolve, so they printed as raw text. Prose may
// legitimately vary between runs; structure and formatting may not. Everything
// here is deterministic string/array work so both runtimes repair the same
// defects identically, and persisted or shared answers from before the fix are
// repaired on render too.
//
// No Deno APIs, no imports — safe to bundle into the browser.

/** The section vocabulary the narrative prompt prescribes. Kept in one place so
 *  the prompt, the repair and the tests cannot drift apart. */
export const NARRATIVE_SECTIONS = [
  'What happened',
  'Why it matters',
  'The numbers',
  'What it means for buyers and investors',
  'Risks and caveats',
  'What to watch',
] as const;

const SECTION_ALTERNATION = NARRATIVE_SECTIONS
  // Longest first so "What it means for buyers and investors" wins over a
  // hypothetical shorter prefix.
  .slice()
  .sort((a, b) => b.length - a.length)
  .map(section => section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

/** lowercase → prescribed casing, so "## risks and caveats" repairs to the canonical title. */
const CANONICAL_SECTION = new Map(NARRATIVE_SECTIONS.map(section => [section.toLowerCase(), section]));

/**
 * Repair heading placement in model-authored markdown.
 *
 * Models under streaming pressure emit `…homeowner equity. ## Risks and
 * caveats The primary risk is…` — the heading glued to the paragraph on BOTH
 * sides. Inserting a newline before `##` alone is not enough: markdown would
 * then swallow the whole remainder of the line as heading text. Because the
 * prompt prescribes an exact section vocabulary, every occurrence of a known
 * section title after `##`/`###` is rewritten onto its own line with the
 * following prose pushed to a fresh paragraph — wherever it appeared.
 */
export function normaliseAnswerMarkdown(text: string): string {
  if (!text) return text;
  let out = text.replace(
    new RegExp(`\\s*#{2,3}\\s*(${SECTION_ALTERNATION})\\b[:.]?\\s*`, 'gi'),
    (_match, title: string) => `\n\n## ${CANONICAL_SECTION.get(title.toLowerCase()) ?? title}\n\n`,
  );
  // A heading the vocabulary does not cover still must not sit mid-line —
  // break the line before it and accept markdown's rest-of-line heading.
  out = out.replace(/([^\n])\s+(#{2,3}\s)/g, '$1\n\n$2');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Split citation clusters into the single-marker form the renderer resolves.
 *
 * Models write `[[8], [11]]`, `[[8, 11]]` or `[[8],[11]]`; the renderer's
 * `[[token]]` pattern cannot match those, so they printed literally. The outer
 * `[[ … ]]` group is exploded into one marker per token — `[[8]] [[11]]` —
 * before index→id mapping runs. Tokens are ids or 1-based indices: letters,
 * digits and hyphens only; anything else inside a cluster is dropped.
 */
export function explodeCitationClusters(text: string): string {
  if (!text) return text;
  return text.replace(/\[\[((?:[^[\]]|\][,\s]*\[)*)\]\]/g, (whole, inner: string) => {
    const tokens = String(inner)
      .split(/[^A-Za-z0-9-]+/)
      .map(token => token.trim())
      .filter(Boolean);
    if (!tokens.length) return whole;
    return tokens.map(token => `[[${token}]]`).join(' ');
  });
}

export interface TimelineEntry {
  date: string;
  event: string;
  source_id?: string;
}

export interface TimelineSourceDoc {
  id: string;
  title: string;
  source_name?: string | null;
  source_published_at?: string | null;
}

const timelineKey = (entry: TimelineEntry): string =>
  `${entry.date.slice(0, 10)}|${entry.event.trim().toLowerCase()}`;

const parseWhen = (value: string): number => {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER; // undated last
};

/** Chronological order, oldest first, duplicates (same date + same wording) removed. */
export function dedupeSortTimeline(entries: TimelineEntry[], max = 8): TimelineEntry[] {
  const seen = new Set<string>();
  const kept: TimelineEntry[] = [];
  for (const entry of entries) {
    if (!entry?.date || !entry?.event) continue;
    const key = timelineKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(entry);
  }
  return kept.sort((a, b) => parseWhen(a.date) - parseWhen(b.date)).slice(0, max);
}

/**
 * Guarantee the timeline's floor deterministically.
 *
 * The model's timeline is kept — it writes the better event descriptions — but
 * whether it lists one event or four was pure extraction luck, which is why
 * two browsers asking the same question saw different sequences. Every used
 * source carries a publication date, so each used source not already
 * represented contributes its dated headline. The floor becomes "one entry per
 * used dated source", identical on every run over the same evidence.
 */
export function supplementTimeline(
  modelEntries: TimelineEntry[],
  docs: TimelineSourceDoc[],
  usedIds: string[],
  max = 8,
): TimelineEntry[] {
  const used = new Set(usedIds);
  const covered = new Set(modelEntries.map(entry => entry.source_id).filter(Boolean) as string[]);
  const coveredDates = new Set(modelEntries.map(entry => entry.date.slice(0, 10)));
  const supplements: TimelineEntry[] = [];
  for (const doc of docs) {
    if (!used.has(doc.id) || covered.has(doc.id)) continue;
    const published = doc.source_published_at ?? '';
    const date = published.slice(0, 10);
    if (!date) continue;
    // A model entry already narrating this date is close enough — do not add a
    // second entry that says the same thing in headline form.
    if (coveredDates.has(date)) continue;
    supplements.push({
      date,
      event: doc.source_name ? `${doc.title} (${doc.source_name})` : doc.title,
      source_id: doc.id,
    });
    coveredDates.add(date);
  }
  return dedupeSortTimeline([...modelEntries, ...supplements], max);
}

/** Chip label for a citation URL — "abc.net.au", never a second identical
 *  "Open original source". Returns null for an unparseable URL. */
export function citationHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}
