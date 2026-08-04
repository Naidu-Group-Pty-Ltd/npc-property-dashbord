/**
 * The template converter.
 *
 * Four things are worth pinning here, and each is something a render found or
 * would have hidden: how a lone title heading affects section depth, that a
 * binding is one-to-one, that a weak match is *offered but flagged* rather than
 * silently accepted, and that nothing a person uploaded disappears.
 */
import { describe, expect, it } from 'vitest';
import { describeStructure, extractStructure, MAX_BIND_DEPTH } from '../structure.pure';
import {
  bindableFormats,
  FORMAT_CHAPTERS,
  formatName,
  proposeBinding,
  readBindingPlan,
  scoreMatch,
  WEAK_MATCH,
} from '../binding.pure';
import {
  CHAPTER_FURNITURE_LINES,
  planConvertedChapters,
  renderConvertedDocument,
} from '../render.pure';
import { enrichedLines, type EnrichedBlock } from '../enrich.pure';
import {
  auditBrandDesignSystem,
  describeAuditProblems,
  readBrandDesignSystem,
  slugify,
} from '../../../brandDesign/system.pure';
import { resolveReportPalette } from '../../../../../supabase/functions/_shared/reportDesign/brandResolve.pure';
import { resolveCompanyBlock } from '../../../../../supabase/functions/_shared/reportDesign/companyBlock.pure';

/** The real company block shape, from `companyBlock.pure.ts`. */
const COMPANY = resolveCompanyBlock({
  company_name: 'Harbour & Vale Advisory', abn: '55 666 777 888',
  email: 'hello@hv.example', phone: '02 9000 0000',
  address: 'Level 8, 1 Example Quay, Sydney NSW 2000',
} as never, null);

const prose = (n = 3) =>
  Array.from({ length: n }, (_, i) =>
    `Capacity is assessed against a servicing buffer of ${(3 + i * 0.1).toFixed(2)}% above the `
    + 'advertised rate, on the household income and commitments recorded at application.').join('\n\n');

const table = '| Lender | Rate |\n| --- | --- |\n| One | 6.10% |\n| Two | 6.25% |\n| Three | 6.40% |';

const UPLOAD = [
  '# Borrowing Power Assessment',
  `## Client Position Summary\n\n${prose()}`,
  `## Household Income\n\n${table}`,
  `## Existing Commitments\n\n${table}`,
  `## Servicing & Buffers\n\n${prose()}`,
  `## Maximum Capacity and Scenarios\n\n${table}`,
  `## Assumptions Used\n\n${prose()}`,
  `## Fee Schedule\n\n${prose()}`,
].join('\n\n');

/**
 * One of *our* reports, as a transcription actually brings it back.
 *
 * Taken from the shape of a real failing conversion. Two things about it are
 * hostile and both are the design system's own doing:
 *
 * 1. Our chapters print a small `SECTION 01` eyebrow above a large title. A
 *    model reading the page maps visual size to heading level, so the eyebrow
 *    returns as `##` and the title it labels as `#`. The hierarchy is inverted.
 * 2. The masthead and the client name are large type on the cover, so they come
 *    back as `#` headings that own nothing.
 *
 * A converter that cannot read its own house format back is not going to manage
 * a stranger's, so this fixture is the one that matters most.
 */
const SNAPSHOT = [
  '# Naidu Property Consulting Services',
  '## Borrowing Capacity Snapshot',
  '# Masline Nyawo',
  '## Section 01',
  `# Capacity at a glance\n\n${prose()}`,
  '## Section 02',
  `# Income and commitments\n\n${table}`,
  '## Section 03',
  `# How the capacity is built\n\n${table}`,
].join('\n\n');

