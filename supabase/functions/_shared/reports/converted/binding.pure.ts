/**
 * Tying a converted template to an existing report format.
 *
 * ## What binding is for
 *
 * A converted template on its own is a nicely typeset copy of somebody's old
 * document. It becomes useful when it is attached to a **report format** — one
 * of the archetypes in `reportDesign/structure.pure.ts` — because then the
 * format's own structure sections drive the document, and the real report data
 * flows into it at render time instead of the words that happened to be in the
 * PDF somebody uploaded.
 *
 * So binding answers one question per archetype chapter: *which section of the
 * uploaded template plays this part?*
 *
 * ## Suggested, then confirmed — never silently guessed
 *
 * `proposeBinding` scores each extracted section against each archetype
 * chapter and returns its best guess **with the score attached**. The UI shows
 * those and a person confirms or overrides them. Nothing here decides anything
 * on its own, and that is deliberate: a wrong automatic binding produces a
 * document where the "Risks" chapter is filled with the fee schedule, which
 * looks entirely correct and is completely wrong. A visible low score is
 * recoverable; a silent mismatch is not.
 *
 * The scorer is intentionally simple — token overlap, order proximity, and a
 * nudge for tabular sections landing on tabular chapters. A cleverer matcher
 * would be more often right and much harder to argue with when it is wrong,
 * and the person confirming is looking at both lists anyway.
 */
import { REPORT_ARCHETYPES, type ReportArchetypeId } from '../../reportDesign/structure.pure.ts';
import type { ExtractedSection, ExtractedStructure } from './structure.pure.ts';

/**
 * The chapters a report format contributes, by archetype.
 *
 * The archetypes themselves declare a document *name*, slots and a page band —
 * they do not enumerate chapters, because for the migrated formats the chapters
 * come from the payload. A converter has no payload yet, so the format's
 * expected sections have to be written down somewhere, and this is that place.
 *
 * ## These are the renderer's own titles, and a spec proves it
 *
 * Every string below appears verbatim in
 * `_shared/reports/borrowingCapacity/sections.pure.ts › snapshotSections`, and
 * `converterChapters.spec.ts` imports that function and asserts the two agree.
 *
 * The first version of this list did not. It said `Position Summary`, `Income`,
 * `Commitments`, `Serviceability`, `Capacity & Scenarios`, `Assumptions`,
 * `Next Steps` — seven noun phrases taken from the archetype's *description*,
 * not one of which the renderer prints. A comment right here claimed they were
 * "taken from each format's shipped document rather than invented"; they were
 * invented, and the cost was measurable: converting a real Borrowing Capacity
 * Snapshot bound 3 of 7 chapters and sent 3 sections to the appendix, because
 * the document's actual chapters are editorial sentences and the list was
 * functional labels. A binding list that does not match the renderer is worse
 * than no list, because it fails while looking like it works.
 *
 * The last three are conditional in the real document — the renderer emits them
 * only when the payload carries an explanation, an audit or scenarios. They are
 * offered here regardless and simply go unfilled, which is the state the
 * document already handles.
 */
export const FORMAT_CHAPTERS: Partial<Record<ReportArchetypeId, readonly string[]>> = {
  'borrowing-capacity': [
    'Capacity at a glance',
    'Income and commitments',
    'How the capacity is built',
    'How this was calculated',
    'Audit trail',
    'Scenario comparison',
  ],
};

/**
 * Chapters whose content is characteristically a table rather than prose.
 *
 * Keyed off the real titles. The previous version keyed off the invented ones,
 * so it matched nothing and the shape signal in `scoreMatch` was dead weight.
 */
const TABULAR_CHAPTERS = new Set([
  'Income and commitments',
  'How the capacity is built',
  'Audit trail',
  'Scenario comparison',
]);

