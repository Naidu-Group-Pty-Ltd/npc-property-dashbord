/**
 * White-label branding for the intake pack.
 *
 * Reads the existing `whitelabel_settings` singleton — the same record the
 * dashboard chrome and generated reports already brand from — so a pack handed
 * to a client carries the organisation's own name and colours rather than the
 * platform's.
 *
 * Deliberately NOT embedding logo images: the repository's report rules warn
 * that most stored "logo" assets are email-signature banners carrying the
 * director's personal mobile number, which must never be shipped on a document
 * a client keeps. The pack uses the company name and brand colour as its
 * identity; adding a vetted print logo is a separate, deliberate change.
 * See `.claude/skills/npc-services-design/reports/REPORT_RULES.md`.
 */

import { supabase } from '@/integrations/supabase/client';

export interface PackBranding {
  companyName: string;
  /** Hex, used for header fills in the workbook and headings in the document. */
  brandHex: string;
  accentHex: string;
  /** Free-text footer, e.g. contact details the organisation wants on the pack. */
  footerNote: string;
}

/**
 * Neutral fallback so a pack can always be produced, branded or not.
 *
 * These are literal hex values by necessity, not by oversight: the output is an
 * .xlsx and a .docx opened in Excel and Word, which have no access to the
 * application's CSS custom properties. A semantic token would resolve to the
 * literal string "hsl(var(--primary))" inside the file and render as nothing.
 */
/* eslint-disable no-restricted-syntax -- generated Office documents cannot resolve CSS tokens; see above. */
export const DEFAULT_PACK_BRANDING: PackBranding = {
  companyName: 'NPC Property',
  brandHex: '#1F2937',
  accentHex: '#4F46E5',
  footerNote: '',
};
/* eslint-enable no-restricted-syntax */

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Accept only a well-formed hex; anything else falls back rather than corrupting the file. */
function safeHex(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return HEX.test(text) ? text.toUpperCase() : fallback;
}

/**
 * Resolve branding for a pack. Never throws — a branding lookup failing is not
 * a reason to deny someone their document.
 */
export async function resolvePackBranding(): Promise<PackBranding> {
  try {
    const { data, error } = await supabase
      .from('whitelabel_settings')
      .select('company_name, primary_color, accent_color')
      .limit(1)
      .maybeSingle();

    if (error || !data) return DEFAULT_PACK_BRANDING;

    return {
      companyName: (data.company_name || '').trim() || DEFAULT_PACK_BRANDING.companyName,
      brandHex: safeHex(data.primary_color, DEFAULT_PACK_BRANDING.brandHex),
      accentHex: safeHex(data.accent_color, DEFAULT_PACK_BRANDING.accentHex),
      footerNote: '',
    };
  } catch {
    return DEFAULT_PACK_BRANDING;
  }
}

/** Strip the leading `#` — xlsx and docx both want bare hex. */
export function bareHex(hex: string): string {
  return hex.replace(/^#/, '').toUpperCase();
}