describe('extracting structure', () => {
  it('treats a lone top-level heading as the title, not a section', () => {
    // One `#` over a run of `##` is the overwhelmingly common shape. Without
    // this the baseline is the title's own level, every real section becomes
    // depth 2, and the review screen reports "0 sections" for a document that
    // plainly has seven.
    const s = extractStructure(UPLOAD);
    expect(s.title).toBe('Borrowing Power Assessment');
    expect(s.sections.length).toBe(7);
    expect(s.sections.every((x) => x.depth === 1)).toBe(true);
    expect(describeStructure(s)).toContain('7 sections');
  });

  it('keeps sub-sections as sub-sections when the source really nests', () => {
    const s = extractStructure(`# T\n\n## A\n\n${prose()}\n\n### A.1\n\n${prose()}`);
    expect(s.sections.map((x) => x.depth)).toEqual([1, 2]);
  });

  it('does not treat the top level as a title when several headings share it', () => {
    const s = extractStructure(`## One\n\n${prose()}\n\n## Two\n\n${prose()}`);
    expect(s.sections.map((x) => x.title)).toEqual(['One', 'Two']);
    expect(s.sections.every((x) => x.depth === 1)).toBe(true);
  });

  it('flattens headings deeper than the bind depth without losing them', () => {
    const deep = `# T\n\n## A\n\n${prose()}\n\n### B\n\n${prose()}\n\n#### C\n\n${prose()}`;
    const s = extractStructure(deep);
    expect(s.notices.flattened).toBeGreaterThan(0);
    expect(s.sections.every((x) => x.depth <= MAX_BIND_DEPTH)).toBe(true);
    // Nothing is lost — the deep heading is still in some section's prose.
    expect(s.sections.some((x) => x.markdown.includes('#### C'))).toBe(true);
  });

  it('strips a leading number so the spine does not print two', () => {
    const s = extractStructure(`# T\n\n## 3. Market Overview\n\n${prose()}`);
    expect(s.sections[0].title).toBe('Market Overview');
  });

  it('marks a source with no headings as unstructured rather than empty', () => {
    const s = extractStructure(prose(6));
    expect(s.notices.unstructured).toBe(true);
    expect(s.sections.length).toBe(1);
    expect(describeStructure(s)).toContain('No headings');
  });

  it('recognises a mostly-tabular section', () => {
    const s = extractStructure(`# T\n\n## Rates\n\n${table}`);
    expect(s.sections[0].tabular).toBe(true);
  });

  it('never throws, whatever it is handed', () => {
    for (const bad of ['', '   ', '#', '#'.repeat(40), null, undefined]) {
      expect(() => extractStructure(bad as never)).not.toThrow();
    }
  });

  it('folds an eyebrow label into the title it labels', () => {
    // `## Section 01` over `# Capacity at a glance` is one chapter, not two, and
    // the eyebrow is the one that is not it. Before this, every `## Section NN`
    // became an empty stub that was dropped as too short — which was survivable
    // — and the levelling that followed put sibling chapters at different
    // depths, which was not.
    const s = extractStructure(SNAPSHOT, 'BC Snapshot');
    expect(s.notices.labelsFolded).toBe(3);
    expect(s.sections.map((x) => x.title)).toEqual([
      'Capacity at a glance', 'Income and commitments', 'How the capacity is built',
    ]);
    expect(s.sections.every((x) => x.depth === 1)).toBe(true);
  });

  it('does not fold a heading that owns a body, however label-shaped', () => {
    // "Section 8" is a real chapter here — a clause of an act, with content. The
    // fold applies only to headings that own nothing, because that is the tell
    // that the title beneath them is the section.
    const s = extractStructure(`# T\n\n## Section 8\n\n${prose()}\n\n## Notes\n\n${prose()}`);
    expect(s.notices.labelsFolded).toBe(0);
    expect(s.sections.map((x) => x.title)).toEqual(['Section 8', 'Notes']);
  });

  it('does not fold a real heading that merely happens to be empty', () => {
    // A chapter with no body under it is still a chapter if it does not read
    // like a label. It is dropped as too short, which is the old behaviour, not
    // silently merged into its neighbour.
    const s = extractStructure(`# T\n\n## Fee Schedule\n\n## Notes\n\n${prose()}`);
    expect(s.notices.labelsFolded).toBe(0);
    expect(s.sections.map((x) => x.title)).toEqual(['Notes']);
  });
});