/** One archetype chapter and whatever the template offered for it. */
export interface ChapterBinding {
  /** The archetype chapter this is about. */
  chapter: string;
  /** Index into `ExtractedStructure.sections`, or null for "nothing offered". */
  sectionIndex: number | null;
  /** 0–100. Zero means the proposal is a guess of last resort. */
  confidence: number;
  /** Why it was proposed, in words, for the review screen. */
  reason: string;
  /** True once a person has accepted or overridden it. */
  confirmed: boolean;
}

export interface BindingPlan {
  format: ReportArchetypeId;
  bindings: readonly ChapterBinding[];
  /** Sections the template had that no chapter wanted. Printed as an appendix. */
  unbound: readonly number[];
  /** Chapters with nothing bound. The format still prints them from its data. */
  unfilled: readonly string[];
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'your',
  'our', 'report', 'section', 'analysis', 'overview', 'summary', 'details',
]);

const tokens = (v: string): string[] =>
  v.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));

/**
 * How well one section answers one chapter, 0–100.
 *
 * Three signals, and the weights say what is trusted. Word overlap dominates
 * because a section actually called "Serviceability" is almost certainly the
 * serviceability section. Order is a weak tie-breaker — templates tend to run
 * in the same sequence as the formats they inspired — and shape is weaker
 * still, worth having only because it separates two otherwise identical
 * candidates when one is a table and the chapter wants one.
 */
export function scoreMatch(
  chapter: string,
  chapterIndex: number,
  chapterCount: number,
  section: ExtractedSection,
  sectionCount: number,
): number {
  const a = tokens(chapter);
  const b = tokens(section.title);
  if (!a.length || !b.length) return 0;

  const shared = a.filter((t) => b.includes(t)).length;
  // No shared word, no match.
  //
  // Order and shape are tie-breakers between candidates that already have
  // something in common; on their own they are noise. Letting them score
  // produced exactly the failure this module's header warns about: with seven
  // chapters and seven sections the greedy pass bound every one, so a "Fee
  // Schedule" section landed on the "Next Steps" chapter purely because it sat
  // in a comparable position. A document where the wrong section fills a
  // chapter looks entirely correct and is completely wrong, and the appendix —
  // which exists to catch precisely this — was left empty.
  if (!shared) return 0;

  // Against the shorter list, so a two-word chapter matching two words of a
  // six-word section still scores full marks.
  const overlap = shared / Math.min(a.length, b.length);

  // Position, as a fraction of each list. Sections and chapters rarely have the
  // same count, so absolute index would punish every longer template.
  const here = chapterCount > 1 ? chapterIndex / (chapterCount - 1) : 0;
  const there = sectionCount > 1 ? section.index / (sectionCount - 1) : 0;
  const order = 1 - Math.abs(here - there);

  const shape = TABULAR_CHAPTERS.has(chapter) === section.tabular ? 1 : 0;

  return Math.round(100 * (0.7 * overlap + 0.22 * order + 0.08 * shape));
}

/** Below this a proposal is offered but reads as "probably nothing". */
export const WEAK_MATCH = 35;

/**
 * Propose a binding for every chapter of a format.
 *
 * Greedy and one-to-one: the strongest pair is taken first and both sides
 * removed, so no section is bound to two chapters. A section bound twice is
 * the failure mode that looks fine on the review screen and prints the same
 * three paragraphs in two places.
 */
