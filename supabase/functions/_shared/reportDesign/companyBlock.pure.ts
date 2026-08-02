/**
 * The closing page every report shares: who issued it, how to reach them, and
 * the professional disclaimer.
 *
 * There are currently **two** implementations of this page — `drawJsPDFDisclaimerPage`
 * and `drawPdfLibDisclaimerPage` in `src/utils/pdfDisclaimerPage.ts` — which
 * agree on nothing but the gold (`#BF9B50`, itself one of eight in the repo) and
 * disagree on margins, leading, the disclaimer's vertical anchor, and whether
 * the font size setting is honoured at all (jsPDF's ignores it). This module is
 * the shape both of them, and the WeasyPrint page, now derive from.
 *
 * Only the **data shaping** lives here — sanitisation, name splitting, row
 * order, the font-size table. Painting is the renderer's job, which is why this
 * module has no colours in it and works for a vector PDF library and an HTML
 * document alike.
 */

/** Contact details as stored in `global_report_settings.contact_details`. */
export interface CompanyContact {
  company_name?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  abn?: string | null;
}

export type DisclaimerFontSize = 'small' | 'medium' | 'large';

export interface CompanyDisclaimer {
  is_enabled?: boolean | null;
  text?: string | null;
  font_size?: DisclaimerFontSize | string | null;
}

/** A label/value pair ready to be painted. */
export interface ContactRow {
  label: string;
  value: string;
}

/**
 * Fallback company name.
 *
 * Deliberately generic. A white-label tenant whose settings have not been filled
 * in must not have our name printed on their client's report, which is what a
 * hardcoded `"NPC"` here would do.
 */
export const FALLBACK_COMPANY_NAME = 'Property Consulting';

/**
 * Strip what a PDF core font cannot set.
 *
 * jsPDF and pdf-lib both use WinAnsi-encoded standard fonts; an emoji or a
 * curly quote pasted from Word throws `WinAnsiEncoding cannot encode` mid-render
 * and loses the whole document. HTML has no such limit, but the two paths must
 * produce the same text or the golden comparison in Phase 3 is meaningless — so
 * both sanitise.
 */
export function sanitizeReportText(text: string | null | undefined): string {
  if (!text) return '';
  return String(text)
    // Emoji, dingbats, flags, variation selectors, keycaps, ZWJ.
    .replace(
      /[\u{1F300}-\u{1FAFF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu,
      '',
    )
    // Typographer's punctuation → ASCII, rather than deleted: losing an
    // apostrophe mid-word is worse than not having a curly one.
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    // Non-breaking space becomes an ordinary one: it survives the Latin-1
    // filter below but breaks word wrapping on both vector paths, which
    // measure a line word by word.
    .replace(/\u00A0/g, ' ')
    // Anything left outside Latin-1 printable + whitespace.
    .replace(/[^\x20-\x7E\xA0-\xFF\n\r\t]/g, '')
    .trim();
}

/**
 * Split a company name into a display lead and a smaller tail.
 *
 * "NPC Property Services" sets as **NPC PROPERTY** over a lighter *SERVICES* —
 * a lockup convention both existing implementations already use, reproduced here
 * so it survives the port. A single-word name has no tail.
 */
export function splitCompanyName(name: string | null | undefined): {
  lead: string;
  tail: string | null;
} {
  const clean = sanitizeReportText(name) || FALLBACK_COMPANY_NAME;
  const parts = clean.toUpperCase().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { lead: parts[0] ?? FALLBACK_COMPANY_NAME.toUpperCase(), tail: null };
  return { lead: parts.slice(0, -1).join(' '), tail: parts[parts.length - 1] };
}

/**
 * Contact rows, in the order they print. Empty fields are omitted rather than
 * printed as a label with nothing beside it.
 *
 * ABN last: it is the legal identifier, not the way anyone contacts anybody.
 */
export function companyContactRows(contact: CompanyContact | null | undefined): ContactRow[] {
  const c = contact ?? {};
  const candidates: Array<[string, string | null | undefined]> = [
    ['Website', c.website],
    ['Email', c.email],
    ['Phone', c.phone],
    ['Address', c.address],
    ['ABN', c.abn],
  ];
  return candidates
    .map(([label, value]) => ({ label, value: sanitizeReportText(value) }))
    .filter((row) => row.value.length > 0);
}

/**
 * Disclaimer point sizes.
 *
 * `small` is 8pt — below the product's own micro floor, and deliberately so: a
 * professional disclaimer is a legal artefact that must be present and complete,
 * not one that must be comfortable. It still clears 4.5:1, which is the part
 * that is not negotiable.
 */
export const DISCLAIMER_FONT_PT: Record<DisclaimerFontSize, number> = {
  small: 8,
  medium: 10,
  large: 12,
};

export function disclaimerFontPt(size: string | null | undefined): number {
  const key = typeof size === 'string' ? size : 'small';
  return DISCLAIMER_FONT_PT[key as DisclaimerFontSize] ?? DISCLAIMER_FONT_PT.small;
}

/** The disclaimer as paragraphs, or `[]` when it is disabled or empty. */
export function disclaimerParagraphs(
  disclaimer: CompanyDisclaimer | null | undefined,
): string[] {
  if (!disclaimer?.is_enabled) return [];
  const cleaned = sanitizeReportText(disclaimer.text);
  if (!cleaned) return [];
  return cleaned.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);
}

/** Everything the closing page needs, resolved once. */
export interface CompanyBlock {
  name: { lead: string; tail: string | null };
  rows: ContactRow[];
  disclaimer: { paragraphs: string[]; fontPt: number };
}

export function resolveCompanyBlock(
  contact: CompanyContact | null | undefined,
  disclaimer: CompanyDisclaimer | null | undefined,
): CompanyBlock {
  return {
    name: splitCompanyName(contact?.company_name),
    rows: companyContactRows(contact),
    disclaimer: {
      paragraphs: disclaimerParagraphs(disclaimer),
      fontPt: disclaimerFontPt(disclaimer?.font_size),
    },
  };
}

/**
 * The running foot printed on every body page.
 *
 * The prototype hardcoded `"NPC · Investment Intelligence"` into the `@page`
 * rule, so a white-label tenant's report carried our name on all 40 pages.
 *
 * **The company name alone.** The `@bottom-left` margin box is one third of the
 * measure — about 55mm — and the foot is set in letterspaced uppercase mono. A
 * company name plus a document name wraps to two lines there, which is what the
 * first render of this page showed. The document name belongs on the cover, in
 * the PDF title, and in the `@top-right` running head, all of which have room.
 */
export function mastheadFor(contact: CompanyContact | null | undefined): string {
  return sanitizeReportText(contact?.company_name) || FALLBACK_COMPANY_NAME;
}