describe('binding to a report format', () => {
  const structure = extractStructure(UPLOAD);
  const plan = proposeBinding('borrowing-capacity', structure);

  it('offers one binding per chapter of the format', () => {
    expect(plan.bindings.map((b) => b.chapter))
      .toEqual([...(FORMAT_CHAPTERS['borrowing-capacity'] ?? [])]);
  });

  it('binds our own report to every chapter it has, and to nothing else', () => {
    // The acceptance case. A Borrowing Capacity Snapshot put back through the
    // converter must land on the three chapters the renderer always prints,
    // leave the three conditional ones unfilled, and send nothing to an
    // appendix. The run that prompted this work managed 3 bound, 4 unfilled and
    // 3 in the appendix — against a chapter list that was invented.
    const s = extractStructure(SNAPSHOT, 'BC Snapshot');
    const p = proposeBinding('borrowing-capacity', s);
    const byChapter = new Map(p.bindings.map((b) => [b.chapter, b]));

    for (const chapter of ['Capacity at a glance', 'Income and commitments', 'How the capacity is built']) {
      const b = byChapter.get(chapter)!;
      expect(b.sectionIndex, chapter).not.toBeNull();
      expect(s.sections[b.sectionIndex!].title, chapter).toBe(chapter);
      expect(b.confidence, chapter).toBeGreaterThanOrEqual(WEAK_MATCH);
    }
    expect(p.unbound).toEqual([]);
    expect(p.unfilled).toEqual(['How this was calculated', 'Audit trail', 'Scenario comparison']);
  });

  it('matches a foreign template where the wording genuinely overlaps', () => {
    // `UPLOAD` is somebody else's document, and it binds partially — which is
    // the honest outcome for a scorer that only knows about shared words. What
    // it must not do is bind a chapter to a section with nothing in common.
    const byChapter = new Map(plan.bindings.map((b) => [b.chapter, b]));
    const income = byChapter.get('Income and commitments')!;
    expect(income.sectionIndex).not.toBeNull();
    expect(structure.sections[income.sectionIndex!].title).toBe('Household Income');
    expect(income.confidence).toBeGreaterThanOrEqual(WEAK_MATCH);
  });

  it('never binds one section to two chapters', () => {
    // The failure that looks correct on the review screen and prints the same
    // three paragraphs twice.
    const used = plan.bindings.map((b) => b.sectionIndex).filter((i): i is number => i !== null);
    expect(new Set(used).size).toBe(used.length);
  });

  it('refuses the second chapter when one section is the best match for two', () => {
    // The assertion above passed on a fixture where no section was ever the top
    // candidate twice, so removing the one-to-one check changed nothing. This
    // is the shape that actually exercises it: a section called "Capacity at a
    // glance" is the best remaining match for the chapter of that name *and*
    // for "How the capacity is built", which shares a word with it.
    const merged = extractStructure(
      `# T\n\n## Capacity at a glance\n\n${table}\n\n## Something Else Entirely\n\n${prose()}`,
    );
    const p = proposeBinding('borrowing-capacity', merged);
    const byChapter = new Map(p.bindings.map((b) => [b.chapter, b]));
    const glance = byChapter.get('Capacity at a glance')!.sectionIndex;
    const built = byChapter.get('How the capacity is built')!.sectionIndex;

    // Exactly one of them gets it; the other is left unfilled rather than
    // printing the same table under two headings.
    expect([glance, built].filter((i) => i !== null).length).toBe(1);
    const used = p.bindings.map((b) => b.sectionIndex).filter((i): i is number => i !== null);
    expect(new Set(used).size).toBe(used.length);
  });

  it('flags a weak match in words rather than accepting it quietly', () => {
    const weak = plan.bindings.filter((b) => b.sectionIndex !== null && b.confidence < WEAK_MATCH);
    for (const b of weak) expect(b.reason).toMatch(/weak|check it/i);
  });

  it('keeps whatever the format had no place for', () => {
    // "Fee Schedule" is not a borrowing-capacity chapter. It must still appear.
    expect(plan.unbound.length).toBeGreaterThan(0);
    const kept = plan.unbound.map((i) => structure.sections[i].title);
    expect(kept).toContain('Fee Schedule');
  });

  it('reports chapters the template could not fill', () => {
    const empty = extractStructure(`# T\n\n## Something Unrelated\n\n${prose()}`);
    const p = proposeBinding('borrowing-capacity', empty);
    expect(p.unfilled.length).toBeGreaterThan(0);
  });

  it('scores an exact title match above an unrelated one', () => {
    const chapter = 'Income and commitments';
    const a = structure.sections.find((s) => s.title === 'Household Income')!;
    const b = structure.sections.find((s) => s.title === 'Fee Schedule')!;
    expect(scoreMatch(chapter, 1, 6, a, 7)).toBeGreaterThan(scoreMatch(chapter, 1, 6, b, 7));
  });

  it('re-reads a plan from the client without trusting its indices', () => {
    const tampered = {
      bindings: [
        { chapter: 'Income and commitments', sectionIndex: 999, confirmed: true },
        { chapter: 'How the capacity is built', sectionIndex: 1, confirmed: true },
        // The same section again — the second must be refused.
        { chapter: 'Audit trail', sectionIndex: 1, confirmed: true },
      ],
    };
    const read = readBindingPlan(tampered, 'borrowing-capacity', structure);
    const byChapter = new Map(read.bindings.map((b) => [b.chapter, b]));
    expect(byChapter.get('Income and commitments')!.sectionIndex).toBeNull();
    expect(byChapter.get('How the capacity is built')!.sectionIndex).toBe(1);
    expect(byChapter.get('Audit trail')!.sectionIndex).toBeNull();
  });

  it('names the formats it can bind to, and what they are called', () => {
    expect(bindableFormats()).toContain('borrowing-capacity');
    // The cover prints "Snapshot"; the archetype's metadata says "Assessment".
    // `converterChapters.spec.ts` holds this against the renderer's own const.
    expect(formatName('borrowing-capacity')).toBe('Borrowing Capacity Snapshot');
  });
});

