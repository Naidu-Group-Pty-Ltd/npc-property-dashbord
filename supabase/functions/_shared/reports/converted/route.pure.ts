/**
 * What `convert-template-document` accepts, and what it answers.
 *
 * Three actions, one per step a person takes on the converter screen:
 *
 * - **`extract`** — a file goes up, sections come back. The row is written at
 *   status `review` and nothing is rendered.
 * - **`propose`** — "bind it to a different format instead". Re-scores the
 *   *stored* structure; no re-parse, because parsing a PDF is the slow and
 *   expensive half and the sections do not change when the format does.
 * - **`render`** — the confirmed binding becomes a PDF.
 *
 * ## Why the source arrives as bytes rather than a storage path
 *
 * Every other route in this programme reads its input from a row. This one has
 * no row to read: the input is a file on somebody's desktop that has never been
 * part of the system. The two ways to get it here are an upload to a bucket
 * followed by a path, or the bytes themselves.
 *
 * The bytes win because the path leaves litter. An upload that is followed by a
 * conversion the person abandons is an orphaned object in a bucket with a
 * retention job that will not delete it (`pdf-import-retention` is dry-run by
 * design and never removes anything), and the converter would be the only
 * feature in the repo generating those. Bytes in, Markdown stored on the row,
 * nothing left behind.
 *
 * The cost is a request-size ceiling, and `MAX_SOURCE_BYTES` is it.
 */
import type { ReportArchetypeId } from '../../reportDesign/structure.pure.ts';
import { bindableFormats } from './binding.pure.ts';

/**
 * The largest source a conversion accepts.
 *
 * Base64 inflates by a third, so six megabytes of PDF is an eight-megabyte
 * request body. Templates in the record run to a few hundred kilobytes; six is
 * generous rather than tight, and a document larger than this is not a template.
 */
export const MAX_SOURCE_BYTES = 6 * 1024 * 1024;

/** Suffixes that need no model to read. */
export const TEXT_SUFFIXES = ['.md', '.markdown', '.txt'] as const;

export type SourceKind = 'text' | 'pdf';

/** What a filename says the source is. Unknown suffixes are refused, not guessed. */
export function sourceKindFor(fileName: string): SourceKind | null {
  const name = String(fileName ?? '').toLowerCase();
  if (TEXT_SUFFIXES.some((s) => name.endsWith(s))) return 'text';
  if (name.endsWith('.pdf')) return 'pdf';
  return null;
}

export interface ExtractRequest {
  action: 'extract';
  fileName: string;
  kind: SourceKind;
  /** Base64, without a data-URI prefix. */
  sourceBase64: string;
  /** The format to propose a binding against. */
  format: ReportArchetypeId;
}

export interface ProposeRequest {
  action: 'propose';
  conversionId: string;
  format: ReportArchetypeId;
}

export interface RenderRequest {
  action: 'render';
  conversionId: string;
  format: ReportArchetypeId;
  /** The plan as edited in the browser. Re-validated against the structure. */
  binding: unknown;
  /** Which saved design system to set it in. Null means the house default. */
  designSystemId: string | null;
}

/**
 * The conversions this caller has made.
 *
 * Without this a conversion is write-only. The PDF lives in a private bucket
 * that grants `authenticated` no object access at all — deliberately, because
 * it holds whatever prose was in somebody's uploaded template — so a stored
 * `storage_path` cannot be turned back into a URL from the browser. Close the
 * tab and the document is unreachable forever, which makes "where does the
 * output go?" a question with no good answer.
 *
 * Each row is re-signed as it is listed rather than a `resign` action existing
 * separately: a signed URL expires on a clock the browser cannot see, so a UI
 * that had to ask for a fresh one would have to guess when.
 */
export interface ListRequest {
  action: 'list';
  limit: number;
}

/** Chapters and their prose, for building an editable template. */
export interface ChaptersRequest {
  action: 'chapters';
  conversionId: string;
}

export type ConvertRouteRequest =
  | ExtractRequest
  | ProposeRequest
  | RenderRequest
  | ListRequest
  | ChaptersRequest;

/** The most conversions one listing will return. */
export const MAX_LIST_LIMIT = 50;
export const DEFAULT_LIST_LIMIT = 10;

export type ConvertRequestParse =
  | { ok: true; request: ConvertRouteRequest }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Bytes a base64 payload decodes to, without decoding it. */
export function base64Bytes(b64: string): number {
  const s = String(b64 ?? '');
  if (!s) return 0;
  const padding = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((s.length * 3) / 4) - padding);
}

function readFormat(raw: unknown): ReportArchetypeId | null {
  const asked = typeof raw === 'string' ? raw.trim() : '';
  const legal = bindableFormats() as string[];
  return legal.includes(asked) ? (asked as ReportArchetypeId) : null;
}

/**
 * Read a request body.
 *
 * The format is checked against `bindableFormats()` rather than against the
 * full archetype list. An archetype with no entry in `FORMAT_CHAPTERS` has
 * nothing to bind to, so a request naming one would produce a document with
 * zero chapters and no explanation — a 400 saying which formats exist is the
 * more useful answer.
 */
