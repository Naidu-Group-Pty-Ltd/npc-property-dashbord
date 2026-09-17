/**
 * The condensed tiers' composition — the deterministic half of
 * `condense-investment-report`.
 *
 * ## Why it moved
 *
 * A Briefing and a Snapshot need one model call each, for the condensed
 * location case. Everything that happens to that answer afterwards does not:
 * the financial chapters, the score breakdown, the SWOT, the verdict and the
 * financial snapshot are COMPOSED from the row's own record; the model's
 * output is trimmed to what the tier declares, every section is placed in the
 * order the registry declares, and five hygiene passes run over the result.
 *
 * All of it lived inside the edge function's `index.ts`, so — exactly as with
 * the fork (`forkSplit.pure.ts`) — none of it could run outside a deployed
 * Deno runtime, and the two documents it produces have never been drawn and
 * read end to end.
 *
 * Nothing here is new. Every line is moved verbatim from
 * `condense-investment-report/index.ts`, with three changes and no fourth:
 * the handler's `parentReport.*` reads became inputs, `postProcessReportMarkdown`
 * is imported statically rather than dynamically, and `runQAValidation` stays
 * in the handler — validating a document is reporting, not composing it.
 *
 * The hygiene counts come back rather than being logged from inside, so a
 * caller that is not an edge function can see what was removed.
 */
import {
  composeFinancialChapters, composeFinancialSnapshotSection,
} from './financialChapters.pure.ts';
import {
  composeScoreBreakdownSection, composeScoreDimensionsSection,
  composeSwotSection, composeVerdictSection,
} from './scoreSections.pure.ts';
import { recordedScoreValues, suppressUnrecordedScores } from './scoreClaims.pure.ts';
import { dropEmptySections, stripPlaceholderRows, trimToDeclaredSections } from './derivedHygiene.pure.ts';
import { scrubBlocks } from './blockHygiene.pure.ts';
import { authoredHeadingsForTier, markdownHeadingsForTier } from './sectionRegistry.pure.ts';
import { assembleInDeclaredOrder, type ComposedPlacement } from './tierAssembly.pure.ts';
import {
  postProcessReportMarkdown, stripEditorialLabelsFromMarkdown,
} from '../../compassPostProcessor.ts';

/** The two tiers this composes. The other three are not condensed. */
export type CondensedTier = 'briefing' | 'snapshot';

export interface CondenseComposeInput {
  tier: CondensedTier;
  /** What the model returned, before anything is done to it. */
  modelMarkdown: string;
  /** The parent's recorded score — what every composed section is typed from. */
  investmentScore: unknown;
  /** The parent's recorded calculation. */
  financialCalculations: unknown;
  /**
   * The parent's own prose, for the score guard alone: a claim the PARENT made
   * is the parent's, and only a figure neither the record nor the parent holds
   * is removed.
   */
  parentContent?: string;
}

export interface CondenseComposeResult {
  markdown: string;
  /** What each pass removed or placed — the handler logs it, a harness prints it. */
  hygiene: Record<string, unknown>;
  /** The post-processor's own report, on the Briefing. Null on the Snapshot. */
  postProcessReport: unknown;
  /** The recorded score values, so the caller can run QA against the same set. */
  recordedScores: ReturnType<typeof recordedScoreValues>;
}

