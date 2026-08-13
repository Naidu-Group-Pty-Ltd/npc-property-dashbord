/**
 * Report Q&A **is** on the design families, and these are the conditions under
 * which that is allowed to stay true.
 *
 * This file replaces `reportQaNotOnTheFamilies.spec.ts`, which enforced the
 * opposite. That spec was correct about the vocabulary it was written against:
 * no block rendered Markdown, and 70% of the 565 stored answers carry inline
 * bold, 48% a heading, 56% a list and 19% a pipe table — so an answer bound to
 * a `text-block` printed its own source on a client's page.
 *
 * It named two things that would have to change, and both did:
 *
 *  1. a Markdown-capable block in `PRODUCTION_SAFE_BLOCK_TYPES` — which it
 *     rightly called a sanitiser decision before a rendering one;
 *  2. a way for a master to size a block whose content it has not seen.
 *
 * The first is `markdown-block`, which takes Markdown *source* and renders it
 * through the programme's escape-first renderer — so it cannot emit markup the
 * model chose, whatever is bound to it. The second is conditional pages sized
 * from `packMarkdownPages`, the same function the block uses.
 *
 * What follows guards the parts that could quietly regress.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { supportsProduction, getAdapter } from '@/lib/reportTemplate/adapters';
import { PRODUCTION_REPORT_TEMPLATE_TYPES, PRODUCTION_SAFE_BLOCK_TYPES }
  from '../../../../supabase/functions/_shared/productionBlockTypes';
import { DEFAULT_LINES_PER_PAGE }
  from '../../../../supabase/functions/_shared/reports/markdownPaging.pure';
import { REPORT_QA_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/reportQa';
import { MARKDOWN_LINES_PER_PAGE }
  from '../../../../scripts/template-library/investmentCompass/blocks';

const ROOT = resolve(__dirname, '../../../..');

describe('the format is production-ready rather than preview-only', () => {
  it('is a production report-template type', () => {
    expect(PRODUCTION_REPORT_TEMPLATE_TYPES.has('qa')).toBe(true);
    expect(supportsProduction('qa')).toBe(true);
  });

  it('has an adapter that names the flowing route rather than replacing it', () => {
    const adapter = getAdapter('qa');
    expect(adapter?.supportsProduction).toBe(true);
    // A template is a fixed page sequence. It carries one exchange well; it is
    // not a transcript of 70 turns, and the registry must keep saying so.
    expect(adapter?.legacyFallback?.route).toBe('render-report-qa-pdf');
    expect(adapter?.legacyFallback?.reason).toMatch(/transcript/i);
  });

  it('contributes fifty masters', () => {
    expect(REPORT_QA_TEMPLATES).toHaveLength(50);
    expect(new Set(REPORT_QA_TEMPLATES.map((t) => t.slug)).size).toBe(50);
  });
});

describe('the block is the only thing that makes this safe', () => {
  it('markdown-block is on the production allow-list and no raw-HTML block is', () => {
    expect(PRODUCTION_SAFE_BLOCK_TYPES.has('markdown-block')).toBe(true);
    for (const forbidden of ['html', 'html-block', 'raw-html', 'unsafe-html']) {
      expect(PRODUCTION_SAFE_BLOCK_TYPES.has(forbidden), `${forbidden} must not be allowed`)
        .toBe(false);
    }
  });

  it('a text-block still escapes, so nothing has been loosened to make this work', () => {
    // The original spec's central assertion, kept. The fix was to add a block
    // that renders safely — not to relax the block that escapes.
    const schema = {
      version: 1 as const,
      name: 'x',
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [{
        id: 'p1', name: 'P', size: { width: 595, height: 842 },
        background: { color: '#ffffff' },
        blocks: [{
          id: 'b1', type: 'text-block',
          props: { body: '{{x}}', x: 40, y: 40, width: 515 }, overlays: [],
        }],
      }],
    };
    const { html } = renderTemplateToHtml(schema as any, {
      data: { x: '<strong>b</strong><script>alert(1)</script>' },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;strong&gt;');
  });
});

describe('the masters and the projection must agree about page count', () => {
  it('the composer uses the same lines-per-page as the paging module', () => {
    // A master makes answer page N conditional on `qa.answerPages > N` while the
    // block decides what page N holds. If these two numbers drifted, a document
    // would print a blank page or lose the end of an answer — and neither shows
    // up in any other test.
    expect(MARKDOWN_LINES_PER_PAGE).toBe(DEFAULT_LINES_PER_PAGE);
  });

  it('every answer page is conditional on the projection having that page', () => {
    const master = REPORT_QA_TEMPLATES[0];
    const answerPages = master.schema.pages.filter((p: any) => /^The answer/.test(p.name));
    expect(answerPages.length).toBeGreaterThan(1);

    // The first is conditional on there being an answer at all; the rest on the
    // count. None may be unconditional, or a short answer prints blank pages.
    for (const p of answerPages as any[]) {
      expect(p.conditional, `page "${p.name}" is unconditional`).toBeTruthy();
    }
    const continuations = (answerPages as any[]).slice(1);
    for (const [i, p] of continuations.entries()) {
      expect(p.conditional).toBe(`qa && qa.answerPages > ${i + 1}`);
    }
  });

  it('binds the answer as source to a markdown-block, never to a text-block', () => {
    for (const master of REPORT_QA_TEMPLATES) {
      for (const page of master.schema.pages as any[]) {
        for (const block of page.blocks as any[]) {
          const props = JSON.stringify(block.props ?? {});
          if (props.includes('{{qa.answer}}')) {
            expect(block.type, `${master.slug} bound the answer to a ${block.type}`)
              .toBe('markdown-block');
          }
        }
      }
    }
  });
});

describe('the contract still names the flowing route', () => {
  it('QA.md documents both renderers', () => {
    const contract = readFileSync(resolve(ROOT, 'docs/reports/QA.md'), 'utf8');
    expect(contract).toContain('render-report-qa-pdf');
    expect(contract).toContain('markdown.pure.ts');
  });

  it('exactly one composer declares this report type', () => {
    const dir = resolve(ROOT, 'scripts/template-library/investmentCompass');
    const declaring = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /reportType:\s*'qa'/.test(readFileSync(resolve(dir, f), 'utf8')));
    expect(declaring).toEqual(['reportQa.ts']);
  });
});
