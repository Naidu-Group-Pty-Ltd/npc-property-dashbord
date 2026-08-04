/**
 * What an uploaded template is *made of*.
 *
 * ## Structure, not layout
 *
 * The converter takes the sections of an existing template and nothing else.
 * Not its margins, not its colours, not where a logo sat — those are the
 * things the design system is replacing, and carrying them across would
 * reproduce the document rather than refurbish it. What is worth keeping from
 * a template somebody has been sending clients for years is the **shape of the
 * argument**: which sections exist, in what order, how deeply they nest, and
 * which of them are tabular.
 *
 * That also happens to be the only part of a PDF that survives extraction
 * reliably. `parse-template-document` returns Markdown with an ATX heading
 * hierarchy; positions and fonts do not come back at all on a scanned source,
 * and come back wrong often enough on a native one that a layout-faithful
 * converter would spend its life in the uncanny valley.
 *
 * ## Depth is capped at two, and that is a design decision
 *
 * A report archetype's spine is chapters and their notes. Nothing in the design
 * system renders a fourth-level section as anything but a heading in the body
 * copy, so a template with `#####` nesting is flattened rather than losing the
 * content: the deep headings stay in the prose, they simply stop being
 * candidates for chapters. `MAX_BIND_DEPTH` is what makes that explicit.
 */
import { markdownToPlainText, renderMarkdown } from '../markdown.pure.ts';
import { neutraliseUrls } from '../text.pure.ts';

/** No template in the record has more than this many sections worth binding. */
export const MAX_SECTIONS = 80;

/** Beyond two levels a heading is body copy, not a chapter candidate. */
export const MAX_BIND_DEPTH = 2;

/** A section shorter than this is a label, not a section. */
export const MIN_SECTION_CHARS = 40;

/** The most Markdown one extracted section may carry. */
export const MAX_SECTION_CHARS = 12_000;

/** A whole upload beyond this is not a template, it is a book. */
export const MAX_SOURCE_CHARS = 400_000;

/** One section of an uploaded template. */
export interface ExtractedSection {
  /** Position in the source, from zero. Stable; used as the binding key. */
  index: number;
  /** 1 for a top-level section, 2 for a sub-section. Deeper is flattened. */
  depth: 1 | 2;
  title: string;
  /** The section's own Markdown, its heading removed. */
  markdown: string;
  /** Characters of prose, after the caps. Drives the "is this real" check. */
  chars: number;
  /** GFM pipe tables found inside. A tabular section binds differently. */
  tables: number;
  /** True when the body is mostly a table rather than prose. */
  tabular: boolean;
}

export interface ExtractedStructure {
  /** What the document calls itself, when the source said. */
  title: string;
  sections: readonly ExtractedSection[];
  /** Every heading, including the ones too deep to bind. For the report. */
  headingCount: number;
  notices: {
    /** Headings past `MAX_BIND_DEPTH`, left in the prose. */
    flattened: number;
    /** Sections dropped for being shorter than `MIN_SECTION_CHARS`. */
    tooShort: number;
    /** Characters the caps did not carry. */
    charsOmitted: number;
    /** True when the source had no headings at all. */
    unstructured: boolean;
  };
}

const clean = (v: string): string =>
  neutraliseUrls(v).replace(/\s+/g, ' ').trim();

/** `## 3. Market Overview` → `{ depth: 1, title: 'Market Overview' }`. */
function readHeading(line: string): { level: number; title: string } | null {
  const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
  if (!m) return null;
  // The leading number is dropped from the title but not from the order: the
  // spine renumbers, and carrying "3." into a chapter called "3. Market
  // Overview" prints two numbers on the page.
  const title = clean(markdownToPlainText(m[2].replace(/^\d{1,2}[.)]\s*/, ''), 160));
  if (!title) return null;
  return { level: m[1].length, title };
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;

/**
 * Read an uploaded template's Markdown into sections.
 *
 * Never throws. A source with no headings at all produces one section holding
 * everything, flagged `unstructured` — which is a real outcome for a scanned
 * template, and one the caller has to be able to show the user rather than
 * discover as an empty document.
 */
