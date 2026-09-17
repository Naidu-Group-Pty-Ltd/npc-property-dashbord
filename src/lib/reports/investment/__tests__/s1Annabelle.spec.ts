/**
 * S1 — the Annabelle document, rendered from its stored row.
 *
 * Not a fixture. This loads `reports/fixtures/annabelle-row.json`, which is the
 * production row for report `9bd41c05-7f9b-41e8-819a-a029f4121369` exported
 * read-only, and drives it through the same two calls the Templates workflow
 * uses — `buildInvestmentReport` then `renderInvestmentFromBrand`. The point is
 * that the six representative pages are judged on the real record rather than
 * on prose written to make a renderer look good.
 *
 * Writes `reports/html/s1-annabelle.html` for WeasyPrint. Nothing here asserts
 * design; the assertions are the ones that would make the artefact worthless
 * if they failed — that it is the right report, and that it drew something.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { writeRenderArtifact } from '../../__tests__/renderArtifact';
import { buildInvestmentReport } from '../normalise.pure';
import { renderInvestmentFromBrand } from '../render.pure';
import { buildReportBrandSnapshot } from '@/lib/reportDesign/snapshot.pure';

const ROW = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../../reports/fixtures/annabelle-row.json'), 'utf8'),
) as Record<string, unknown>;

const PREPARED_ON = '2026-09-17';

const { snapshot } = buildReportBrandSnapshot({
  contact: {
    company_name: 'Naidu Property Consulting Services',
    abn: '50 684 555 771',
    email: 'admin@npcservices.com.au',
    phone: '02 8609 3299',
  },
  capturedAt: PREPARED_ON,
} as never);

let html = '';

beforeAll(() => {
  const built = buildInvestmentReport({ row: ROW, preparedOn: PREPARED_ON });
  if (built.ok === false) throw new Error(`normalise failed: ${built.error}`);
  const out = renderInvestmentFromBrand({
    report: built.report,
    snapshot,
    projectionsRaw: (ROW.financial_calculations as Record<string, unknown> | null)?.projections ?? null,
  });
  html = out.html;
  writeRenderArtifact('s1-annabelle', html);
  // eslint-disable-next-line no-console
  console.log(`S1: ${html.length} bytes, chapters: ${out.chapters.length}`);
  // eslint-disable-next-line no-console
  console.log(`S1 chapters: ${out.chapters.join(' | ')}`);
});

describe('the S1 artefact is the Annabelle report', () => {
  it('carries the subject address', () => {
    expect(html).toContain('Annabelle');
  });

  it('is not empty', () => {
    expect(html.length).toBeGreaterThan(20_000);
  });
});
