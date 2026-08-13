/**
 * Report Q&A is **not** drawn by the Investment Compass families, and this is
 * the file that keeps it that way.
 *
 * Seven formats have been migrated onto the family system and an eighth is the
 * obvious next step. It cannot be, for a reason that is about the renderer
 * rather than about the record — and a reason that is invisible until someone
 * builds fifty masters and renders one against a real answer.
 *
 * ## The record is rich; the block vocabulary cannot draw it
 *
 * Measured across all 565 stored answers:
 *
 * | | |
 * | --- | --- |
 * | carry inline bold | **394 (70%)** |
 * | carry a pipe table | **130 (23%)** |
 * | carry a bullet list | 321 (57%) |
 * | carry an ATX heading | 270 (48%) |
 *
 * The template block vocabulary has **no Markdown renderer and no block that
 * accepts HTML**. `text-block` escapes its body, which is right — it is the
 * reason a model-authored string cannot inject markup into a client's document.
 * The consequence is that an answer bound to one prints its own source:
 * `## Yield analysis`, `**gross yield**` and `| Metric | Value |` all set as
 * body copy. The first test below renders exactly that and shows it.
 *
 * The archetype route has `_shared/reports/reportQa/markdown.pure.ts` for this,
 * built for the migration `docs/reports/QA.md` describes. There is no
 * equivalent on the Template Builder side, and adding a raw-HTML block would
 * put a hole in `PRODUCTION_SAFE_BLOCK_TYPES` — a security allow-list — for
 * content a language model wrote.
 *
 * ## And the structure is discovered at render time, against build-time heights
 *
 * A family master declares every block's height when the template is built.
 * This format's payload does not have a shape until it is read:
 *
 * | | p50 | p90 | max |
 * | --- | --- | --- | --- |
 * | answer, characters | 2,188 | 10,574 | **33,359** |
 * | conversation, characters | 1,428 | 21,748 | **354,406** |
 * | sections discovered in an answer | 1 | 16 | **63** |
 *
 * 33,359 characters is about eight pages of set prose and 354,406 is about
 * eighty. Half of all answers carry no heading at all and one carries 63. There
 * is no `textHeight(chars)` for a field whose length spans two orders of
 * magnitude, and no fixed page sequence for a spine that is discovered.
 *
 * ## What would have to change
 *
 * Both, not either:
 *
 *  1. A Markdown-capable block in `PRODUCTION_SAFE_BLOCK_TYPES` — which is a
 *     sanitiser decision before it is a rendering one.
 *  2. A way for a master to size or flow a block whose content it has not seen.
 *
 * Until then the flowing route (`render-report-qa-pdf`) is the renderer for
 * this format, and it is a better document than fifty fixed-layout masters
 * could be. `qa` therefore stays preview-only in the adapter registry — not
 * because nobody has written the adapter, but because the templates it would
 * serve cannot draw the payload.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { supportsProduction, getAdapter } from '@/lib/reportTemplate/adapters';
import { PRODUCTION_REPORT_TEMPLATE_TYPES } from '../../../../supabase/functions/_shared/productionBlockTypes';

const ROOT = resolve(__dirname, '../../../..');

/** One assistant answer, in the shape 70% of the corpus is written in. */
const ANSWER = [
  '## Yield analysis',
  '',
  'The **gross yield** is 3.71% on the purchase price, and the *net* yield is 2.44%.',
  '',
  '| Metric | Value |',
  '| --- | --- |',
  '| Gross yield | 3.71% |',
  '| Net yield | 2.44% |',
  '',
  '- Land-led inner-west holding',
  '- Below the suburb median',
].join('\n');

function textBlockSchema() {
  return {
    version: 1 as const,
    name: 'Answer',
    tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: [{
      id: 'p1',
      name: 'Answer',
      size: { width: 595, height: 842 },
      background: { color: '#ffffff' },
      blocks: [{
        id: 'b1',
        type: 'text-block',
        props: { body: '{{qa.answer}}', x: 40, y: 40, width: 515 },
        overlays: [],
      }],
    }],
  };
}