export function composeCondensedDocument(input: CondenseComposeInput): CondenseComposeResult {
  const tier = input.tier;
  let condensedContent = input.modelMarkdown;
  let postProcessReport: unknown = null;
  // Sections composed from the record, addressed by the registry id that
  // decides where each one goes. Collected for both condensed tiers and
  // placed by `assembleInDeclaredOrder` below.
  const composedPlacements: ComposedPlacement[] = [];
  const hygiene: Record<string, unknown> = {};


    if (tier === 'briefing') {
      const result = postProcessReportMarkdown(condensedContent, 'compass-40');
      condensedContent = result.markdown;
      postProcessReport = result.report;

      // The financial tables, the score breakdown and the SWOT are COMPOSED
      // from the row's own record, never asked of the model — the guide
      // forbids it, and the model's version is what wrote 87 N/As on the
      // newest briefing. The parent's score and calculations were copied
      // onto this child above, so the composed sections and the templated
      // KPI tiles read the same record.
      //
      // Each chapter is tagged with the section id the registry places it at.
      // The map is here rather than in the composer because the composer
      // answers to the Financial tier's layout and the registry answers to
      // the Briefing's.
      const CHAPTER_SECTION_ID: Record<number, ComposedPlacement['id']> = {
        4: 'purchaseHolding', 5: 'rentalYield', 6: 'loan', 8: 'sensitivity', 9: 'tenYear',
      };
      for (const ch of composeFinancialChapters(
        { financialCalculations: input.financialCalculations, investmentScore: input.investmentScore },
        { scenarios: 'primary' },
      )) {
        // 12 and 14 are the FIN-titled scorecard and SWOT; the briefing
        // carries them under its own headings below.
        const id = CHAPTER_SECTION_ID[ch.ordinal];
        if (id) composedPlacements.push({ id, markdown: ch.markdown });
      }
      const scoreSection = composeScoreBreakdownSection(input.investmentScore, 'Investment Score Breakdown');
      if (scoreSection) composedPlacements.push({ id: 'scorecard', markdown: scoreSection });
      const swotSection = composeSwotSection(input.investmentScore, 'SWOT Analysis');
      if (swotSection) composedPlacements.push({ id: 'swot', markdown: swotSection });
    }

    // The Snapshot composes too, and until now composed NOTHING — the only
    // member of the family that did not. Briefing 7 sections from the record,
    // Financial 8, Snapshot 0, while four of its nine model-authored sections
    // were numeric. Three of those four are figures the record holds outright,
    // so they are typed from it here; `Key Market Stats` stays authored
    // because median price, vacancy rate, days on market and walk score are
    // NOT in `financial_calculations` and composing them would mean inventing
    // a source, which is the worse failure.
    if (tier === 'snapshot') {
      const verdictSection = composeVerdictSection(input.investmentScore, 'Investment Score');
      if (verdictSection) composedPlacements.push({ id: 'verdict', markdown: verdictSection });
      const dimsSection = composeScoreDimensionsSection(input.investmentScore, 'Score Breakdown');
      if (dimsSection) composedPlacements.push({ id: 'scorecard', markdown: dimsSection });
      const finSection = composeFinancialSnapshotSection(input.financialCalculations, 'Financial Snapshot');
      if (finSection) composedPlacements.push({ id: 'financialSnapshot', markdown: finSection });
    }
    hygiene.composed_sections = composedPlacements.length;

    // Trim to what the tier declares — on BOTH condensed tiers now.
    //
    // The snapshot's list used to be typed out here, a ninth copy of the
    // structure; it comes from the registry, which declares exactly the same
    // nine headings in the same order, so this half is a no-op.
    //
    // The briefing is the change. It had no trim at all, and every one of the
    // 21 briefings in production carries the PARENT's structure rather than
    // its own: `Location Overview` on 20, `Historical Price Growth Table` on
    // 19, `Major Industries & Job Growth` on 19 — while six of its nine
    // declared headings (`Location & Demand`, `Amenity & Access`, `Market
    // Position`, `Property Fit`, `Risk Overview`, `Recommendation`) appear on
    // NONE. Phase 1 re-cut the guide and shipped no enforcement, so the guide
    // was aspirational; the snapshot got both halves and the briefing got one.
    //
    // The trim runs on the model's own output, BEFORE the composed sections
    // are placed — they are ours and always declared, so including them here
    // would only make the "did the model follow the guide" question answer
    // itself.
    if (tier === 'briefing' || tier === 'snapshot') {
      const declared = markdownHeadingsForTier(tier);
      const trimmed = trimToDeclaredSections(condensedContent, declared);
      // A trim that keeps nothing the MODEL wrote is not a trim, it is a
      // deletion: the briefing would go out as its composed financial tables
      // with no case attached to them. In that state, keep the untrimmed text
      // and record it: a stub is worse than a document with the wrong
      // headings, and the count belongs in the log rather than in a client's
      // hands.
      const authored = authoredHeadingsForTier(tier).map((h) => h.toLowerCase());
      const survivors = [...trimmed.markdown.matchAll(/^##\s+(.+?)\s*$/gm)]
        .map((m) => m[1].toLowerCase().replace(/\s+/g, ' ').trim());
      const keptAny = survivors.some((h) => authored.some((a) => h === a || h.startsWith(`${a} `)));
      if (keptAny) {
        condensedContent = trimmed.markdown;
        hygiene.sections_dropped = trimmed.dropped;
      } else {
        hygiene.sections_trim_skipped = trimmed.dropped;
      }

      // Place every section in the order the registry declares, composed
      // ones included. They used to be appended after everything the model
      // wrote — so the Briefing's financial tables, score breakdown and SWOT
      // printed after `Recommendation` (order 20) and after `Market Data
      // Sources` (order 90), when the registry places them at 11-17. The
      // trim filters and has never reordered.
      //
      // Assembly runs only where the trim actually ran: on untrimmed text a
      // foreign heading is ABSORBED into whichever section is open rather
      // than dropped, and the fallback append keeps the composed sections in
      // the document rather than losing them to a structural safety check.
      if (composedPlacements.length || keptAny) {
        if (keptAny) {
          const assembled = assembleInDeclaredOrder(condensedContent, composedPlacements, tier);
          condensedContent = assembled.markdown;
          hygiene.sections_placed = assembled.placed;
          hygiene.sections_authored = assembled.authored;
          if (assembled.unplaced.length) hygiene.sections_unplaced = assembled.unplaced;
        } else if (composedPlacements.length) {
          condensedContent = `${condensedContent.trimEnd()}\n\n${composedPlacements.map((c) => c.markdown).join('\n\n')}`;
          hygiene.sections_appended_untrimmed = composedPlacements.length;
        }
      }

      const stripped = stripEditorialLabelsFromMarkdown(condensedContent);
      condensedContent = stripped.markdown;
      hygiene.editorial_blocks_removed = stripped.removedBlocks;
    }

    // A labelled row is a promise that a figure follows it — on every tier.
    const scrubbed = stripPlaceholderRows(condensedContent);
    condensedContent = scrubbed.markdown;
    hygiene.placeholder_rows_removed = scrubbed.removedRows;
    hygiene.placeholder_tables_removed = scrubbed.removedTables;
    // And the heading a scrubbed table leaves standing over nothing goes
    // with it — a "Key Market Stats" with no stats is a promise unkept.
    const sections = dropEmptySections(condensedContent);
    condensedContent = sections.markdown;
    hygiene.empty_sections_removed = sections.dropped.length;

    // The same rule for the two block types the row scrubber cannot see: a
    // stat card with no value (the renderer draws its UNIT in display type)
    // and a chart already drawn earlier in the document.
    const blocks = scrubBlocks(condensedContent);
    condensedContent = blocks.markdown;
    hygiene.empty_stat_cards_removed = blocks.emptyStatCards;
    hygiene.duplicate_directives_removed = blocks.duplicateDirectives;

    // A summarising report may not invent or re-estimate a score (QA-18):
    // the Briefing of 291 Stone Mason Drive rated an "overall investment
    // fit" 68/100 and two "scores of 82" that neither the record nor the
    // parent holds. The sentence carrying such a claim goes, and the log
    // says which. Composed tables print only recorded figures and are
    // untouched; a claim the parent made itself is the parent's.
    const recordedScores = recordedScoreValues(input.investmentScore);
    const scoreGuard = suppressUnrecordedScores(condensedContent, {
      recorded: recordedScores,
      parentText: typeof input.parentContent === 'string' ? input.parentContent : undefined,
    });
    condensedContent = scoreGuard.markdown;
    hygiene.unrecorded_score_claims_removed = scoreGuard.removed.length;
    if (scoreGuard.removed.length) hygiene.unrecorded_score_claims = scoreGuard.removed.map((r) => r.text);

  return { markdown: condensedContent, hygiene, postProcessReport, recordedScores };
}
