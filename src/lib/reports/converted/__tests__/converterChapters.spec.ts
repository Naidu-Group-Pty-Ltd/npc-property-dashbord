/**
 * The converter's chapter list must be the renderer's chapter list.
 *
 * `FORMAT_CHAPTERS` is the only place in the programme where a format's chapters
 * are written down twice — the renderer builds them from a payload, and the
 * converter has no payload yet, so it needs them declared. Two copies of the
 * same truth drift, and this one already did: the first version listed
 * `Position Summary`, `Income`, `Commitments`, `Serviceability`,
 * `Capacity & Scenarios`, `Assumptions`, `Next Steps` — seven noun phrases
 * lifted from the archetype's description, not one of which the renderer prints.
 *
 * The cost was measured on a real conversion: a Borrowing Capacity Snapshot
 * bound 3 of 7 chapters and sent 3 sections to an appendix, because the
 * document's chapters are editorial sentences (`Capacity at a glance`) and the
 * list was functional labels (`Position Summary`). Nothing failed loudly. The
 * review screen showed a plausible binding of the wrong things.
 *
 * So this file compares the two directly. It is deliberately in its own spec
 * rather than in `converter.spec.ts`, because it is the only reason the
 * converter tests need to import the Borrowing Capacity payload and fixtures at
 * all, and because when it fails the message should be about drift, not about
 * binding.
 */
import { describe, expect, it } from 'vitest';

import { buildSnapshot } from '../../borrowingCapacity/normalise.pure';
import { snapshotSections } from '../../borrowingCapacity/sections.pure';
import { DOCUMENT_NAME } from '../../borrowingCapacity/render.pure';
import {
  SAMPLE_ASSESSMENT,
  SAMPLE_AUDIT_TRAIL,
  SAMPLE_CLIENT_NAME,
  SAMPLE_EXPLANATION,
  SAMPLE_SCENARIO_PRESETS,
} from '../../borrowingCapacity/__tests__/fixtures/sampleAssessment';
import { bindableFormats, FORMAT_CHAPTERS, formatName } from '../binding.pure';

/** Every conditional section present, so the list is the longest it can be. */
const full = buildSnapshot({
  clientName: SAMPLE_CLIENT_NAME,
  assessment: SAMPLE_ASSESSMENT,
  auditTrail: SAMPLE_AUDIT_TRAIL,
  explanation: SAMPLE_EXPLANATION,
  scenarioPresets: SAMPLE_SCENARIO_PRESETS,
});
const minimal = buildSnapshot({ clientName: 'Nobody', assessment: {} });

describe('borrowing capacity chapters', () => {
  it('is exactly what the renderer prints, in the same order', () => {
    expect([...(FORMAT_CHAPTERS['borrowing-capacity'] ?? [])])
      .toEqual(snapshotSections(full).map((s) => s.title));
  });

  it('offers the conditional chapters too, so a template can fill them', () => {
    // The renderer emits the last three only when the payload carries an
    // explanation, an audit or scenarios. The converter offers them regardless:
    // an unfilled chapter is a state the document already handles, and a
    // template that *does* have an audit section should be able to bind it.
    const always = snapshotSections(minimal).map((s) => s.title);
    const chapters = FORMAT_CHAPTERS['borrowing-capacity'] ?? [];
    for (const title of always) expect(chapters, title).toContain(title);
    expect(chapters.length).toBeGreaterThan(always.length);
  });

  it('names the document what the cover will actually say', () => {
    // The archetype's `documentName` is "Borrowing Capacity Assessment" and the
    // cover prints "Borrowing Capacity Snapshot". The review screen is telling a
    // person what they are about to get, so it has to say the printed one.
    expect(formatName('borrowing-capacity')).toBe(DOCUMENT_NAME);
  });

  it('only offers formats it has real chapters for', () => {
    for (const format of bindableFormats()) {
      expect((FORMAT_CHAPTERS[format] ?? []).length, format).toBeGreaterThan(0);
    }
  });
});