describe('the converted document', () => {
  const structure = extractStructure(UPLOAD);
  const plan = proposeBinding('borrowing-capacity', structure);
  const palette = resolveReportPalette({ preset: 'signature', brandHex: '#1F4E79' });

  const render = () => renderConvertedDocument({
    structure,
    plan,
    palette,
    company: COMPANY,
    masthead: 'Harbour & Vale',
    systemName: 'Harbour Editorial',
    preparedOn: '2026-08-04T00:00:00.000Z',
  });

  it('prints the format\'s chapters in the format\'s order', () => {
    const chapters = planConvertedChapters(structure, plan);
    const formatChapters = FORMAT_CHAPTERS['borrowing-capacity'] ?? [];
    expect(chapters.slice(0, formatChapters.length).map((c) => c.title))
      .toEqual([...formatChapters]);
  });

  it('puts unmatched sections at the back rather than dropping them', () => {
    const chapters = planConvertedChapters(structure, plan);
    const appendix = chapters.filter((c) => c.kind === 'appendix');
    expect(appendix.length).toBe(plan.unbound.length);
    // And they are last.
    expect(chapters.slice(-appendix.length).every((c) => c.kind === 'appendix')).toBe(true);
  });

  it('says on the page that it is a draft, not a client document', () => {
    // A converted document has the same cover, typography and closing page as a
    // finished one. Without this somebody sends it to a client by accident.
    const html = render().html;
    expect(html).toContain('This is a converted draft, not a client document');
  });

  it('says which format it was bound to, by one name', () => {
    // One name, everywhere. The cover eyebrow and the running head used to
    // print the archetype's `documentName` ("Borrowing Capacity Assessment")
    // while the cover's own "Bound to" line printed the renderer's
    // ("Borrowing Capacity Snapshot") — one page, two names for one format.
    const html = render().html;
    expect(html).toContain('Borrowing Capacity Snapshot');
    expect(html).not.toContain('Borrowing Capacity Assessment');
  });

  it('prints an unfilled chapter rather than skipping it', () => {
    const sparse = extractStructure(`# T\n\n## Household Income\n\n${table}`);
    const p = proposeBinding('borrowing-capacity', sparse);
    const chapters = planConvertedChapters(sparse, p);
    expect(chapters.filter((c) => c.kind === 'unfilled').length).toBeGreaterThan(0);
  });

  it('warns when the upload had no headings', () => {
    const flat = extractStructure(prose(6));
    const p = proposeBinding('borrowing-capacity', flat);
    const html = renderConvertedDocument({
      structure: flat, plan: p, palette,
      company: COMPANY,
      masthead: 'X', systemName: 'S', preparedOn: '2026-08-04T00:00:00.000Z',
    }).html;
    expect(html).toContain('The upload had no headings');
  });

  it('produces a legal spine', () => {
    expect(render().problems).toEqual([]);
  });
});

