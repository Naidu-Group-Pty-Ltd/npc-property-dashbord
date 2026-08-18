/**
 * Compass QA Validator — Phase 7
 * -------------------------------
 * Runs structural QA on a generated report's markdown. Used by:
 *   • generate-investment-report (recorded on the report row)
 *   • condense-investment-report (returns assertions in response)
 *   • Deno tests (compassPostProcessor_test.ts)
 *   • Frontend QA panel (mirror in src/lib/reports/)
 *
 * Checks:
 *   1. Page band: Compass 20–26, Financial 18–22
 *   2. Financial content exclusion from Compass (no yield/LVR/cashflow tables)
 *   2b. No unresolved placeholders
 *   2c. No editorial commentary label survives, in any form
 *   3. Suburb-narrative exclusion from Financial Analysis
 *   4. Duplicate H2 heading detection
 *   6. Protected sections present
 *   7. Per-section word-cap compliance
 *   8. Sub-heading density per section
 *
 * A finding is a report of fact, never a reason to discard a document. The
 * generator records this and stores the report either way: a report that exists
 * and is over its band is more useful to everyone than no report at all.
 */

import {
  COMPASS_40_SECTIONS,
  FINANCIAL_ANALYSIS_SECTIONS,
  COMPASS_PAGE_BAND,
  PROTECTED_SECTION_IDS,
  type CompassSectionDefinition,
} from './compassSectionRegistry';
import { countWords, estimatePages, findEditorialLabels } from './compassPostProcessor';

/**
 * The prompt asks for at most 4 `###` a section; this flags at 6+.
 *
 * One of tolerance, deliberately: QA reports on a document that already exists
 * and a section that runs to a fifth sub-head is not a defect worth a finding.
 * v2.0 produced 68 `###` a report across 17 sections; 4 a section over 11 is ~44.
 */
const MAX_SUBHEADINGS_PER_SECTION = 5;

export type QASeverity = 'error' | 'warning' | 'info';

export interface QAFinding {
  rule: string;
  severity: QASeverity;
  message: string;
  sectionId?: string;
}

export interface QAReport {
  tier: 'compass-40' | 'financial-analysis';
  estimatedPages: number;
  wordCount: number;
  passed: boolean;
  findings: QAFinding[];
}

const FINANCIAL_KEYWORDS = [
  /\bgross yield\b/i,
  /\bnet yield\b/i,
  /\brental yield\b/i,
  /\bLVR\b/,
  /\bLMI\b/,
  /\bP&I\b/,
  /\bweekly rent\b/i,
  /\bpurchase price\b/i,
  /\bstamp duty\b/i,
  /\bloan amount\b/i,
  /\bmonthly repayment/i,
  /\bannual repayment/i,
  /\binterest rate sensitivity\b/i,
  /\b10[- ]year (cashflow|projection|cash contribution)/i,
  /\bsensitivity analysis\b/i,
  /\bafter[- ]tax cashflow\b/i,
  /\bnegative cashflow\b/i,
  /\bnegative gearing\b/i,
  /\bdepreciation schedule\b/i,
  /\bcumulative cashflow\b/i,
  /\bequity after\s+\d+\s+years?\b/i,
  /\bcapital growth (assumption|rate)\b/i,
];

const FORBIDDEN_PLACEHOLDERS = [
  /\[citation\]/i,
  /\[source\s+needed\]/i,
  /\[TBD\]/i,
  /\bcitation needed\b/i,
];

const SUBURB_KEYWORDS = [
  /\bSEIFA\b/,
  /\bschool catchment\b/i,
  /\bcrime statistics\b/i,
  /\bflood (zone|risk)\b/i,
  /\bbushfire\b/i,
  /\bdemograph/i,
  /\binfrastructure pipeline\b/i,
  /\bzoning overlay\b/i,
];

