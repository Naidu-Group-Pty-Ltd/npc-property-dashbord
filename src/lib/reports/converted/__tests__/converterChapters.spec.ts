/**
 * The converter's chapter list must be the renderer's chapter list.
 *
 * `FORMAT_CHAPTERS` is the only place in the programme where a format's chapters
 * are written down twice — the renderer builds them from a payload, and the
 * converter has no payload yet, so it needs them declared. Two copies of the
 * same truth drift, and this one already did: the first version listed
 * `Position Summary`, `Income`, `Commitments`, `Serviceability`,
 * `Capacity & Scenarios`, `Assumptions`, `Next Steps` — seven noun phrases
 * lifted from the archetype's description, not one of which the renderer prints.
 *
 * The cost was measured on a real conversion: a Borrowing Capacity Snapshot
 * bound 3 of 7 chapters and sent 3 sections to an appendix, because the
 * document's chapters are editorial sentences (`Capacity at a glance`) and the
 * list was functional labels (`Position Summary`). Nothing failed loudly. The
 * review screen showed a plausible binding of the wrong things.
 *
 * So this file compares the two directly, once per format, against a payload
 * built to make that format print everything it can (`formatPayloads.ts`). It
 * is deliberately in its own spec rather than in `converter.spec.ts`, because it
 * is the only reason the converter tests need every format's payload module at
 * all, and because when it fails the message should be about drift, not about
 * binding.
 */
import { describe, expect, it } from 'vitest';

import { buildSnapshot } from '../../borrowingCapacity/normalise.pure';
import { snapshotSections } from '../../borrowingCapacity/sections.pure';
import { DOCUMENT_NAME as BC_NAME } from '../../borrowingCapacity/render.pure';
import { DOCUMENT_NAME as CF_NAME } from '../../cashFlow/render.pure';
import { DOCUMENT_NAME as CFC_NAME } from '../../cashFlowComparison/render.pure';
import { DOCUMENT_NAME as CD_NAME } from '../../clientDetails/render.pure';
import { DOCUMENT_NAME as PF_NAME } from '../../portfolio/render.pure';
import { DOCUMENT_NAME as PC_NAME } from '../../propertyComparison/render.pure';
import { DOCUMENT_NAME as MI_NAME } from '../../marketIntelligence/render.pure';
import { DOCUMENT_NAME as QA_NAME } from '../../reportQa/render.pure';
import { cashFlowSections } from '../../cashFlow/sections.pure';
import { comparisonSections as cashFlowComparisonSections } from '../../cashFlowComparison/sections.pure';
import { clientDetailsSections } from '../../clientDetails/sections.pure';
import { portfolioSections } from '../../portfolio/sections.pure';
import { comparisonSections as propertyComparisonSections } from '../../propertyComparison/sections.pure';
import { planSections } from '../../marketIntelligence/sections.pure';
import {
  SAMPLE_ASSESSMENT,
  SAMPLE_AUDIT_TRAIL,
  SAMPLE_CLIENT_NAME,
  SAMPLE_EXPLANATION,
  SAMPLE_SCENARIO_PRESETS,
} from '../../borrowingCapacity/__tests__/fixtures/sampleAssessment';
import {
  cashFlowComparisonMaximal,
  cashFlowComparisonMinimal,
  cashFlowMaximal,
  cashFlowMinimal,
  clientDetailsMaximal,
  clientDetailsMinimal,
  marketIntelligenceMaximal,
  portfolioMaximal,
  portfolioMinimal,
  propertyComparisonMaximal,
  propertyComparisonMinimal,
} from './formatPayloads';
import {
  bindableChapters,
  bindableFormats,
  FORMAT_CHAPTERS,
  formatName,
  isPassthroughFormat,
  proposeBinding,
  readBindingPlan,
  TABULAR_CHAPTERS,
} from '../binding.pure';
import { CONVERTED_REPORT_TYPES } from '../reportType';
import { getAdapter } from '@/lib/reportTemplate/adapters';
import type { ReportArchetypeId } from '@/lib/reportDesign/structure.pure';
import type { ExtractedStructure } from '../structure.pure';