export function proposeBinding(
  format: ReportArchetypeId,
  structure: ExtractedStructure,
): BindingPlan {
  const chapters = FORMAT_CHAPTERS[format] ?? [];
  const sections = structure.sections;

  const pairs: Array<{ c: number; s: number; score: number }> = [];
  chapters.forEach((chapter, c) => {
    sections.forEach((section, s) => {
      pairs.push({ c, s, score: scoreMatch(chapter, c, chapters.length, section, sections.length) });
    });
  });
  pairs.sort((x, y) => y.score - x.score);

  const takenChapter = new Set<number>();
  const takenSection = new Set<number>();
  const chosen = new Map<number, { s: number; score: number }>();
  for (const p of pairs) {
    if (p.score <= 0) break;
    if (takenChapter.has(p.c) || takenSection.has(p.s)) continue;
    takenChapter.add(p.c);
    takenSection.add(p.s);
    chosen.set(p.c, { s: p.s, score: p.score });
  }

  const bindings: ChapterBinding[] = chapters.map((chapter, c) => {
    const hit = chosen.get(c);
    if (!hit) {
      return {
        chapter,
        sectionIndex: null,
        confidence: 0,
        reason: 'Nothing in the template matched. The format will print this chapter from its own data.',
        confirmed: false,
      };
    }
    const section = sections[hit.s];
    return {
      chapter,
      sectionIndex: hit.s,
      confidence: hit.score,
      reason: hit.score >= WEAK_MATCH
        ? `"${section.title}" shares wording and sits in a comparable position.`
        : `"${section.title}" is the closest remaining section, but the match is weak — check it.`,
      confirmed: false,
    };
  });

  return {
    format,
    bindings,
    unbound: sections.filter((_, s) => !takenSection.has(s)).map((s) => s.index),
    unfilled: bindings.filter((b) => b.sectionIndex === null).map((b) => b.chapter),
  };
}

// ── Asking a model instead ──────────────────────────────────────────────────

/** The most of a section's body the model is shown when proposing a binding. */
export const BINDING_PREVIEW_CHARS = 200;

/**
 * The tool schema for a model-proposed binding.
 *
 * Deliberately the same shape `readBindingPlan` already validates, so the
 * model's answer goes through exactly the checks a person's edited plan does —
 * every index re-checked against the structure, one-to-one enforced, an
 * out-of-range reference degraded to `null` rather than raised. There is no
 * "trusted because a model said it" path.
 */
export const BINDING_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bindings'],
  properties: {
    bindings: {
      type: 'array',
      description: 'One entry per chapter, in the order given.',
      items: {
        type: 'object',
        required: ['chapter', 'sectionIndex', 'confidence', 'reason'],
        properties: {
          chapter: { type: 'string', description: 'The chapter, copied exactly.' },
          sectionIndex: {
            type: ['integer', 'null'],
            description: 'The section that plays this chapter, or null for nothing suitable.',
          },
          confidence: { type: 'integer', description: '0–100. Be honest; a person reads this.' },
          reason: { type: 'string', description: 'One sentence. Why this section, for a reviewer.' },
        },
      },
    },
  },
} as const;

/**
 * What the model is asked when proposing a binding.
 *
 * The scorer below only knows about shared words, which is enough for one of
 * our own reports read back — the titles are identical — and not enough for a
 * stranger's template, where "Serviceability Assessment" has to reach "How the
 * capacity is built". That is a judgement about meaning, and it is the one
 * thing a model is unambiguously better at than a token-overlap heuristic.
 *
 * A person still confirms every row. The model's job is to make the review
 * screen's defaults right, not to decide anything.
 */
export function bindingPrompt(
  formatLabel: string,
  chapters: readonly string[],
  sections: readonly ExtractedSection[],
): string {
  const chapterList = chapters.map((c, i) => `${i + 1}. ${c}`).join('\n');
  const sectionList = sections.map((s) => {
    const preview = s.markdown.replace(/\s+/g, ' ').trim().slice(0, BINDING_PREVIEW_CHARS);
    return `[${s.index}] "${s.title}"${s.tabular ? ' (mostly a table)' : ''}\n    ${preview}`;
  }).join('\n');

  return `A ${formatLabel} has these chapters:

${chapterList}

Somebody uploaded their own template. It has these sections:

${sectionList}

For each chapter, say which section of the uploaded template plays that part.

- Match on what a section is *for*, not on shared words. "Serviceability
  assessment" and "How the capacity is built" are the same chapter under
  different names; "Fee schedule" and "How this was calculated" are not.
- Use each section at most once. If two chapters both want one section, give it
  to the better fit and return null for the other — a section printed under two
  headings is the failure this is checked for.
- Return null rather than reaching. A chapter with nothing bound is printed from
  the format's own data, which is a good outcome; a chapter filled with the
  wrong section looks entirely correct and is completely wrong.
- \`confidence\` is read by the person confirming this. Below 35 shows as "check
  it", so use a low number when you mean one.
- \`sectionIndex\` is the number in brackets, not the position in your list.`;
}

