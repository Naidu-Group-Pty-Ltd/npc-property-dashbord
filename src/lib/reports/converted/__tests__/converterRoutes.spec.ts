/**
 * The converter's two routes, as contracts.
 *
 * The edge functions themselves do auth, a model call, a WeasyPrint render, an
 * upload and four writes — none of which a unit test can reach. What *is*
 * reachable is everything they decide before any of that: what a caller may
 * send, where the file lands, what the model is asked for, and what the reader
 * refuses.
 *
 * Each assertion below is here because breaking the thing it guards produces a
 * failure that is either silent or expensive:
 *
 * - a format the converter cannot bind to renders a document with no chapters
 *   and no explanation;
 * - a source suffix nobody checked reaches a model as base64 of a `.docx`;
 * - the *public* `report-templates` bucket puts somebody's uploaded template
 *   behind a guessable URL;
 * - an extraction prompt that stops insisting on ATX headings produces
 *   beautiful prose and a one-section document every time.
 */
/* eslint-disable no-restricted-syntax --
 * Fixture brand colours. A design system's accent is document data, and these
 * are the values a request carries — not palette choices in a component.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  base64Bytes,
  convertedFileName,
  convertedReference,
  convertedStoragePath,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  MAX_SOURCE_BYTES,
  parseConvertRequest,
  pdfExtractionPrompt,
  sourceKindFor,
  STORAGE_BUCKET,
  TEXT_SUFFIXES,
} from '../route.pure';
import { bindableFormats, proposeBinding } from '../binding.pure';
import { extractStructure } from '../structure.pure';
import { planConvertedChapters, renderConvertedDocument } from '../render.pure';
import { extractJsonObject, MIN_BRIEF_CHARS, parseBrandRequest } from '../../../brandDesign/route.pure';
import { REPORT_ARCHETYPES } from '../../../reportDesign/structure.pure';
import { resolveReportPalette } from '../../../../../supabase/functions/_shared/reportDesign/brandResolve.pure';
import { resolveCompanyBlock } from '../../../../../supabase/functions/_shared/reportDesign/companyBlock.pure';

const FORMAT = bindableFormats()[0];
const UUID = '4b1d9e3a-6c2f-4a8b-9d1e-2f3a4b5c6d7e';

/** A base64 payload of a given decoded size, without actually allocating a file. */
const base64OfBytes = (bytes: number) => 'A'.repeat(Math.ceil(bytes / 3) * 4);

