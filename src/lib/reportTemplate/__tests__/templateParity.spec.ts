/**
 * Which report types may be drawn through a template, and what a person is
 * told about the rest (`templateParity.pure.ts`).
 *
 * The owner's rule (26 Sep 2026): a template changes the layout of a document
 * and nothing else. On 26 Sep 2026 none of the nine non-Investment report
 * types carried the same information through a template as through its
 * standard document, so each is held on its standard document until its parity
 * check passes. This file holds the register to three things:
 *
 *   - **Only Investment is released today**, and a report type joins only by
 *     editing the one register, never by a surface deciding for itself.
 *   - **Every format the chooser offers is accounted for**: released, or held
 *     and saying so. A format added to the adapter registry is held until it
 *     is released, because the register fails closed.
 *   - **The words are plain**: what happens today, that the choice is kept,
 *     and when it applies. No internal term reaches the person.
 */
import { describe, expect, it } from 'vitest';
import {
  isTemplateDeliveryHeld,
  TEMPLATE_HOLD_NOTICE,
  TEMPLATE_RELEASED_REPORT_TYPES,
  templateHoldExplanation,
} from '../../../../supabase/functions/_shared/reports/templateParity.pure';
import { normaliseReportType } from '../../../../supabase/functions/_shared/reports/reportTemplateSelection.pure';
import { listReportFormats } from '../reportFormats';

describe('the release register', () => {
  it('releases the Investment tiers and nothing else, today', () => {
    expect([...TEMPLATE_RELEASED_REPORT_TYPES]).toEqual(['investment']);
  });

  it('names report types by their canonical key only', () => {
    for (const key of TEMPLATE_RELEASED_REPORT_TYPES) expect(normaliseReportType(key)).toBe(key);
  });

  it('releases Investment under every spelling it is stored under', () => {
    for (const alias of ['investment', 'investment_compass', 'compass', 'investment_report', 'property_investment', 'INVESTMENT']) {
      expect(isTemplateDeliveryHeld(alias), alias).toBe(false);
    }
  });

  it('holds every other format the chooser offers, under every spelling', () => {
    const offered = listReportFormats().map((f) => f.reportType);
    expect(offered).toContain('investment');
    for (const type of offered.filter((t) => t !== 'investment')) {
      expect(isTemplateDeliveryHeld(type), type).toBe(true);
    }
    for (const alias of ['cash_flow', 'formara', 'clientdetails', 'commercial_industrial', 'borrowing']) {
      expect(isTemplateDeliveryHeld(alias), alias).toBe(true);
    }
  });

  it('fails closed: a spelling it does not know is held, not released', () => {
    for (const unknown of ['', null, undefined, 'a_format_added_tomorrow']) {
      expect(isTemplateDeliveryHeld(unknown), String(unknown)).toBe(true);
    }
  });
});

describe('what a person is told', () => {
  const words = [
    TEMPLATE_HOLD_NOTICE.title,
    TEMPLATE_HOLD_NOTICE.description,
    templateHoldExplanation('Portfolio Performance Review'),
  ];

  it('says what happens today, that the choice is kept, and when it applies', () => {
    expect(TEMPLATE_HOLD_NOTICE.title).toMatch(/standard layout/);
    expect(TEMPLATE_HOLD_NOTICE.description).toMatch(/choice is kept/);
    expect(TEMPLATE_HOLD_NOTICE.description).toMatch(/applies as soon as/);
    expect(templateHoldExplanation('Portfolio Performance Review'))
      .toMatch(/^Portfolio Performance Review reports use the standard layout/);
  });

  it('speaks the reader\'s language, not the system\'s', () => {
    for (const text of words) {
      expect(text).not.toMatch(/parity|register|adapter|binding|master|schema|held\b|_/i);
    }
  });
});