export function extractStructure(markdown: string, fallbackTitle = ''): ExtractedStructure {
  const source = String(markdown ?? '').slice(0, MAX_SOURCE_CHARS);
  const omittedBySource = Math.max(0, String(markdown ?? '').length - source.length);

  const lines = source.split('\n');
  const sections: ExtractedSection[] = [];
  const notices = { flattened: 0, tooShort: 0, charsOmitted: omittedBySource, unstructured: false };

  let title = clean(fallbackTitle);
  let headingCount = 0;
  let current: { depth: 1 | 2; title: string; body: string[] } | null = null;
  let shallowest = 6;

  // Pass one: what is the shallowest heading level the source actually uses?
  // Templates open at `#` or at `##` about equally often, and binding depth has
  // to be relative or half the corpus binds nothing.
  const levels: number[] = [];
  for (const line of lines) {
    const h = readHeading(line);
    if (h) { headingCount += 1; levels.push(h.level); shallowest = Math.min(shallowest, h.level); }
  }

  // A lone heading at the shallowest level is the document's title, not a
  // section, and the baseline is the level below it.
  //
  // Without this the overwhelmingly common shape — one `#` title over a run of
  // `##` sections — makes every real section depth 2, so nothing is a top-level
  // section and the review screen reports "0 sections, 8 sub-sections" for a
  // document that plainly has eight sections. The Report Q&A migration hit the
  // same thing in `chapterLevelOf` and resolved it the same way: when the
  // shallowest level holds a single heading, fall to the next one.
  const atShallowest = levels.filter((l) => l === shallowest).length;
  const deeper = levels.filter((l) => l > shallowest);
  const titleIsLone = atShallowest === 1 && levels[0] === shallowest && deeper.length > 0;
  const baseline = titleIsLone ? Math.min(...deeper) : shallowest;

  const flush = () => {
    if (!current) return;
    const body = current.body.join('\n').trim();
    const capped = body.length > MAX_SECTION_CHARS ? body.slice(0, MAX_SECTION_CHARS) : body;
    notices.charsOmitted += body.length - capped.length;
    if (capped.length < MIN_SECTION_CHARS) { notices.tooShort += 1; current = null; return; }
    const tableLines = capped.split('\n').filter((l) => TABLE_ROW.test(l)).length;
    sections.push({
      index: sections.length,
      depth: current.depth,
      title: current.title,
      markdown: capped,
      chars: capped.length,
      tables: tableLines >= 2 ? Math.max(1, Math.round(tableLines / 4)) : 0,
      tabular: tableLines >= 2 && tableLines >= capped.split('\n').filter(Boolean).length / 2,
    });
    current = null;
  };

  for (const line of lines) {
    const h = readHeading(line);
    if (!h) { if (current) current.body.push(line); continue; }

    const relative = h.level - baseline + 1;
    // Above the baseline: this is the lone title heading. It names the document
    // and opens no section.
    if (relative < 1) {
      flush();
      if (!title) title = h.title;
      continue;
    }
    if (relative > MAX_BIND_DEPTH) {
      // Too deep to be a chapter. Kept in the prose of whichever section it
      // falls in, so nothing is lost — only its candidacy.
      notices.flattened += 1;
      if (current) current.body.push(line);
      continue;
    }
    flush();
    current = { depth: relative === 1 ? 1 : 2, title: h.title, body: [] };
    if (sections.length >= MAX_SECTIONS) { current = null; break; }
  }
  flush();

  if (!headingCount) {
    notices.unstructured = true;
    const body = source.trim().slice(0, MAX_SECTION_CHARS);
    if (body.length >= MIN_SECTION_CHARS) {
      sections.push({
        index: 0,
        depth: 1,
        title: title || 'Document',
        markdown: body,
        chars: body.length,
        tables: 0,
        tabular: false,
      });
    }
  }

  return { title: title || clean(fallbackTitle) || 'Untitled template', sections, headingCount, notices };
}

/**
 * A one-line description of what was found, for the review screen.
 *
 * The upload screen has to say something truthful before anybody commits to a
 * conversion, and "42 sections" is the single most useful thing to say. An
 * unstructured source is called out first because it is the one result where
 * the sensible next action is "try a different export", not "carry on".
 */
export function describeStructure(structure: ExtractedStructure): string {
  if (structure.notices.unstructured) {
    return 'No headings were found, so the whole document is one section. '
      + 'A source exported with real headings converts far better.';
  }
  const top = structure.sections.filter((s) => s.depth === 1).length;
  const sub = structure.sections.length - top;
  const tabular = structure.sections.filter((s) => s.tabular).length;
  const parts = [`${top} ${top === 1 ? 'section' : 'sections'}`];
  if (sub) parts.push(`${sub} sub-${sub === 1 ? 'section' : 'sections'}`);
  if (tabular) parts.push(`${tabular} mostly tabular`);
  if (structure.notices.flattened) {
    parts.push(`${structure.notices.flattened} heading${structure.notices.flattened === 1 ? '' : 's'} too deep to bind`);
  }
  return parts.join(', ');
}

/** Estimated printed lines, so the plan can be costed before it is rendered. */
export function sectionLines(section: ExtractedSection, idPrefix: string): number {
  return section.markdown ? renderMarkdown(section.markdown, { idPrefix }).lines : 0;
}