export function parseConvertRequest(body: unknown): ConvertRequestParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid json' };
  const b = body as Record<string, unknown>;
  const action = typeof b.action === 'string' ? b.action.trim() : '';

  // Above the format check, and that ordering is the whole point.
  //
  // `readFormat` runs for every request below and 400s a body without one.
  // Listing past conversions names no format — they each carry their own — and
  // neither does asking a stored conversion for its chapters. Put either branch
  // after the check and it is rejected before it is ever reached, with an error
  // message about report formats that has nothing to do with what was asked.
  if (action === 'list') {
    const asked = Number(b.limit);
    const limit = Number.isFinite(asked)
      ? Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(asked)))
      : DEFAULT_LIST_LIMIT;
    return { ok: true, request: { action: 'list', limit } };
  }

  if (action === 'chapters') {
    const conversionId = typeof b.conversionId === 'string' ? b.conversionId.trim() : '';
    if (!UUID.test(conversionId)) return { ok: false, error: 'conversionId must be a uuid' };
    return { ok: true, request: { action: 'chapters', conversionId } };
  }

  const format = readFormat(b.format);
  if (!format) {
    return {
      ok: false,
      error: `format must be one of: ${bindableFormats().join(', ')}`,
    };
  }

  if (action === 'extract') {
    const fileName = typeof b.fileName === 'string' ? b.fileName.trim().slice(0, 200) : '';
    const kind = sourceKindFor(fileName);
    if (!kind) {
      return {
        ok: false,
        error: `"${fileName.slice(0, 60) || 'the upload'}" is not a supported source — upload a PDF, Markdown or text file`,
      };
    }
    const sourceBase64 = typeof b.sourceBase64 === 'string' ? b.sourceBase64.trim() : '';
    if (!sourceBase64) return { ok: false, error: 'the upload was empty' };
    const bytes = base64Bytes(sourceBase64);
    if (bytes > MAX_SOURCE_BYTES) {
      return {
        ok: false,
        error: `the upload is ${Math.round(bytes / 1024 / 1024)} MB and the limit is `
          + `${MAX_SOURCE_BYTES / 1024 / 1024} MB`,
      };
    }
    return { ok: true, request: { action: 'extract', fileName, kind, sourceBase64, format } };
  }

  if (action === 'propose' || action === 'render') {
    const conversionId = typeof b.conversionId === 'string' ? b.conversionId.trim() : '';
    if (!UUID.test(conversionId)) return { ok: false, error: 'conversionId must be a uuid' };
    if (action === 'propose') return { ok: true, request: { action: 'propose', conversionId, format } };

    const rawSystem = typeof b.designSystemId === 'string' ? b.designSystemId.trim() : '';
    if (rawSystem && !UUID.test(rawSystem)) return { ok: false, error: 'designSystemId must be a uuid' };
    return {
      ok: true,
      request: {
        action: 'render',
        conversionId,
        format,
        binding: b.binding ?? null,
        designSystemId: rawSystem || null,
      },
    };
  }

  return {
    ok: false,
    error: `unknown action "${action.slice(0, 40)}" — expected extract, propose, render, list or chapters`,
  };
}

/**
 * The filename.
 *
 * Named after the uploaded template rather than the format, because a person
 * with four converted drafts in a downloads folder is looking for the one they
 * uploaded. `_converted` is appended so it can never collide with the original
 * sitting beside it.
 */
export function convertedFileName(title: string, format: ReportArchetypeId): string {
  const stem = (title || 'Template').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)
    || 'Template';
  const suffix = format.replace(/[^a-z0-9]+/g, '_');
  return `${stem}_converted_${suffix}.pdf`;
}

/** The first eight characters of the conversion id, for the cover foot. */
export function convertedReference(conversionId: string): string {
  return conversionId.slice(0, 8).toUpperCase();
}

/**
 * Where the file lands.
 *
 * A private bucket of its own, created by the converter's migration.
 *
 * Not `report-templates`, which is where the Template Builder's own assets go:
 * that bucket is **public**, and its public-ness is load-bearing — asset URLs
 * are embedded in saved template JSON (`secure-storage:52`). A converted draft
 * carries whatever prose was in somebody's uploaded template, which is not
 * something to put behind a guessable public URL.
 *
 * Not `template-import-artifacts` either, private though it is: that bucket
 * belongs to the PDF import subsystem, whose monitoring reports any object it
 * cannot tie to an import as an orphan (`pdf-import-monitoring`). Borrowing it
 * would generate a standing false alarm.
 *
 * The path carries the conversion id, so a re-render of the same conversion
 * replaces its own file and nothing else.
 */
export function convertedStoragePath(conversionId: string, fileName: string): string {
  return `conversions/${conversionId}/${fileName}`;
}

export const STORAGE_BUCKET = 'converted-templates';

