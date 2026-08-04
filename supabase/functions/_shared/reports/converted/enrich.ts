/**
 * Enrichment, the part that talks to Anthropic.
 *
 * Everything decidable is next door in `enrich.pure.ts` — the vocabulary, the
 * schema, the prompts, the reader, the quota — and `faithfulness.pure.ts` holds
 * the figure check. This file owns the fetch, the concurrency and the one
 * retry, and nothing else. That split is what lets the guards be tested by
 * handing them bad blocks rather than by mocking an API.
 *
 * ## It cannot fail the render
 *
 * Every failure path here — no key, a timeout, a refusal, a guard rejecting
 * twice, zero blocks — resolves to *that chapter having no entry* in the
 * returned map, and `render.pure.ts` renders a chapter with no entry exactly as
 * the converter always did. So the worst outcome of this whole module going
 * wrong is the output the converter produced before it existed. Nothing here
 * throws, and `enrichChapters` has no rejection path.
 *
 * ## Why chapters are enriched separately
 *
 * One call per chapter, not one per document. A chapter is the unit a person
 * confirms on the review screen, it is the unit the page budget is costed in,
 * and — the reason that actually decides it — a single document-wide call
 * fails as a single document-wide unit. Six chapters means six independent
 * chances to succeed, and a run where five chapters designed and one fell back
 * to prose is a good outcome rather than a wasted eleven seconds.
 */
import {
  checkQuota,
  dropRedundantLede,
  ENRICHMENT_JSON_SCHEMA,
  enrichedText,
  enrichmentPrompt,
  enrichmentRetryPrompt,
  parseEnrichment,
  partitionForEnrichment,
  tooShortNote,
  type ConversionFidelity,
  type EnrichedBlock,
} from './enrich.pure.ts';
import { checkFaithful } from './faithfulness.pure.ts';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/** The repo-wide standard. Overridable per deploy, as everywhere else. */
export const ENRICHMENT_MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-opus-4-8';

/** One chapter is a page or two of Markdown; this is generous for that. */
export const ENRICHMENT_TIMEOUT_MS = 120_000;

/**
 * How many chapters are in flight at once.
 *
 * Four rather than "all of them": a Borrowing Capacity draft has three to nine
 * chapters and firing nine concurrent Opus calls is how a tenant discovers
 * their rate limit during a conversion. Four keeps a six-chapter document to
 * two rounds.
 */
export const ENRICHMENT_CONCURRENCY = 4;

export interface ChapterToEnrich {
  /** `PlannedConvertedChapter.id`. The key the render path looks up. */
  id: string;
  title: string;
  markdown: string;
}

export interface ChapterEnrichment {
  id: string;
  blocks: EnrichedBlock[];
  /** Empty when the chapter enriched cleanly on the first attempt. */
  notes: string[];
  attempts: number;
}

export interface EnrichmentRun {
  /** Only the chapters that produced blocks. */
  enriched: Record<string, EnrichedBlock[]>;
  /** Every note from every chapter, prefixed with the chapter's title. */
  notes: string[];
  /** Null when nothing was attempted — no key, or nothing to enrich. */
  model: string | null;
  chaptersAttempted: number;
  chaptersEnriched: number;
}

interface ToolAnswer {
  ok: boolean;
  raw?: unknown;
  error?: string;
}

/**
 * One forced tool call.
 *
 * `tool_choice` rather than "please return JSON": the schema is enforced by the
 * API, so a missing brace is not a class of failure that reaches the reader at
 * all. Same shape as `generate-brand-design-system`, deliberately — there are
 * now two model calls in this feature and they should fail identically.
 */
async function askForBlocks(apiKey: string, prompt: string): Promise<ToolAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENRICHMENT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ENRICHMENT_MODEL,
        max_tokens: 8_000,
        tools: [{
          name: 'chapter_blocks',
          description: 'The chapter, laid out as designed blocks.',
          input_schema: ENRICHMENT_JSON_SCHEMA,
        }],
        tool_choice: { type: 'tool', name: 'chapter_blocks' },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
  } catch (e) {
    return { ok: false, error: `the design service did not answer: ${String(e)}` };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { ok: false, error: `the design service refused (${response.status}): ${detail.slice(0, 200)}` };
  }

  const message = await response.json().catch(() => null) as
    | { content?: Array<{ type?: string; name?: string; input?: unknown }> }
    | null;
  const tool = (Array.isArray(message?.content) ? message!.content : [])
    .find((b) => b?.type === 'tool_use' && b?.name === 'chapter_blocks');
  if (tool?.input && typeof tool.input === 'object') return { ok: true, raw: tool.input };
  return { ok: false, error: 'the design service returned no blocks' };
}

