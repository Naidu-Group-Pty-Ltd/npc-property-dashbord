/**
 * What a Report Q&A template may bind.
 *
 * The assertions that matter most here are the two this format is unusual for:
 * the answer is published as **Markdown source** rather than formatted text,
 * and the page count the projection publishes must equal the page count the
 * block will actually draw. A drift of one between them prints a blank page or
 * loses the end of an answer.
 */
import { describe, it, expect } from 'vitest';
import {
  projectReportQa, applyReportQaProjection, answerPageCount, CAPS,
} from '../../../../supabase/functions/_shared/reportQaProjection.pure';
import { packMarkdownPages } from '../../../../supabase/functions/_shared/reports/markdownPaging.pure';
import { renderMarkdown } from '../../../../supabase/functions/_shared/reports/markdown.pure';

const ANSWER = [
  '## Yield analysis',
  '',
  'The **gross yield** is 3.71%, and the *net* yield is 2.44%.',
  '',
  '| Metric | Value |',
  '| --- | --- |',
  '| Gross yield | 3.71% |',
].join('\n');

function turn(i: number, over: Record<string, unknown> = {}) {
  return {
    index: i,
    question: `Question ${i}`,
    askedAt: '2026-08-01T00:00:00.000Z',
    answer: ANSWER,
    answerWasEdited: false,
    modelProvider: 'openai',
    modelVersion: 'gpt-5',
    citations: [],
    ...over,
  } as any;
}

function doc(over: Record<string, unknown> = {}) {
  const meta = {
    conversationId: 'c1',
    messageId: null,
    subject: 'transcript',
    title: 'Yield questions',
    preparedOn: '2026-08-13T00:00:00.000Z',
    turnCount: 2,
    turnsShown: 2,
    truncated: false,
    charsOmitted: 0,
    ...(over.meta as object ?? {}),
  };
  return {
    meta,
    grounding: { reportNames: ['12 Marlborough St.pdf'], reportCount: 1 },
    turns: [turn(1), turn(2)],
    ...over,
    meta,
  } as any;
}

describe('the answer stays Markdown', () => {
  it('publishes source, not formatted text or HTML', () => {
    const { qa } = projectReportQa(doc());
    expect(qa.answer).toContain('**gross yield**');
    expect(qa.answer).toContain('| Metric | Value |');
    // Pre-rendering here would move the escaping decision to the caller.
    expect(String(qa.answer)).not.toContain('<strong>');
    expect(String(qa.answer)).not.toContain('<table');
  });
});

describe('page counts agree with the block', () => {
  it('answerPageCount equals what packMarkdownPages will produce', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Para ${i}. ${'word '.repeat(30)}`).join('\n\n');
    for (const lpp of [12, 34, 80]) {
      const expected = packMarkdownPages(renderMarkdown(long).blocks, lpp).length;
      expect(answerPageCount(long, lpp)).toBe(expected);
    }
  });

  it('is absent rather than zero for an empty answer', () => {
    const { qa } = projectReportQa(doc({ turns: [turn(1, { answer: '' })] }));
    expect(qa.answerPages).toBeUndefined();
    expect(qa.answer).toBeUndefined();
  });
});

describe('absent means absent', () => {
  it('never publishes an empty string', () => {
    const { qa } = projectReportQa(doc({
      grounding: { reportNames: [], reportCount: 0 },
      turns: [turn(1, { modelProvider: '', modelVersion: '' })],
    }));
    const walk = (v: unknown): void => {
      if (v === '' || v === null) throw new Error('published an empty value');
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    expect(() => walk(qa)).not.toThrow();
    expect(qa.sources).toBeUndefined();
    expect((qa.turns as any[])[0].model).toBeUndefined();
  });

  it('says nothing about editing when nothing was edited', () => {
    const clean = projectReportQa(doc()).qa;
    expect((clean.turns as any[])[0].editedNote).toBeUndefined();

    const edited = projectReportQa(doc({ turns: [turn(1, { answerWasEdited: true })] })).qa;
    expect((edited.turns as any[])[0].editedNote).toContain('edited');
  });
});

describe('omissions are whole sentences or nothing', () => {
  it('publishes no note when the document is complete', () => {
    const { qa } = projectReportQa(doc());
    expect(qa.omissionNote).toBeUndefined();
    expect(qa.truncationNote).toBeUndefined();
  });

  it('names how many exchanges are missing', () => {
    const { qa } = projectReportQa(doc({ meta: { turnCount: 9, turnsShown: 2 } }));
    expect(qa.omissionNote).toBe(
      'This document carries 2 of 9 exchanges; 7 are not shown.',
    );
  });

  it('uses singular for one', () => {
    const { qa } = projectReportQa(doc({ meta: { turnCount: 3, turnsShown: 2 } }));
    expect(qa.omissionNote).toContain('1 is not shown');
  });

  it('reports characters cut by the transcript budget', () => {
    const { qa } = projectReportQa(doc({
      meta: { turnCount: 2, turnsShown: 2, truncated: true, charsOmitted: 12345 },
    }));
    expect(qa.truncationNote).toContain('12,345 characters');
  });
});

describe('collections are capped, because the page model cannot paginate', () => {
  it('caps turns and says how many there were', () => {
    const many = Array.from({ length: 30 }, (_, i) => turn(i + 1));
    const { qa } = projectReportQa(doc({ turns: many, meta: { turnCount: 30, turnsShown: 30 } }));
    expect((qa.turns as any[]).length).toBe(CAPS.turns);
    expect(qa.omissionNote).toContain('30 exchanges');
  });

  it('caps citations and names the remainder', () => {
    const citations = Array.from({ length: 10 }, (_, i) => ({
      documentName: `Doc ${i}.pdf`, page: i, paragraph: null, snippet: 's', similarity: null,
    }));
    const { qa } = projectReportQa(doc({ turns: [turn(1, { citations })] }));
    const t = (qa.turns as any[])[0];
    expect(t.citations.length).toBe(CAPS.citationsPerTurn);
    expect(t.citationCount).toBe(10);
    expect(t.citationsOmitted).toContain('4 more sources');
  });

  it('formats a citation locus from page and paragraph', () => {
    const { qa } = projectReportQa(doc({
      turns: [turn(1, {
        citations: [{ documentName: 'a.pdf', page: 4, paragraph: 12, snippet: 's', similarity: null }],
      })],
    }));
    expect((qa.turns as any[])[0].citations[0].locus).toBe('p.4 ¶12');
  });
});

describe('applyReportQaProjection', () => {
  it('writes nothing when there is nothing to write', () => {
    const target: Record<string, unknown> = {};
    applyReportQaProjection(target, doc({
      meta: { title: '', preparedOn: '', turnCount: 0, turnsShown: 0 },
      grounding: { reportNames: [], reportCount: 0 },
      turns: [],
    }));
    expect(target.qa).toBeUndefined();
  });
});