/** Formats the converter can bind to today. */
export function bindableFormats(): ReportArchetypeId[] {
  return (Object.keys(FORMAT_CHAPTERS) as ReportArchetypeId[])
    .filter((id) => (FORMAT_CHAPTERS[id] ?? []).length > 0);
}

/**
 * Formats whose renderer prints a different name from the archetype's.
 *
 * The archetype's `documentName` is metadata — it names the *kind* of report for
 * the catalogue. The renderer's `DOCUMENT_NAME` is the string that appears on
 * the cover. For Borrowing Capacity the two disagree: the archetype says
 * "Borrowing Capacity Assessment", `borrowingCapacity/render.pure.ts:67` prints
 * "Borrowing Capacity Snapshot".
 *
 * The review screen is telling a person what their converted document will be
 * called, so it has to say what will be printed. Kept as an override rather than
 * imported from the renderer because that module pulls the whole Borrowing
 * Capacity render path into a browser bundle for one string;
 * `converterChapters.spec.ts` imports it instead and asserts the two agree.
 */
const FORMAT_DOCUMENT_NAMES: Partial<Record<ReportArchetypeId, string>> = {
  'borrowing-capacity': 'Borrowing Capacity Snapshot',
};

/** The document name a bound format prints, for the review screen. */
export function formatName(format: ReportArchetypeId): string {
  return FORMAT_DOCUMENT_NAMES[format] ?? REPORT_ARCHETYPES[format]?.documentName ?? format;
}

/**
 * Read a binding plan back from the client, keeping only legal references.
 *
 * A plan round-trips through a browser where a person edits it, so every index
 * is re-checked against the structure it claims to be about. An out-of-range
 * `sectionIndex` becomes `null` rather than an error: the chapter simply has
 * nothing bound, which is a state the document already handles.
 */
export function readBindingPlan(
  raw: unknown,
  format: ReportArchetypeId,
  structure: ExtractedStructure,
): BindingPlan {
  const chapters = FORMAT_CHAPTERS[format] ?? [];
  const rows = Array.isArray((raw as { bindings?: unknown })?.bindings)
    ? (raw as { bindings: unknown[] }).bindings
    : [];
  const byChapter = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (row && typeof row === 'object' && typeof (row as Record<string, unknown>).chapter === 'string') {
      byChapter.set(String((row as Record<string, unknown>).chapter), row as Record<string, unknown>);
    }
  }

  const used = new Set<number>();
  const bindings: ChapterBinding[] = chapters.map((chapter) => {
    const row = byChapter.get(chapter);
    const rawIndex = Number(row?.sectionIndex);
    const legal = Number.isInteger(rawIndex)
      && rawIndex >= 0
      && rawIndex < structure.sections.length
      && !used.has(rawIndex);
    if (legal) used.add(rawIndex);
    return {
      chapter,
      sectionIndex: legal ? rawIndex : null,
      confidence: Number.isFinite(Number(row?.confidence))
        ? Math.max(0, Math.min(100, Math.round(Number(row?.confidence))))
        : 0,
      reason: typeof row?.reason === 'string' ? row.reason.slice(0, 300) : '',
      confirmed: row?.confirmed === true,
    };
  });

  return {
    format,
    bindings,
    unbound: structure.sections.filter((s) => !used.has(s.index)).map((s) => s.index),
    unfilled: bindings.filter((b) => b.sectionIndex === null).map((b) => b.chapter),
  };
}
