/**
 * A bracket at the end of a sentence refers to nothing a reader can open.
 *
 * `rewriteScaffoldingPointers` already held this rule for the four strings the
 * generator's own pinned block writes. Page 29 of the Investment Compass
 * delivered for 9 Hollow Street, Golden Square on 21 Sep 2026 closes all three
 * paragraphs of its **Final Recommendation** — the most-read section in the
 * document — with brackets that are none of the four. Every fixture below is
 * verbatim from that page.
 */
import { describe, expect, it } from 'vitest';
import {
  PLANNING_REGISTER_SECTION,
  rewriteScaffoldingPointers,
} from '../investment/derivedHygiene.pure';

const P1 = 'Proceed only if your investment case tolerates desktop-only planning certainty: this report '
  + 'confirms the property sits in the GRZ — General Residential Zone at 9 Hollow Street, but the retrieved '
  + 'controls do not publish minimum lot size, building height, floor space ratio, or the land use table, so '
  + 'the planning outcome remains settled only by the planning certificate and the planning scheme itself. '
  + '[Vicmap Planning — plan_zone][Vicmap Planning — plan_overlay]';

const P2 = 'Infrastructure and major-project registers returned nothing for this location in the registers '
  + 'this platform reads, and that is a statement about coverage rather than a finding that nothing is '
  + 'planned nearby, no project, corridor, or delivery horizon should be inferred from that absence. '
  + '[Planning registers in this report][Major public projects register in this report]';

const P3 = 'On the evidence retrieved here, the clearest recommendation is conditional buy interest, not an '
  + 'unconditional go-ahead: the zoning reading is permissive only in the broad residential sense, but the '
  + 'property still needs the formal certificate-based verification before any development thesis, '
  + 'subdivision thesis, or density thesis is treated as supportable. '
  + '[Vicmap Planning — plan_zone][Planning and certificate verification notes in this report]';

const PAGE_29 = ['## Final Recommendation', '', P1, '', P2, '', P3].join('\n');

describe('the six brackets that closed the Final Recommendation', () => {
  const out = () => rewriteScaffoldingPointers(PAGE_29);

  it('counts every one of them', () => {
    expect(out().rewritten).toBe(6);
  });

  it('leaves no bracket on the page', () => {
    expect(out().markdown).not.toMatch(/\[[^\]\n]*\]/);
  });

  it('names the section once, inside the sentence it sources', () => {
    const md = out().markdown;
    const refs = md.match(new RegExp(`\\(see \\*${PLANNING_REGISTER_SECTION}\\*\\)`, 'g')) ?? [];
    // Three identical parentheticals in three consecutive paragraphs is worse
    // than one: the first sources the section and the rest are removed.
    expect(refs).toHaveLength(1);
    // …and it sits inside the sentence rather than standing as a fragment
    // after the full stop.
    expect(md).toContain('the planning scheme itself (see *' + PLANNING_REGISTER_SECTION + '*).');
    expect(md).not.toContain('itself. (see');
  });

  it('keeps every word of the prose', () => {
    const md = out().markdown;
    for (const claim of [
      'desktop-only planning certainty',
      'General Residential Zone at 9 Hollow Street',
      'a statement about coverage rather than a finding',
      'conditional buy interest, not an',
    ]) expect(md).toContain(claim);
  });

  it('names the section again in a later section', () => {
    // The allowance is per section, because a reader who has turned the page
    // has lost the reference.
    const doc = `${PAGE_29}\n\n## Appendix\n\nSourced elsewhere. [Vicmap Planning — plan_zone]`;
    const md = rewriteScaffoldingPointers(doc).markdown;
    const refs = md.match(new RegExp(`\\(see \\*${PLANNING_REGISTER_SECTION}\\*\\)`, 'g')) ?? [];
    expect(refs).toHaveLength(2);
  });
});

describe('the four forms that must survive untouched', () => {
  const unchanged = (s: string) => expect(rewriteScaffoldingPointers(s).markdown).toBe(s);

  it('a Markdown link', () => {
    unchanged('See the [ABS release](https://abs.gov.au/x) for the series.');
  });

  it('a footnote marker and its definition', () => {
    unchanged('The note explains it.[^12] And a definition follows.');
    unchanged('[^12]: Australian Bureau of Statistics, Building Approvals.');
  });

  it('a bare numeric marker, which footnoteDebris owns', () => {
    unchanged('Median prices rose.[12] Rents did not.');
  });

  it('an aside inside a sentence', () => {
    unchanged('The zone is residential [see the certificate] before contract.');
  });

  it('a table, and prose with no bracket at all', () => {
    unchanged('| Control | Reading |\n| --- | --- |\n| Zone | GRZ |');
    unchanged('A sentence with no bracket at all.');
  });

  it('a colon, which introduces what follows it', () => {
    unchanged('The checks were these: [heritage] [flood] [bushfire]');
  });
});

describe('the four literals it already held', () => {
  it('still rewrites them', () => {
    const r = rewriteScaffoldingPointers('The zone is permissive [Zoning & Planning table] on this lot.');
    expect(r.rewritten).toBeGreaterThan(0);
    expect(r.markdown).toContain(PLANNING_REGISTER_SECTION);
    expect(r.markdown).not.toContain('[Zoning & Planning table]');
  });
});

describe('the read path carries it', () => {
  it('presentStoredMarkdown leaves no pointer on the page', async () => {
    const { presentStoredMarkdown } = await import('../investment/derivedHygiene.pure');
    const md = presentStoredMarkdown(PAGE_29);
    expect(md).not.toMatch(/\[Vicmap Planning/);
    expect(md).not.toMatch(/\[Planning registers in this report\]/);
    expect(md).toContain(PLANNING_REGISTER_SECTION);
  });
});