describe('a converted document that was designed', () => {
  const structure = extractStructure(UPLOAD);
  const plan = proposeBinding('borrowing-capacity', structure);
  const palette = resolveReportPalette({ preset: 'signature', brandHex: '#1F4E79' });

  /** The blocks a design pass returns for the first bound chapter. */
  const blocks: EnrichedBlock[] = [
    {
      kind: 'kpi',
      cells: [
        { label: 'Assessment rate', value: '9.44%' },
        { label: 'Maximum loan', value: '$856,932' },
      ],
    },
    { kind: 'bullet', label: 'Proposed loan', value: 76, max: 100 },
  ];

  const renderWith = (enriched: Record<string, EnrichedBlock[]>) => renderConvertedDocument({
    structure, plan, palette,
    company: COMPANY,
    masthead: 'Harbour & Vale',
    systemName: 'Harbour Editorial',
    preparedOn: '2026-08-04T00:00:00.000Z',
    enriched,
  });

  it('prints the primitives instead of paragraph soup', () => {
    // The whole point. Before this, a KPI strip in the source arrived as a
    // three-column table and a progress bar arrived as `<p>Proposed loan 76%</p>`.
    const html = renderWith({ 'cv.1': blocks }).html;
    expect(html).toContain('class="kpi-strip"');
    expect(html).toContain('<svg');
  });

  it('counts what it designed, for the row and the screen', () => {
    const out = renderWith({ 'cv.1': blocks });
    expect(out.enrichedCount).toBe(1);
    expect(out.blockCounts).toEqual({ kpi: 1, bullet: 1 });
  });

  it('leaves every other chapter exactly as it was', () => {
    const plain = renderConvertedDocument({
      structure, plan, palette,
      company: COMPANY, masthead: 'Harbour & Vale', systemName: 'Harbour Editorial',
      preparedOn: '2026-08-04T00:00:00.000Z',
    });
    expect(plain.enrichedCount).toBe(0);
    expect(plain.blockCounts).toEqual({});
    // An enriched chapter changes; the rest of the document does not.
    expect(renderWith({}).html).toBe(plain.html);
  });

  it('budgets the pages it will print, not the ones it would have', () => {
    // A KPI strip is four lines where the table it replaced was nine. Costing
    // the Markdown and printing the blocks is how a spine claims a page count
    // the document does not have.
    const designed = planConvertedChapters(structure, plan, { 'cv.1': blocks });
    const flat = planConvertedChapters(structure, plan);
    const one = designed.find((c) => c.id === 'cv.1')!;
    const before = flat.find((c) => c.id === 'cv.1')!;
    expect(one.blocks).toHaveLength(2);
    expect(one.lines).not.toBe(before.lines);
    expect(one.lines).toBe(enrichedLines(blocks) + CHAPTER_FURNITURE_LINES);
  });

  it('ignores blocks for a chapter that is not in the document', () => {
    const out = renderWith({ 'cv.nonsense': blocks });
    expect(out.enrichedCount).toBe(0);
  });
});