/** How long a returned link lives. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * What the model is asked for when the source is a PDF.
 *
 * Headings are the entire ask. `extractStructure` reads an ATX hierarchy and
 * nothing else — not fonts, not positions, not colours — so an extraction that
 * returns beautiful prose with no `##` produces a document with one section and
 * a notice saying so. The instruction is blunt about it for that reason.
 *
 * Pure, so the prompt is diffable and a test can assert what it does and does
 * not ask for. It asks for no interpretation, and that is deliberate: the words
 * in the output should be the words in the upload, because a converter that
 * quietly rewrites somebody's template is not a converter.
 *
 * ## The eyebrow rule earns its length
 *
 * Reading a page, a model maps *visual size* to heading level, which is right
 * almost everywhere and exactly wrong for the shape a well-designed report uses
 * most: a small `SECTION 01` label above a large chapter title. Size says the
 * label is the parent. It is not — it is furniture belonging to the title under
 * it. Converting one of our own Borrowing Capacity Snapshots produced
 * `## Section 01` over `# Capacity at a glance` for every chapter, which
 * inverted the whole hierarchy. `extractStructure` now folds those labels
 * defensively, but a prompt that stops them arriving is worth more than a repair
 * that has to recognise them.
 */
export function pdfExtractionPrompt(fileName: string): string {
  return `Transcribe this document to Markdown.

The file is "${fileName.slice(0, 120)}" — a report template. What matters is its
**heading structure**: which sections exist, in what order, and how they nest.

Rules:

- Use ATX headings (\`#\`, \`##\`, \`###\`) and mirror the source's own hierarchy.
  A line that is visually a heading in the original — larger, bolder, numbered,
  on its own — is a heading here. This is the single most important thing in the
  output; a transcription with no headings is useless.
- **Nest by meaning, not by type size.** A small label sitting above a larger
  title — \`SECTION 01\`, \`PART TWO\`, \`Chapter 3\`, a bare number — is not a
  heading and is not the parent of anything. The title beneath it is the
  heading; drop the label. Sections that are siblings in the document must come
  back at the same \`#\` level even when the original set them in different
  sizes.
- The cover is not a section. A company name, a document title, a client name or
  a date set large on the first page is front matter: give the document one
  \`#\` title and leave the rest out rather than making each line a heading.
- Transcribe the words as they are. Do not summarise, improve, reorder or
  translate. Do not add a section the document does not have.
- Tables become GFM pipe tables.
- Drop page furniture: running heads, page numbers, repeated footers, and any
  line that repeats on every page.
- Where the original has a placeholder — \`[Client Name]\`, a blank line for a
  figure, a box to fill in — keep it as text. It is part of the template.
- Return Markdown only. No preamble, no code fence around the whole document.`;
}

export interface ConvertExtractResponse {
  action: 'extract';
  conversionId: string;
  format: ReportArchetypeId;
  formatName: string;
  /** `describeStructure`, ready to show. */
  summary: string;
  title: string;
  sections: Array<{ index: number; depth: number; title: string; chars: number; tabular: boolean }>;
  unstructured: boolean;
  flattened: number;
  tooShort: number;
  charsOmitted: number;
  binding: unknown;
  durationMs: number;
}

export interface ConvertProposeResponse {
  action: 'propose';
  conversionId: string;
  format: ReportArchetypeId;
  formatName: string;
  binding: unknown;
  durationMs: number;
}

/** One earlier conversion, as the history panel shows it. */
export interface ConvertListRow {
  id: string;
  status: string;
  sourceFilename: string;
  fileName: string;
  boundFormat: string | null;
  formatName: string | null;
  designSystemName: string | null;
  pageCount: number | null;
  bytes: number | null;
  boundChapters: number;
  unfilledChapters: number;
  appendixSections: number;
  unstructured: boolean;
  error: string | null;
  createdAt: string;
  /**
   * Freshly signed on every listing. Null when nothing was rendered, or when
   * signing this one row failed — a broken link on one conversion must not
   * take the other nine down with it.
   */
  url: string | null;
}

export interface ConvertListResponse {
  action: 'list';
  conversions: ConvertListRow[];
  durationMs: number;
}

/** One chapter of a converted document, with the prose that fills it. */
export interface ConvertedChapterContent {
  title: string;
  kind: 'bound' | 'unfilled' | 'appendix';
  markdown: string;
}

export interface ConvertChaptersResponse {
  action: 'chapters';
  conversionId: string;
  title: string;
  format: ReportArchetypeId;
  formatName: string;
  chapters: ConvertedChapterContent[];
  durationMs: number;
}

export interface ConvertRenderResponse {
  action: 'render';
  conversionId: string;
  url: string;
  fileName: string;
  bytes: number;
  pageCount: number | null;
  storagePath: string;
  brandSnapshotId: string | null;
  brandGaps: string[];
  designSystemName: string;
  chapters: string[];
  boundCount: number;
  unfilledCount: number;
  appendixCount: number;
  /** The format's page band, when the draft sits outside it. Advisory. */
  bandNote: string[];
  durationMs: number;
}