/** Every conditional section present, so the list is the longest it can be. */
const bcFull = buildSnapshot({
  clientName: SAMPLE_CLIENT_NAME,
  assessment: SAMPLE_ASSESSMENT,
  auditTrail: SAMPLE_AUDIT_TRAIL,
  explanation: SAMPLE_EXPLANATION,
  scenarioPresets: SAMPLE_SCENARIO_PRESETS,
});
const bcMinimal = buildSnapshot({ clientName: 'Nobody', assessment: {} });

/**
 * One row per declarative format: what the converter offers, and what the
 * renderer prints from a payload that turns everything on.
 *
 * `minimal` is the same format with every optional input withheld. The
 * converter offers the conditional chapters regardless — an unfilled chapter is
 * a state the document already handles, and a template that *does* carry an
 * audit section should be able to bind it — so `minimal` is asserted to be a
 * strict subset rather than an equal.
 */
const FORMATS: ReadonlyArray<{
  id: ReportArchetypeId;
  printed: () => string[];
  minimal?: () => string[];
  documentName: string;
}> = [
  {
    id: 'borrowing-capacity',
    printed: () => snapshotSections(bcFull).map((s) => s.title),
    minimal: () => snapshotSections(bcMinimal).map((s) => s.title),
    documentName: BC_NAME,
  },
  {
    id: 'cash-flow-projection',
    printed: () => cashFlowSections(cashFlowMaximal()).map((s) => s.title),
    minimal: () => cashFlowSections(cashFlowMinimal()).map((s) => s.title),
    documentName: CF_NAME,
  },
  {
    id: 'cash-flow-comparison',
    printed: () => cashFlowComparisonSections(cashFlowComparisonMaximal()).map((s) => s.title),
    minimal: () => cashFlowComparisonSections(cashFlowComparisonMinimal()).map((s) => s.title),
    documentName: CFC_NAME,
  },
  {
    id: 'client-details',
    printed: () => clientDetailsSections(clientDetailsMaximal()).map((s) => s.title),
    minimal: () => clientDetailsSections(clientDetailsMinimal()).map((s) => s.title),
    documentName: CD_NAME,
  },
  {
    id: 'portfolio-performance',
    printed: () => portfolioSections(portfolioMaximal()).map((s) => s.title),
    minimal: () => portfolioSections(portfolioMinimal()).map((s) => s.title),
    documentName: PF_NAME,
  },
  {
    id: 'property-comparison',
    printed: () => propertyComparisonSections(propertyComparisonMaximal()).map((s) => s.title),
    minimal: () => propertyComparisonSections(propertyComparisonMinimal()).map((s) => s.title),
    documentName: PC_NAME,
  },
  {
    id: 'market-intelligence',
    printed: () => planSections(marketIntelligenceMaximal()).sections.map((s) => s.title),
    documentName: MI_NAME,
  },
];

describe.each(FORMATS)('$id chapters', ({ id, printed, minimal, documentName }) => {
  it('is exactly what the renderer prints, in the same order', () => {
    expect([...(FORMAT_CHAPTERS[id] ?? [])]).toEqual(printed());
  });

  it('offers the conditional chapters too, so a template can fill them', () => {
    if (!minimal) return;
    const always = minimal();
    const chapters = FORMAT_CHAPTERS[id] ?? [];
    for (const title of always) expect(chapters, title).toContain(title);
    expect(chapters.length).toBeGreaterThan(always.length);
  });

  it('names the document what the cover will actually say', () => {
    // The review screen is telling a person what they are about to get, so it
    // has to say the printed name. For Borrowing Capacity the archetype's
    // `documentName` ("Assessment") and the renderer's ("Snapshot") disagree.
    expect(formatName(id)).toBe(documentName);
  });
});

