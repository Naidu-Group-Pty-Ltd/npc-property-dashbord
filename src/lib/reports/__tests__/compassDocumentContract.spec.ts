/**
 * The contract the Compass is written against — and the legacy template it
 * replaced.
 *
 * Measured on 17 Sep 2026: `propertyPrompt` was 79,603 bytes and **76,415 of
 * them (96%) were the legacy 38-page reference template**, carried verbatim
 * under "MANDATORY REPORT STRUCTURE — 38-PAGE REFERENCE TEMPLATE / YOU MUST
 * FOLLOW THIS EXACT STRUCTURE, LENGTH, AND FORMAT". The remaining 3,188 bytes
 * were the property's own facts.
 *
 * That template is a different document: 27 sections including *Purchase &
 * Ongoing Costs*, *Rental Assessment & Yield Calculation*, *Loan Structure &
 * Repayment Analysis*, *Cashflow Analysis* and *Sensitivity Analysis* — the
 * financial modelling the Compass is defined by NOT carrying — demanding
 * "12,000-15,000 words minimum" against a registry that capped the document at
 * 5,010. It is written as fill-in-the-blanks and its point 8 instructs the
 * model to "Include [citation] markers", which another line of the same prompt
 * forbids and a regex downstream strips.
 *
 * `generateReportSection` trims head-tail, so both ends of every trim were
 * legacy: the model received about 53 KB of the wrong contract on each of the
 * eleven section calls.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  COMPASS_DOCUMENT_CONTRACT,
  compassDocumentContract,
} from '../../../../supabase/functions/_shared/reports/investment/compassDocumentContract.pure';

const GEN = 'supabase/functions/generate-investment-report/index.ts';
const source = () => readFileSync(GEN, 'utf8');

/** `propertyPrompt`'s own text, from its opening backtick to its close. */
function propertyPrompt(): string {
  const s = source();
  const open = s.indexOf('const propertyPrompt = `');
  expect(open, 'propertyPrompt must exist').toBeGreaterThan(0);
  const rest = s.slice(open);
  const close = rest.indexOf('\n\n    // Select the appropriate prompt based on report scope');
  expect(close, 'propertyPrompt must close').toBeGreaterThan(0);
  return rest.slice(0, close);
}

describe('the legacy 38-page template is gone from the live prompt', () => {
  it('names no reference template and demands no page or word count', () => {
    const p = propertyPrompt();
    expect(p).not.toContain('38-PAGE REFERENCE TEMPLATE');
    expect(p).not.toContain('MANDATORY REPORT STRUCTURE');
    expect(p).not.toMatch(/12,000-15,000 words/);
    expect(p).not.toMatch(/EXACT structure, length, and format/i);
  });

  it('carries none of the financial sections the Compass must not hold', () => {
    const p = propertyPrompt();
    for (const heading of [
      '# Purchase & Ongoing Costs',
      '# Rental Assessment & Yield Calculation',
      '# Loan Structure & Repayment Analysis',
      '# Cashflow Analysis',
      '# Sensitivity Analysis',
      '# 10-Year Investment Projections',
      'PRE-CALCULATED ANNUAL COSTS',
      'PRE-CALCULATED FINANCIAL VALUES',
    ]) {
      expect(p, heading).not.toContain(heading);
    }
  });

  it('asks for no citation markers, and no bracketed placeholders', () => {
    const p = propertyPrompt();
    // Point 8 of the legacy formatting requirements: "Include [citation]
    // markers where data is sourced from external references" — while another
    // line of the same prompt forbade them and a regex stripped them.
    expect(p).not.toMatch(/Include \[citation\] markers/);
    // The fill-in-the-blank shapes the model reproduced into client documents.
    for (const shape of ['[Suburb name]', '[School Name]', '[Station Name]', '[XX]', '[X.X]', 'X,XXX,XXX']) {
      expect(p, shape).not.toContain(shape);
    }
  });

  it('is an order of magnitude smaller, so nothing is trimmed away', () => {
    /*
     * The trim is head-tail at `PERPLEXITY_SAFE_USER_MESSAGE_BYTES` (70,000),
     * so at 79,603 bytes the model lost the middle of the prompt on every
     * section call and kept the legacy template's two ends. The whole prompt
     * now fits, which means the evidence pack reaches every section intact.
     */
    expect(Buffer.byteLength(propertyPrompt(), 'utf8')).toBeLessThan(20_000);
  });

  it('injects the contract from the shared module rather than restating it', () => {
    expect(source()).toContain("import { compassDocumentContract } from '../_shared/reports/investment/compassDocumentContract.pure.ts'");
    expect(propertyPrompt()).toContain('${compassDocumentContract(_brandPp.companyName)}');
  });
});

