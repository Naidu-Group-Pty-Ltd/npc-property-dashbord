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
import { planConvertedChapters, renderConvertedDocument } from '../render.pure';
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
});

describe('binding to a report format', () => {
  const structure = extractStructure(UPLOAD);
  const plan = proposeBinding('borrowing-capacity', structure);

  it('offers one binding per chapter of the format', () => {
    expect(plan.bindings.map((b) => b.chapter))
      .toEqual([...(FORMAT_CHAPTERS['borrowing-capacity'] ?? [])]);
  });

  it('matches the obvious sections with high confidence', () => {
    const byChapter = new Map(plan.bindings.map((b) => [b.chapter, b]));
    for (const chapter of ['Position Summary', 'Income', 'Commitments', 'Capacity & Scenarios']) {
      const b = byChapter.get(chapter)!;
      expect(b.sectionIndex, chapter).not.toBeNull();
      expect(b.confidence, chapter).toBeGreaterThanOrEqual(WEAK_MATCH);
    }
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
    // is the shape that actually exercises it: "Income and Commitments" scores
    // highest for the Income chapter *and* for the Commitments chapter.
    const merged = extractStructure(
      `# T\n\n## Income and Commitments\n\n${table}\n\n## Something Else Entirely\n\n${prose()}`,
    );
    const p = proposeBinding('borrowing-capacity', merged);
    const byChapter = new Map(p.bindings.map((b) => [b.chapter, b]));
    const income = byChapter.get('Income')!.sectionIndex;
    const commitments = byChapter.get('Commitments')!.sectionIndex;

    // Exactly one of them gets it; the other is left unfilled rather than
    // printing the same table under two headings.
    expect([income, commitments].filter((i) => i !== null).length).toBe(1);
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
    const a = structure.sections.find((s) => s.title === 'Household Income')!;
    const b = structure.sections.find((s) => s.title === 'Fee Schedule')!;
    expect(scoreMatch('Income', 1, 7, a, 7)).toBeGreaterThan(scoreMatch('Income', 1, 7, b, 7));
  });

  it('re-reads a plan from the client without trusting its indices', () => {
    const tampered = {
      bindings: [
        { chapter: 'Income', sectionIndex: 999, confirmed: true },
        { chapter: 'Commitments', sectionIndex: 1, confirmed: true },
        // The same section again — the second must be refused.
        { chapter: 'Serviceability', sectionIndex: 1, confirmed: true },
      ],
    };
    const read = readBindingPlan(tampered, 'borrowing-capacity', structure);
    const byChapter = new Map(read.bindings.map((b) => [b.chapter, b]));
    expect(byChapter.get('Income')!.sectionIndex).toBeNull();
    expect(byChapter.get('Commitments')!.sectionIndex).toBe(1);
    expect(byChapter.get('Serviceability')!.sectionIndex).toBeNull();
  });

  it('names the formats it can bind to, and what they are called', () => {
    expect(bindableFormats()).toContain('borrowing-capacity');
    expect(formatName('borrowing-capacity')).toBe('Borrowing Capacity Assessment');
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

  it('says which format it was bound to', () => {
    expect(render().html).toContain('Borrowing Capacity Assessment');
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