describe('parseConvertRequest', () => {
  it('refuses a format the converter has no chapters for', () => {
    // `bindableFormats()` is the list; an archetype outside it has no entry in
    // `FORMAT_CHAPTERS`, so binding to it produces a spine with zero chapters.
    const parsed = parseConvertRequest({ action: 'extract', format: 'investment-compass' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(FORMAT);
  });

  it('refuses a source whose suffix it cannot read', () => {
    const parsed = parseConvertRequest({
      action: 'extract',
      format: FORMAT,
      fileName: 'Template.docx',
      sourceBase64: 'QQ==',
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain('Template.docx');
  });

  it('accepts every text suffix it advertises, and pdf', () => {
    for (const suffix of [...TEXT_SUFFIXES, '.pdf']) {
      const parsed = parseConvertRequest({
        action: 'extract',
        format: FORMAT,
        fileName: `Template${suffix}`,
        sourceBase64: 'QQ==',
      });
      expect(parsed.ok, suffix).toBe(true);
      if (parsed.ok && parsed.request.action === 'extract') {
        expect(parsed.request.kind).toBe(suffix === '.pdf' ? 'pdf' : 'text');
      }
    }
  });

  it('refuses an upload over the ceiling, and accepts one just under it', () => {
    const over = parseConvertRequest({
      action: 'extract',
      format: FORMAT,
      fileName: 'Template.pdf',
      sourceBase64: base64OfBytes(MAX_SOURCE_BYTES + 4_096),
    });
    expect(over.ok).toBe(false);

    const under = parseConvertRequest({
      action: 'extract',
      format: FORMAT,
      fileName: 'Template.pdf',
      sourceBase64: base64OfBytes(MAX_SOURCE_BYTES - 4_096),
    });
    expect(under.ok).toBe(true);
  });

  it('refuses an empty upload rather than sending nothing to a model', () => {
    const parsed = parseConvertRequest({
      action: 'extract',
      format: FORMAT,
      fileName: 'Template.pdf',
      sourceBase64: '',
    });
    expect(parsed.ok).toBe(false);
  });

  it('requires a uuid for propose and render', () => {
    for (const action of ['propose', 'render']) {
      const parsed = parseConvertRequest({ action, format: FORMAT, conversionId: 'not-a-uuid' });
      expect(parsed.ok, action).toBe(false);
    }
  });

  it('refuses a malformed designSystemId rather than silently rendering the house design', () => {
    // Silently falling back would set somebody's draft in a design they did not
    // choose, with nothing on the page to say so.
    const parsed = parseConvertRequest({
      action: 'render',
      format: FORMAT,
      conversionId: UUID,
      designSystemId: 'nope',
    });
    expect(parsed.ok).toBe(false);
  });

  it('treats an absent designSystemId as the house design', () => {
    const parsed = parseConvertRequest({ action: 'render', format: FORMAT, conversionId: UUID });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.request.action === 'render') {
      expect(parsed.request.designSystemId).toBeNull();
    }
  });

  it('names the actions it knows when given one it does not', () => {
    const parsed = parseConvertRequest({ action: 'convert', format: FORMAT });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain('extract');
      expect(parsed.error).toContain('propose');
      expect(parsed.error).toContain('render');
      expect(parsed.error).toContain('list');
      expect(parsed.error).toContain('chapters');
    }
  });
});

describe('the actions that name no format', () => {
  // The regression guard for an ordering decision that is easy to undo by
  // accident. `parseConvertRequest` validates `format` for every other action
  // *before* it looks at which action was asked for, so `list` and `chapters`
  // have to be handled above that check. Move either branch below it and the
  // request is refused with an error about report formats, which has nothing to
  // do with what was asked — and the history panel silently shows nothing.
  it('accepts a listing with no format at all', () => {
    const parsed = parseConvertRequest({ action: 'list' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.request.action).toBe('list');
  });

  it('accepts a chapters request with no format, given a uuid', () => {
    const parsed = parseConvertRequest({ action: 'chapters', conversionId: UUID });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.request.action === 'chapters') {
      expect(parsed.request.conversionId).toBe(UUID);
    }
  });

  it('still requires a uuid for chapters', () => {
    expect(parseConvertRequest({ action: 'chapters', conversionId: 'nope' }).ok).toBe(false);
  });

  it('clamps the listing limit and defaults it', () => {
    const def = parseConvertRequest({ action: 'list' });
    expect(def.ok && def.request.action === 'list' && def.request.limit).toBe(DEFAULT_LIST_LIMIT);

    const huge = parseConvertRequest({ action: 'list', limit: 5_000 });
    expect(huge.ok && huge.request.action === 'list' && huge.request.limit).toBe(MAX_LIST_LIMIT);

    const zero = parseConvertRequest({ action: 'list', limit: 0 });
    expect(zero.ok && zero.request.action === 'list' && zero.request.limit).toBe(1);

    const junk = parseConvertRequest({ action: 'list', limit: 'ten' });
    expect(junk.ok && junk.request.action === 'list' && junk.request.limit).toBe(DEFAULT_LIST_LIMIT);
  });
});

describe('base64Bytes', () => {
  it('accounts for padding', () => {
    // `btoa('a')` is 'YQ==' — one byte, four characters. Ignoring the padding
    // over-counts by two on every short payload and, more to the point, makes
    // the size ceiling wrong by a byte or two at the boundary.
    expect(base64Bytes('YQ==')).toBe(1);
    expect(base64Bytes('YWI=')).toBe(2);
    expect(base64Bytes('YWJj')).toBe(3);
    expect(base64Bytes('')).toBe(0);
  });
});

describe('sourceKindFor', () => {
  it('guesses nothing', () => {
    expect(sourceKindFor('Template.docx')).toBeNull();
    expect(sourceKindFor('Template')).toBeNull();
    expect(sourceKindFor('Template.PDF')).toBe('pdf');
    expect(sourceKindFor('Template.MD')).toBe('text');
  });
});

describe('where the file lands', () => {
  it('is not the public report-templates bucket', () => {
    // `report-templates` is public, and its public-ness is load-bearing — asset
    // URLs from it are embedded in saved template JSON. A converted draft
    // carries whatever prose was in somebody's uploaded template.
    expect(STORAGE_BUCKET).not.toBe('report-templates');
    expect(STORAGE_BUCKET).toBe('converted-templates');
  });

  it('puts the conversion id in the path, so a re-render replaces its own file', () => {
    const path = convertedStoragePath(UUID, 'X.pdf');
    expect(path).toContain(UUID);
    expect(convertedStoragePath(UUID, 'X.pdf')).toBe(path);
  });

  it('sanitises a filename built from a template title', () => {
    const name = convertedFileName('Borrowing Power: 2026/27 Edition', FORMAT);
    expect(name).toMatch(/^[A-Za-z0-9_]+\.pdf$/);
    expect(name).not.toContain('/');
    expect(name).toContain('converted');
  });

  it('still produces a filename for an untitled template', () => {
    expect(convertedFileName('', FORMAT)).toMatch(/^Template_converted_/);
    expect(convertedFileName('!!!', FORMAT)).toMatch(/^Template_converted_/);
  });

  it('takes the reference off the front of the id', () => {
    expect(convertedReference(UUID)).toBe('4B1D9E3A');
  });
});

describe('the PDF extraction prompt', () => {
  const prompt = pdfExtractionPrompt('Borrowing Power.pdf');

  it('insists on ATX headings, which are the only thing extraction reads', () => {
    expect(prompt).toContain('ATX');
    expect(prompt).toMatch(/###?/);
    expect(prompt.toLowerCase()).toContain('heading');
  });

  it('forbids rewriting the words', () => {
    // A converter that quietly improves somebody's template is not a converter.
    expect(prompt).toContain('Do not summarise');
    expect(prompt.toLowerCase()).toContain('placeholder');
  });

  it('names the file, so a model has the document title if the page does not', () => {
    expect(prompt).toContain('Borrowing Power.pdf');
  });

  it('tells the model an eyebrow label is not a heading', () => {
    // The failure this rule exists for: reading a page, a model maps type size
    // to heading level, so `SECTION 01` set small above a large chapter title
    // comes back as that title's *parent*. Every chapter of a real Snapshot
    // arrived inverted this way. `extractStructure` folds them anyway, but the
    // repair should not be the only thing standing between us and it.
    expect(prompt).toContain('SECTION 01');
    expect(prompt).toContain('not by type size');
    expect(prompt.toLowerCase()).toContain('siblings');
  });

  it('tells the model the cover is front matter, not sections', () => {
    // A masthead and a client name set large on page one came back as two `#`
    // headings owning nothing, which then defined the shallowest level.
    expect(prompt.toLowerCase()).toContain('front matter');
  });
});

describe('parseBrandRequest', () => {
  const SYSTEM = { name: 'Warm Editorial', brandHex: '#2F5D50', options: { preset: 'signature' } };

  it('refuses a brief too short to design from', () => {
    const parsed = parseBrandRequest({ action: 'generate', brief: 'nice' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(String(MIN_BRIEF_CHARS));
  });

  it('accepts a real brief', () => {
    const parsed = parseBrandRequest({
      action: 'generate',
      brief: 'A boutique buyers agency writing for first-time investors.',
      companyName: 'Harbour & Vale',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.request.action === 'generate') {
      expect(parsed.request.companyName).toBe('Harbour & Vale');
    }
  });

  it('refuses a malformed brand colour rather than defaulting it', () => {
    // Falling back to the house brand would hand somebody a document in the
    // wrong colour with no indication of why.
    const parsed = parseBrandRequest({ action: 'save', system: { ...SYSTEM, brandHex: 'forest' } });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain('brandHex');
  });

  it('refuses a system with no name', () => {
    const parsed = parseBrandRequest({ action: 'audit', system: { ...SYSTEM, name: 'X' } });
    expect(parsed.ok).toBe(false);
  });

  it('refuses a non-uuid id on save', () => {
    const parsed = parseBrandRequest({ action: 'save', system: SYSTEM, id: '17' });
    expect(parsed.ok).toBe(false);
  });

  it('defaults isActive to true and id to null', () => {
    const parsed = parseBrandRequest({ action: 'save', system: SYSTEM });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.request.action === 'save') {
      expect(parsed.request.isActive).toBe(true);
      expect(parsed.request.id).toBeNull();
    }
  });

  it('accepts a listing with no system in the body', () => {
    // `audit` and `save` both run `readBrandDesignSystem(b.system)`, so the
    // `list` branch has to come first or a listing is refused for not being a
    // design system.
    const parsed = parseBrandRequest({ action: 'list' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.request.action === 'list') {
      expect(parsed.request.includeInactive).toBe(false);
    }
  });

  it('carries includeInactive when asked', () => {
    const parsed = parseBrandRequest({ action: 'list', includeInactive: true });
    expect(parsed.ok && parsed.request.action === 'list' && parsed.request.includeInactive).toBe(true);
  });

  it('names the actions it knows', () => {
    const parsed = parseBrandRequest({ action: 'draft' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain('audit');
      expect(parsed.error).toContain('generate');
      expect(parsed.error).toContain('save');
      expect(parsed.error).toContain('list');
    }
  });
});

describe('extractJsonObject', () => {
  it('finds an object behind a sentence of preamble', () => {
    expect(extractJsonObject('Here you go:\n{"name":"Warm"}')).toEqual({ name: 'Warm' });
  });

  it('finds one inside a code fence', () => {
    expect(extractJsonObject('```json\n{"name":"Warm"}\n```')).toEqual({ name: 'Warm' });
  });

  it('does not stop at a brace inside a string', () => {
    // A lazy `\{.*\}` cuts this object in half and the reader sees nothing.
    const parsed = extractJsonObject('{"description":"a } brace","name":"Warm"}');
    expect(parsed).toEqual({ description: 'a } brace', name: 'Warm' });
  });

  it('survives an escaped quote before a brace', () => {
    const parsed = extractJsonObject('{"description":"say \\"} \\" then stop","name":"W"}');
    expect((parsed as { name: string }).name).toBe('W');
  });

  it('returns null rather than throwing on an unbalanced object', () => {
    expect(extractJsonObject('{"name":"Warm"')).toBeNull();
    expect(extractJsonObject('no json at all')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
  });
});

describe('the document follows the format it is bound to', () => {
  const structure = extractStructure([
    '# Borrowing Power Assessment',
    `## Client Position Summary\n\n${'Capacity is assessed against a servicing buffer above the advertised rate. '.repeat(4)}`,
    `## Household Income\n\n${'Household income is taken from the payslips supplied at application. '.repeat(4)}`,
    `## Fee Schedule\n\n${'Fees are charged on settlement and are disclosed in the agreement. '.repeat(4)}`,
  ].join('\n\n'), 'Borrowing Power');
  const plan = proposeBinding(FORMAT, structure);
  const rendered = renderConvertedDocument({
    structure,
    plan,
    palette: resolveReportPalette({ preset: 'signature', brandHex: '#2F5D50' }),
    company: resolveCompanyBlock({ company_name: 'Harbour & Vale Advisory' } as never, null),
    masthead: 'Harbour & Vale',
    systemName: 'Warm Editorial',
    preparedOn: '2026-08-04T00:00:00.000Z',
  });

  it('prints a contents page only when the archetype declares one', () => {
    // Measured, not assumed: Borrowing Capacity declares `contents: false`
    // because a short format does not carry one. The renderer used to print one
    // regardless, which broke the binding's promise — a draft bound to a format
    // should open *as* that format — and under-claimed the page budget by
    // exactly one, because the spine costed a page the document was not
    // printing.
    const declaresContents = REPORT_ARCHETYPES[FORMAT].contents;
    const spineHasContents = rendered.spine.some((e) => e.slot === 'contents');
    expect(spineHasContents).toBe(declaresContents);
    expect(rendered.html.includes('>Contents<')).toBe(declaresContents);
  });

  it('claims exactly the pages its own parts add up to', () => {
    // The budget is the spine's sum. If the document renders a block the spine
    // does not carry, the two disagree and every render is short by that block.
    const parts = planConvertedChapters(structure, plan).reduce((n, c) => n + c.pages, 0);
    const furniture = rendered.spine.filter((e) => e.slot !== 'chapter' && e.slot !== 'wide-table')
      .reduce((n, e) => n + e.pageBudget, 0);
    expect(rendered.pageBudget).toBe(parts + furniture);
  });
});

describe('source of truth', () => {
  const bridge = (rel: string) =>
    readFileSync(resolve(__dirname, '..', '..', '..', rel), 'utf8');

  it('keeps the route contracts as one-line bridges to the Edge Function modules', () => {
    // Two copies of "what a request is" is how a client and a server stop
    // agreeing about it.
    for (const rel of ['reports/converted/route.pure.ts', 'brandDesign/route.pure.ts']) {
      const source = bridge(rel);
      const code = source.split('\n').filter((l) => l.trim() && !l.trim().startsWith('*')
        && !l.trim().startsWith('/*') && !l.trim().startsWith('//'));
      expect(code, rel).toHaveLength(1);
      expect(code[0], rel).toMatch(/^export \* from '.*supabase\/functions\/_shared\/.*'/);
    }
  });

  it('keeps the client helpers free of PDF libraries', () => {
    // The whole point of the server render is that no PDF is built in a
    // browser. A jsPDF import here would be a second renderer nobody chose.
    for (const rel of ['reports/converted/requestTemplateConversion.ts', 'brandDesign/requestBrandDesignSystem.ts']) {
      const source = bridge(rel);
      expect(source, rel).not.toMatch(/from ['"](jspdf|pdf-lib|html2canvas)/);
    }
  });
});