function parseH2(markdown: string): string[] {
  const matches = markdown.match(/^##\s+(.+?)\s*$/gm) ?? [];
  return matches.map((m) => m.replace(/^##\s+/, '').trim());
}

function normalize(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findDef(heading: string, registry: CompassSectionDefinition[]) {
  const target = normalize(heading);
  return registry.find(
    (s) =>
      normalize(s.name) === target ||
      s.sourceHeadings.some((sh) => normalize(sh) === target),
  );
}

function splitBySections(markdown: string): { heading: string; body: string }[] {
  const lines = markdown.split('\n');
  const out: { heading: string; body: string }[] = [];
  let current: { heading: string; body: string } | null = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (current) out.push(current);
      current = { heading: m[1].trim(), body: '' };
    } else if (current) {
      current.body += line + '\n';
    }
  }
  if (current) out.push(current);
  return out;
}

export function runQAValidation(
  markdown: string,
  tier: 'compass-40' | 'financial-analysis',
): QAReport {
  const findings: QAFinding[] = [];
  const registry =
    tier === 'compass-40' ? COMPASS_40_SECTIONS : FINANCIAL_ANALYSIS_SECTIONS;
  const wordCount = countWords(markdown);
  const estimatedPages = estimatePages(markdown);

  // Rule 1 — page band
  const band =
    tier === 'compass-40' ? COMPASS_PAGE_BAND : { min: 18, max: 22 };
  if (estimatedPages < band.min) {
    findings.push({
      rule: 'page-band',
      severity: 'warning',
      message: `Estimated ${estimatedPages} pages, below target min ${band.min}.`,
    });
  } else if (estimatedPages > band.max) {
    findings.push({
      rule: 'page-band',
      severity: 'error',
      message: `Estimated ${estimatedPages} pages, exceeds target max ${band.max}.`,
    });
  }

  // Rule 2 — financial exclusion (Compass only)
  if (tier === 'compass-40') {
    for (const pat of FINANCIAL_KEYWORDS) {
      if (pat.test(markdown)) {
        findings.push({
          rule: 'financial-exclusion',
          severity: 'error',
          message: `Compass contains financial content matching ${pat}. Move to Financial Analysis Report.`,
        });
      }
    }
  }

  // Rule 2b — forbidden placeholders / unresolved citations (both tiers)
  for (const pat of FORBIDDEN_PLACEHOLDERS) {
    if (pat.test(markdown)) {
      findings.push({
        rule: 'forbidden-placeholder',
        severity: 'error',
        message: `Report contains unresolved placeholder matching ${pat}. Replace with a real source reference or remove and consolidate into the source appendix.`,
      });
    }
  }

  // Rule 2c — no editorial commentary label survives, in any of its three forms.
  //
  // This replaces the v2.0 pair of decision-box rules, which counted only
  // `^#{2,4} what this means` and so found 11 of the 5,043 labels in the
  // production corpus. It shares its matcher with the post-processor that does
  // the removing, so the check and the fix cannot disagree about what a label is.
  const survivingLabels = findEditorialLabels(markdown);
  if (survivingLabels.length > 0) {
    const sample = survivingLabels.slice(0, 5).join(' / ');
    findings.push({
      rule: 'editorial-label',
      severity: 'error',
      message:
        `Report contains ${survivingLabels.length} editorial commentary label(s) — e.g. ${sample}. ` +
        'State the finding in the sentence introducing the data instead.',
    });
  }

  // Rule 3 — suburb-narrative exclusion (Financial only)
  if (tier === 'financial-analysis') {
    for (const pat of SUBURB_KEYWORDS) {
      if (pat.test(markdown)) {
        findings.push({
          rule: 'suburb-exclusion',
          severity: 'warning',
          message: `Financial report contains suburb-narrative content matching ${pat}.`,
        });
      }
    }
  }

  // Rule 4 — duplicate H2 headings
  const h2s = parseH2(markdown);
  const seen = new Map<string, number>();
  for (const h of h2s) {
    const k = normalize(h);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const [k, count] of seen) {
    if (count > 1) {
      findings.push({
        rule: 'duplicate-h2',
        severity: 'error',
        message: `Heading "${k}" appears ${count} times.`,
      });
    }
  }

  // Rules 5–7 — per-section checks
  const sections = splitBySections(markdown);
  for (const sec of sections) {
    const def = findDef(sec.heading, registry);
    if (!def) continue;

    // 7 — per-section word cap
    const w = countWords(sec.body);
    if (def.maxWordCount > 0 && w > def.maxWordCount * 1.1) {
      findings.push({
        rule: 'word-cap',
        severity: 'warning',
        sectionId: def.id,
        message: `Section "${sec.heading}" has ${w} words, over cap ${def.maxWordCount}.`,
      });
    }

    // 8 — heading density. 68 H3s a report across 17 sections was the
    // structural half of the noise; the prompt asks for at most four.
    const h3 = (sec.body.match(/^###\s+/gm) ?? []).length;
    if (h3 > MAX_SUBHEADINGS_PER_SECTION) {
      findings.push({
        rule: 'subheading-density',
        severity: 'warning',
        sectionId: def.id,
        message: `Section "${sec.heading}" has ${h3} sub-headings (max ${MAX_SUBHEADINGS_PER_SECTION}).`,
      });
    }
  }

  // 6 — Protected sections must be present (Compass only)
  if (tier === 'compass-40') {
    const presentDefs = new Set(
      sections.map((s) => findDef(s.heading, registry)?.id).filter(Boolean),
    );
    for (const protectedId of PROTECTED_SECTION_IDS) {
      if (!presentDefs.has(protectedId)) {
        findings.push({
          rule: 'missing-protected-section',
          severity: 'error',
          sectionId: protectedId,
          message: `Required Protected section "${protectedId}" missing from Compass report.`,
        });
      }
    }
  }

  const passed = findings.every((f) => f.severity !== 'error');
  return { tier, estimatedPages, wordCount, passed, findings };
}