/** An uploaded template, as `extractStructure` would return it. */
const structure = (titles: readonly string[]): ExtractedStructure => ({
  title: 'A Client Conversation',
  sections: titles.map((title, index) => ({
    index,
    title,
    markdown: `Something about ${title.toLowerCase()}.`,
    level: 1,
    tabular: false,
    chars: 40,
  })),
  chars: 40 * titles.length,
  truncated: false,
});

describe('report Q&A takes its chapters from the template', () => {
  const QUESTIONS = [
    'What happens to my borrowing capacity if rates move?',
    'Should I sell the Newstead unit?',
    'How much deposit do I actually need?',
  ];

  it('is bindable without appearing in FORMAT_CHAPTERS', () => {
    // Not an oversight to be tidied up. `planFromTurns` titles each chapter with
    // the client's own question, so there is no list that could be written down
    // and be true — and writing one anyway is the exact failure this file exists
    // to catch.
    expect(bindableFormats()).toContain('report-qa');
    expect(FORMAT_CHAPTERS['report-qa']).toBeUndefined();
    expect(isPassthroughFormat('report-qa')).toBe(true);
  });

  it('offers the template’s own sections as the chapters', () => {
    expect([...bindableChapters('report-qa', structure(QUESTIONS))]).toEqual(QUESTIONS);
  });

  it('binds every section, in order, with nothing left over', () => {
    const plan = proposeBinding('report-qa', structure(QUESTIONS));
    expect(plan.bindings.map((b) => b.sectionIndex)).toEqual([0, 1, 2]);
    expect(plan.unbound).toEqual([]);
    expect(plan.unfilled).toEqual([]);
  });

  it('survives a template with two sections of the same name', () => {
    // Read back by chapter *title*, two `Notes` sections would collapse to one
    // row and silently unbind the other. This is why the pass-through plan is
    // rebuilt from the structure rather than read.
    const twins = structure(['Notes', 'Notes']);
    const plan = readBindingPlan(proposeBinding('report-qa', twins), 'report-qa', twins);
    expect(plan.bindings.map((b) => b.sectionIndex)).toEqual([0, 1]);
    expect(plan.unbound).toEqual([]);
  });

  it('names the document what the cover will actually say', () => {
    expect(formatName('report-qa')).toBe(QA_NAME);
  });
});

describe('the bindable list as a whole', () => {
  it('offers all eight migrated formats and nothing else', () => {
    expect([...bindableFormats()].sort()).toEqual([
      'borrowing-capacity',
      'cash-flow-comparison',
      'cash-flow-projection',
      'client-details',
      'market-intelligence',
      'portfolio-performance',
      'property-comparison',
      'report-qa',
    ]);
  });

  it('gives every format either real chapters or pass-through — never neither', () => {
    for (const format of bindableFormats()) {
      const declared = (FORMAT_CHAPTERS[format] ?? []).length > 0;
      expect(declared || isPassthroughFormat(format), format).toBe(true);
      // And never both: a format that declares chapters and also passes through
      // would take one path in `proposeBinding` and the other in the docs.
      expect(declared && isPassthroughFormat(format), format).toBe(false);
    }
  });

  it('files a converted template under a report type that exists', () => {
    // `TemplateConverter` maps each bindable format to an adapter key when it
    // creates an editable copy. A format with no adapter would file the template
    // under a type nothing can resolve.
    for (const format of bindableFormats()) {
      expect(getAdapter(CONVERTED_REPORT_TYPES[format]), format).not.toBeNull();
    }
  });

  it('marks as tabular only chapters that some format actually prints', () => {
    // The first version of `TABULAR_CHAPTERS` was keyed off the invented titles,
    // so it matched nothing and the shape signal in `scoreMatch` was dead
    // weight. This is the check that would have said so.
    const every = new Set(Object.values(FORMAT_CHAPTERS).flatMap((list) => [...(list ?? [])]));
    for (const chapter of TABULAR_CHAPTERS) {
      expect(every, chapter).toContain(chapter);
    }
  });
});