describe('brand design systems', () => {
  it('reads a form submission and a model response the same way', () => {
    const fromForm = readBrandDesignSystem({
      name: 'Quiet Ink', options: { preset: 'minimal_ink', density: 'compact' },
    });
    // The model's natural shape puts the preset at the top level.
    const fromModel = readBrandDesignSystem({
      name: 'Quiet Ink', preset: 'minimal_ink', options: { density: 'compact' },
    });
    expect(fromForm.ok && fromModel.ok).toBe(true);
    expect(fromForm.ok && fromForm.system.options.preset).toBe('minimal_ink');
    expect(fromModel.ok && fromModel.system.options.preset).toBe('minimal_ink');
  });

  it('refuses a malformed brand colour rather than ignoring it', () => {
    // Falling back to the house brand would hand somebody a document in the
    // wrong colour with nothing to explain why.
    const r = readBrandDesignSystem({ name: 'Broken', brandHex: 'rebeccapurple' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/#RRGGBB/);
  });

  it('needs a name', () => {
    expect(readBrandDesignSystem({ name: '' }).ok).toBe(false);
    expect(readBrandDesignSystem(null).ok).toBe(false);
  });

  it('derives a slug from the name', () => {
    expect(slugify('Warm  Editorial!')).toBe('warm-editorial');
    const r = readBrandDesignSystem({ name: 'Warm Editorial' });
    expect(r.ok && r.system.slug).toBe('warm-editorial');
  });

  it('records whether a model wrote it', () => {
    const r = readBrandDesignSystem({ name: 'Drafted', origin: 'generated', brief: 'warm' });
    expect(r.ok && r.system.origin).toBe('generated');
  });

  it('makes a near-white accent legible instead of shipping it', () => {
    // A model asked for "warm sandstone" returns exactly this, and it is 1.6:1
    // on ivory. The value is a request for a hue, not a decision about
    // legibility: `accentOnPaper` is re-derived and the audit passes.
    const r = readBrandDesignSystem({ name: 'Sandstone', brandHex: '#FBF8F0' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const audit = auditBrandDesignSystem(r.system);
    expect(audit.ok).toBe(true);
    expect(audit.palette.accentOnPaper.toUpperCase()).not.toBe('#FBF8F0');
  });

  it('audits every preset it offers', () => {
    for (const preset of ['signature', 'editorial_navy', 'minimal_ink', 'high_contrast'] as const) {
      for (const brandHex of [null, '#1F4E79', '#B8873A', '#111111', '#FBF8F0']) {
        const r = readBrandDesignSystem({ name: 'Probe', brandHex, options: { preset } });
        expect(r.ok).toBe(true);
        if (!r.ok) continue;
        const audit = auditBrandDesignSystem(r.system);
        expect(audit.ok, `${preset} / ${brandHex}: ${describeAuditProblems(audit.problems)}`).toBe(true);
      }
    }
  });

  it('describes a failure in terms somebody can act on', () => {
    const described = describeAuditProblems([
      { role: 'accentOnPaper', ground: 'paperAlt', ratio: 1.62, floor: 3 },
    ]);
    expect(described).toContain('accentOnPaper');
    expect(described).toContain('1.62');
  });
});