describe('the block vocabulary cannot draw a Q&A answer', () => {
  it('prints Markdown as its own source', () => {
    // Not a hypothetical. This is what a family master bound to an answer
    // would put on a client's page.
    const { html } = renderTemplateToHtml(textBlockSchema() as any, { data: { qa: { answer: ANSWER } } });

    expect(html).toContain('## Yield analysis');
    expect(html).toContain('**gross yield**');
    expect(html).toContain('| Gross yield | 3.71% |');

    // And none of it became structure.
    expect(html).not.toContain('<h2 style="color:#1A1A1A">Yield analysis');
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('<table');
  });

  it('escapes rather than interprets, which is why it cannot be worked around', () => {
    // Handing it HTML instead of Markdown does not help, and must not: the body
    // is model-authored, and a block that interpreted it would be an injection
    // surface on a document a client receives.
    const { html } = renderTemplateToHtml(textBlockSchema() as any, {
      data: { qa: { answer: '<strong>bold</strong><script>alert(1)</script>' } },
    });
    expect(html).toContain('&lt;strong&gt;');
    expect(html).not.toContain('<script>');
  });

  it('has no production-safe block that would let markup through', () => {
    // Behavioural rather than textual. A first draft of this grepped the
    // renderers for `${resolveBindable(...)}` outside an `esc()` and reported
    // `ddChecklist.html.ts` — which escapes the *joined* string one line later,
    // so the grep was wrong and the block was fine. Rendering answers the
    // question the grep was trying to ask, and cannot be fooled by where the
    // escaping happens to sit.
    //
    // These are the blocks a Q&A format would reach for to set prose. If a
    // future block does interpret markup, it has to be added here deliberately.
    const HOSTILE = '<strong>bold</strong><script>alert(1)</script>';
    const cases: Array<{ type: string; props: Record<string, unknown> }> = [
      { type: 'text-block', props: { heading: '{{x}}', body: '{{x}}' } },
      { type: 'callout', props: { title: '{{x}}', body: '{{x}}' } },
      { type: 'definition-list', props: { title: '{{x}}', items: [{ term: '{{x}}', definition: '{{x}}' }] } },
      { type: 'two-column', props: { leftHeading: '{{x}}', leftBody: '{{x}}', rightHeading: '{{x}}', rightBody: '{{x}}' } },
      { type: 'data-table', props: { headers: ['{{x}}'], rows: [{ cells: ['{{x}}'] }] } },
      { type: 'hero', props: { title: '{{x}}', subtitle: '{{x}}', eyebrow: '{{x}}' } },
      { type: 'dd-checklist', props: { title: '{{x}}', items: [{ action: '{{x}}', owner: '{{x}}', timing: '{{x}}' }] } },
    ];

    for (const { type, props } of cases) {
      const schema = {
        version: 1 as const,
        name: type,
        tokens: { colors: {}, fonts: {}, spacing: {} },
        pages: [{
          id: 'p1', name: 'P', size: { width: 595, height: 842 },
          background: { color: '#ffffff' },
          blocks: [{ id: 'b1', type, props: { ...props, x: 40, y: 40, width: 515 }, overlays: [] }],
        }],
      };
      const { html } = renderTemplateToHtml(schema as any, { data: { x: HOSTILE } });
      expect(html, `${type} let a script tag through`).not.toContain('<script>');
      expect(html, `${type} let markup through`).not.toContain('<strong>bold</strong>');
      expect(html, `${type} did not render the binding at all`).toContain('&lt;');
    }
  });
});

describe('so the format stays where it can be drawn', () => {
  it('is not a production report-template type', () => {
    expect(PRODUCTION_REPORT_TEMPLATE_TYPES.has('qa')).toBe(false);
    expect(PRODUCTION_REPORT_TEMPLATE_TYPES.has('report_qa')).toBe(false);
    expect(supportsProduction('qa')).toBe(false);
  });

  it('is still in the registry, so the library card says preview-only rather than unknown', () => {
    expect(getAdapter('qa')).toBeTruthy();
    expect(getAdapter('qa')?.legacyFallback?.reason).toBeTruthy();
  });

  it('has no family catalogue', () => {
    // Adding a Q&A composer beside the seven is the change this file exists to
    // stop. If you are here because this failed: read the header, and check
    // that a Markdown-capable block exists before deleting it.
    //
    // Matched on the `ReportFormat` a composer declares rather than on a
    // filename — `investmentCompass/qa.ts` is the render QA harness, and the
    // name collision is exactly the kind of thing a filename check gets wrong.
    const dir = resolve(ROOT, 'scripts/template-library/investmentCompass');
    const declaring: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(resolve(dir, file), 'utf8');
      if (/reportType:\s*'(qa|report_qa)'/.test(source)) declaring.push(file);
    }
    expect(declaring).toEqual([]);
  });

  it('names the flowing route that does draw it', () => {
    // The alternative is not "nothing" — it is a better document than fifty
    // fixed-layout masters could be.
    const contract = readFileSync(resolve(ROOT, 'docs/reports/QA.md'), 'utf8');
    expect(contract).toContain('render-report-qa-pdf');
    expect(contract).toContain('markdown.pure.ts');
  });
});