/**
 * Enrich one chapter, with at most one retry.
 *
 * The two guards run in the same place and in this order, because they answer
 * different questions and the expensive one should not run on output that
 * already lost. Faithfulness asks *is this true* — a chapter that invents a
 * figure is discarded whatever else it did. The quota asks *is this designed* —
 * a chapter of nothing but prose is honest and useless.
 */
async function enrichChapter(
  apiKey: string,
  chapter: ChapterToEnrich,
  fidelity: ConversionFidelity,
): Promise<ChapterEnrichment> {
  const notes: string[] = [];
  let prompt = enrichmentPrompt(chapter.title, chapter.markdown, fidelity);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const answer = await askForBlocks(apiKey, prompt);
    if (!answer.ok) {
      notes.push(answer.error ?? 'the design service failed');
      return { id: chapter.id, blocks: [], notes, attempts: attempt };
    }

    const { blocks: read, notes: readNotes } = parseEnrichment(answer.raw);
    notes.push(...readNotes);
    // Done here rather than in the reader because the reader is handed one
    // chapter's blocks and knows nothing about the header printed above them.
    const blocks = dropRedundantLede(read, chapter.title);
    if (!blocks.length) {
      if (attempt === 2) return { id: chapter.id, blocks: [], notes, attempts: attempt };
      prompt = enrichmentRetryPrompt(
        chapter.title, chapter.markdown, fidelity, 'it produced no usable blocks',
      );
      continue;
    }

    const faithful = checkFaithful(chapter.markdown, enrichedText(blocks));
    if (!faithful.ok) {
      notes.push(`rejected: ${faithful.reason}`);
      if (attempt === 2) return { id: chapter.id, blocks: [], notes, attempts: attempt };
      prompt = enrichmentRetryPrompt(chapter.title, chapter.markdown, fidelity, faithful.reason);
      continue;
    }

    const quota = checkQuota(chapter.markdown, blocks);
    if (!quota.ok) {
      notes.push(`rejected: ${quota.reason}`);
      if (attempt === 2) return { id: chapter.id, blocks: [], notes, attempts: attempt };
      prompt = enrichmentRetryPrompt(chapter.title, chapter.markdown, fidelity, quota.reason);
      continue;
    }

    if (quota.reason) notes.push(quota.reason);
    return { id: chapter.id, blocks, notes, attempts: attempt };
  }

  return { id: chapter.id, blocks: [], notes, attempts: 2 };
}

/**
 * Enrich every chapter that has content, `ENRICHMENT_CONCURRENCY` at a time.
 *
 * Never throws. A chapter that ends with no blocks simply has no entry in
 * `enriched`, which the render path reads as "print this one as Markdown".
 */
export async function enrichChapters(
  apiKey: string | null | undefined,
  chapters: readonly ChapterToEnrich[],
  fidelity: ConversionFidelity,
): Promise<EnrichmentRun> {
  // Chapters worth asking about, and the ones that are too small to be worth
  // eleven seconds. `skipped` is reported rather than silently dropped: a
  // person looking at "4 of 6 designed" deserves to know the other two were not
  // attempted rather than assume they failed.
  const { work, skipped } = partitionForEnrichment(chapters);

  if (!apiKey || !work.length) {
    return {
      enriched: {},
      notes: apiKey
        ? skipped.map(tooShortNote)
        : ['ANTHROPIC_API_KEY is not configured, so no chapter was designed'],
      model: null,
      chaptersAttempted: 0,
      chaptersEnriched: 0,
    };
  }

  const results: ChapterEnrichment[] = [];
  for (let i = 0; i < work.length; i += ENRICHMENT_CONCURRENCY) {
    const batch = work.slice(i, i + ENRICHMENT_CONCURRENCY);
    const done = await Promise.all(batch.map(async (c) => {
      try {
        return await enrichChapter(apiKey, c, fidelity);
      } catch (e) {
        // The catch that makes the promise above unable to reject. Enrichment
        // throwing must not take a render with it.
        return { id: c.id, blocks: [], notes: [`failed: ${String(e).slice(0, 200)}`], attempts: 1 };
      }
    }));
    results.push(...done);
  }

  const enriched: Record<string, EnrichedBlock[]> = {};
  const notes: string[] = [];
  const titleOf = new Map(work.map((c) => [c.id, c.title]));
  for (const r of results) {
    if (r.blocks.length) enriched[r.id] = r.blocks;
    for (const note of r.notes) notes.push(`${titleOf.get(r.id) ?? r.id}: ${note}`);
  }

  for (const c of skipped) notes.push(tooShortNote(c));

  return {
    enriched,
    notes,
    model: ENRICHMENT_MODEL,
    chaptersAttempted: work.length,
    chaptersEnriched: Object.keys(enriched).length,
  };
}
