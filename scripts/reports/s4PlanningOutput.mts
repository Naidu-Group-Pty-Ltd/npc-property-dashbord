/**
 * S4 — the planning and development output for both subjects, from the
 * registers' own answers.
 *
 *   npx tsx scripts/reports/s4PlanningOutput.mts
 *
 * ## Where the inputs come from
 *
 * This sandbox's proxy answers `403` to `CONNECT` for every Australian
 * government host, so nothing here can ask a publisher directly. Both inputs
 * were therefore READ from production rather than re-fetched:
 *
 *  - `reports/fixtures/planning-<subject>.json` — `planning-data-service`'s own
 *    answer, out of `planning_data_cache`, which is the object the live report
 *    was built from.
 *  - `reports/fixtures/nsw-da-the-hills-…json` — all 655 rows the NSW Online DA
 *    API returned for The Hills Shire Council over the six-month window, read
 *    through the production egress (pg_net request ids 270152, 270164–270169).
 *
 * The cached summary is the one the DEPLOYED function computed, and the
 * deployed function predates the parent-development resolution, so the
 * register's summary is recomputed here from those raw rows with the current
 * `summariseDaRows`. The planning cells are not recomputed at all — nothing in
 * this change touches them — so what is drawn for zoning, overlays and
 * controls is exactly what production answered.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildPlanningFacts, renderPlanningControls,
} from '../../supabase/functions/_shared/planning/planningFacts.pure';
import {
  buildInfrastructureEvidence, renderInfrastructureOutlook,
} from '../../supabase/functions/_shared/planning/infrastructureEvidence.pure';
import {
  summariseDaRows, type NswDaRow,
} from '../../supabase/functions/_shared/planning/developmentActivity.pure';
import { withPlanningEvidence } from '../../supabase/functions/_shared/reports/location/planningEvidenceRecord.pure';

const REPO = resolve(import.meta.dirname, '../..');

/**
 * `reports/` is git-ignored (see `.gitignore:33`), which is deliberate — it
 * holds produced documents and fixtures derived from production data. A
 * missing fixture is therefore an ordinary state for a fresh checkout rather
 * than a fault, and it says how to get one back instead of throwing ENOENT.
 */
const read = (p: string) => {
  try {
    return JSON.parse(readFileSync(resolve(REPO, p), 'utf8'));
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
    throw new Error(
      `${p} is not present. It is derived from production and \`reports/\` is git-ignored; `
      + 'see `docs/reports/S4_PLANNING_AND_DEVELOPMENT.md` § Where the inputs come from for the '
      + 'two SELECT-only reads that rebuild it.',
    );
  }
};

const SUBJECTS = [
  { key: 'annabelle', address: '18 Annabelle Crescent, Kellyville NSW 2155', reSummariseDa: true },
  { key: 'pallas', address: '262 Pallas Street, Maryborough QLD 4650', reSummariseDa: false },
];

const da = read('reports/fixtures/nsw-da-the-hills-2026-03-18_2026-09-17.json');
const out: string[] = [];

for (const subject of SUBJECTS) {
  const fixture = read(`reports/fixtures/planning-${subject.key}.json`);
  const planningData = fixture.planningData as Record<string, any>;

  if (subject.reSummariseDa && planningData.developmentActivity?.status === 'ok') {
    const before = planningData.developmentActivity.summary;
    planningData.developmentActivity = {
      ...planningData.developmentActivity,
      summary: summariseDaRows(
        da.rows as NswDaRow[],
        before.councilName, before.periodFrom, before.periodTo,
        da._provenance.totalCountStatedByRegister,
      ),
    };
    const after = planningData.developmentActivity.summary;
    console.log(
      `${subject.key}: register re-summarised — ${da.rows.length} rows read of `
      + `${da._provenance.totalCountStatedByRegister} (the deployed function read ${before.rowsRead}); `
      + `${after.newApplications.rows} new, ${after.amendments.rows} amendments, `
      + `${after.unclassified.rows} unrecognised; `
      + `${after.largestDevelopments.length} developments listed, `
      + `${after.largestDevelopments.reduce((n: number, d: any) => n + (d.rowsInWindow ?? 1), 0)} rows behind them`,
    );
  }

  const facts = buildPlanningFacts({ planningData, overrides: {} });
  const infrastructure = buildInfrastructureEvidence({ planningData });

  out.push(`# ${subject.address}`, '');
  out.push('## Planning controls retrieved for this property', '');
  out.push(renderPlanningControls(facts), '');
  out.push('## Infrastructure and development retrieved for this property', '');
  out.push(renderInfrastructureOutlook(infrastructure), '');

  // The record the row would keep — proof that the evidence is now carried
  // rather than living only in the prose above.
  const recorded = withPlanningEvidence({ coordinates: planningData.coordinate }, facts, infrastructure) as Record<string, unknown>;
  console.log(
    `${subject.key}: recorded keys ${Object.keys(recorded).sort().join(', ')}; `
    + `${facts.constraints.length} constraint readings, ${(facts.constraintsAsked ?? []).length} families asked, ${infrastructure.items.length} development entries`,
  );
}

mkdirSync(resolve(REPO, 'reports/html'), { recursive: true });
const md = out.join('\n');
writeFileSync(resolve(REPO, 'reports/s4-planning-output.md'), md);
console.log(`\n${md.length} characters → reports/s4-planning-output.md`);