describe('the evidence pack is what the report may state', () => {
  const p = propertyPrompt();

  it('carries every retrieved evidence block', () => {
    for (const block of [
      'planningStatBlocks(enhancedData)',
      'regionalTrendBlocks(enhancedData)',
      'macroEconomicBlock(enhancedData)',
      'demographicsStatBlocks(enhancedData)',
      'climateStatBlocks(enhancedData)',
      'crimeStatBlocks(enhancedData)',
      'reconcileNearestSchool(',
      'reconcileSchoolDistances(',
    ]) {
      expect(p, block).toContain(block);
    }
  });

  it('states an absent register as a fact about the CHECK', () => {
    // The rule every absence in this product answers to. A category nobody
    // reached must never read as a category with nothing in it.
    expect(p).toMatch(/No school register reading was retrieved/);
    expect(p).toMatch(/No amenity reading was retrieved/);
    expect(p).toMatch(/No public-transport reading was retrieved/);
    expect(p).toMatch(/do NOT describe[\s\S]{0,12}the area as well or poorly served/);
  });

  it('keeps a measured zero as a measurement', () => {
    // `absent is never zero` has a mirror: a reached-and-empty category IS a
    // finding, and a rural address with no hospital within five kilometres is
    // a fact worth printing.
    expect(p).toMatch(/A count of zero here is a measurement/);
  });

  it('states the price and the rent once, and forbids analysing them', () => {
    expect(p).toMatch(/\*\*Asking price:\*\*/);
    expect(p).toMatch(/may be stated ONCE, in the\s+property snapshot/);
    expect(p).toMatch(/no yield, no LVR, no loan, no\s+cash flow, no projection/);
  });
});

describe('the contract itself', () => {
  it('asks for a consequence, not a restatement', () => {
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/Every finding ends in a consequence/);
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/Never restate a table in a paragraph/);
    // The five labels the post-processor strips are named where the writing
    // happens, not only where it is cleaned up afterwards.
    for (const label of ['What This Means', 'Why This Matters', 'Key Takeaway', 'What To Watch', 'NPC View']) {
      expect(COMPASS_DOCUMENT_CONTRACT, label).toContain(label);
    }
  });

  it('says what depth is, because the legacy answer was length', () => {
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/Depth is not length/);
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/A retrieved fact they could not easily get themselves/);
  });

  it('shows the invented paragraph beside the evidenced one', () => {
    // The worked examples are the load-bearing part: a prohibition with no
    // demonstration of the permitted form is one a model routes around.
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/\*\*Thin —/);
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/\*\*Substantial —/);
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/\*\*Invented —/);
    // And it says WHY the invented one is dangerous, which is that it is
    // indistinguishable from the good one to the person acting on it.
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/the reader cannot\s+tell it from the paragraph above/);
  });

  it('keeps absence and clearance apart', () => {
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/An absence is not a clearance/);
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/Not screened is not clear/);
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/never as a fact about the property/);
  });

  it('forbids the modelling, the minted rating, the forecast and the placeholder', () => {
    const c = COMPASS_DOCUMENT_CONTRACT;
    expect(c).toMatch(/\*\*No financial modelling\.\*\*/);
    expect(c).toMatch(/\*\*No rating you invented, in any form\.\*\*/);
    expect(c).toMatch(/\*\*No forecast\.\*\*/);
    expect(c).toMatch(/\*\*No citation markers\*\*/);
    expect(c).toMatch(/never write "N\/A", "TBD", "\[XX\]"/);
  });

  it('puts the tenant’s own name in it and never leaves the token', () => {
    const filled = compassDocumentContract('Naidu Property Consulting Services');
    expect(filled).toContain('Naidu Property Consulting Services');
    expect(filled).not.toContain('{{COMPANY}}');
    // An unnamed tenant still reads as a sentence.
    expect(compassDocumentContract('   ')).toContain('your adviser');
    expect(compassDocumentContract('   ')).not.toContain('{{COMPANY}}');
  });

  it('is about method, never about structure', () => {
    /*
     * Two statements of a structure is how the two come to disagree — the
     * defect this module exists to remove. The section registry owns the
     * structure; this owns the standard.
     */
    const c = COMPASS_DOCUMENT_CONTRACT;
    expect(c).not.toMatch(/^# \d+\./m);
    expect(c).not.toMatch(/MUST FOLLOW THIS EXACT STRUCTURE/);
    expect(c).not.toMatch(/\bminimum\b.{0,20}\bwords\b/i);
  });
});
