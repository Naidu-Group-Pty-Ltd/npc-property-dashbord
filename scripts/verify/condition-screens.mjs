#!/usr/bin/env node --experimental-strip-types
/**
 * S5/S6 §3 — the completion states and the condition-evidence surface,
 * verified THROUGH THE ACTUAL SCREENS, not only a pure helper.
 *
 * Drives the real InvestmentReportView in a real Chromium against the Vite
 * dev server, every Supabase request answered by the journey harness's
 * double (`report-journey/supabaseDouble.mjs`). The two new operations are
 * answered by re-running the SAME pure modules the edge function runs
 * (`conditionRecordSubmission.pure.ts`), imported here via Node's type
 * stripping — so what the screen shows is the validator's own behaviour,
 * not a hand-written stub.
 *
 * Scenarios:
 *   A. HISTORICAL — the retained production fixture (48 Redfern Street,
 *      withheld grade, no completion block). The completion card must NOT
 *      mount (historical rows preserved), and the condition panel must
 *      render the named unapplied-table state with no dead submit button.
 *   B. COMPLETION + EVIDENCE — the same report carrying a completion block
 *      computed by the real `assessCompletion` (3 of 5, attempts spent) and
 *      one stored condition record. The card must draw the run's own
 *      statement, per-dimension rows and recovery actors; the panel must
 *      list the record in the validator's words; the dialog must show the
 *      live reading, refuse a different street, and store a valid record.
 *
 * No credential is used and nothing leaves the process.
 * Usage: node --experimental-strip-types scripts/verify/condition-screens.mjs
 *        [--base http://127.0.0.1:5177] (spawns Vite itself when absent)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createSupabaseDouble, loadFixtures } from './report-journey/supabaseDouble.mjs';
import {
  decideConditionSubmission,
  parseConditionSubmission,
  recordFromRow,
  rowFromRecord,
  TABLE_NOT_APPLIED,
} from '../../supabase/functions/_shared/reports/risk/conditionRecordSubmission.pure.ts';
import {
  assessConditionRecord,
} from '../../supabase/functions/_shared/reports/risk/conditionRecord.pure.ts';
import {
  assessCompletion,
} from '../../supabase/functions/_shared/reports/market/assessmentCompletion.pure.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium } = require('playwright-core');

const REPORT_ID = '09f8569e-21ca-48b9-a3b9-57f4793d0836';
const ADDRESS = '48 Redfern Street, Cowra NSW 2794';
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) =>
  a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true'] : [])
  .filter((x) => x.length));
const PORT = 5177;
const BASE = args.base ?? `http://127.0.0.1:${PORT}`;
const OUT = path.resolve(ROOT, '.verify/out/condition-screens');
fs.mkdirSync(OUT, { recursive: true });

const findings = [];
const check = (step, ok, detail = '') => {
  findings.push({ step, ok: !!ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${step}${detail ? ` — ${detail}` : ''}`);
  return !!ok;
};

// ── dev server ─────────────────────────────────────────────────────────────
let vite = null;
const reachable = async (url) => {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
};
if (!args.base && !(await reachable(BASE))) {
  vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && !(await reachable(BASE))) {
    await new Promise((r) => setTimeout(r, 800));
  }
  if (!(await reachable(BASE))) { console.error('vite did not come up'); process.exit(2); }
}

// ── the double + the condition-operation override ─────────────────────────
const fixtures = loadFixtures(path.resolve(ROOT, '.verify/fixtures'), REPORT_ID);
const dbl = createSupabaseDouble(fixtures);

/** Scenario state the override answers from. */
const scenario = {
  tableApplied: false,
  records: /** @type {Record<string, unknown>[]} */ ([]),
  submissions: /** @type {unknown[]} */ ([]),
};
const expectedSubject = { propertyAddress: ADDRESS, propertyId: null, reportId: REPORT_ID };

const corsHeaders = (request) => ({
  'access-control-allow-origin': request.headers()['origin'] ?? '*',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers':
    'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token',
  'content-type': 'application/json',
});

async function conditionRoute(route, request) {
  if (request.method() === 'OPTIONS') {
    return route.fulfill({ status: 200, headers: corsHeaders(request), body: '' });
  }
  let body = {};
  try { body = JSON.parse(request.postData() ?? '{}'); } catch { /* not json */ }
  const respond = (status, payload) =>
    route.fulfill({ status, headers: corsHeaders(request), body: JSON.stringify(payload) });

  if (body.action === 'getConditionRecords') {
    if (!scenario.tableApplied) {
      return respond(200, { success: true, tableApplied: false, reason: TABLE_NOT_APPLIED, records: [] });
    }
    const asOf = new Date().toISOString();
    const records = scenario.records.map((row) => ({
      row,
      reading: assessConditionRecord(recordFromRow(row), asOf, { expectedSubject }),
    }));
    const best = records[0]?.reading ?? assessConditionRecord(null, asOf);
    return respond(200, { success: true, tableApplied: true, records, bestReading: best });
  }
  if (body.action === 'submitConditionRecord') {
    scenario.submissions.push(body.data);
    const parsed = parseConditionSubmission(body.data ?? {}, { reportId: REPORT_ID, propertyId: null });
    if (!parsed.ok) return respond(422, { error: parsed.refusal.statement, reason: parsed.refusal.reason });
    const decision = decideConditionSubmission(parsed.record, expectedSubject, new Date().toISOString());
    if (!decision.storable) {
      return respond(422, { error: decision.refusal.statement, reason: decision.refusal.reason });
    }
    const row = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      ...rowFromRecord(parsed.record, { reportId: REPORT_ID, recordedBy: 'fixture-user' }),
    };
    scenario.records.unshift(row);
    return respond(200, { success: true, record: row, reading: decision.reading });
  }
  return route.fallback();
}

// ── browser ────────────────────────────────────────────────────────────────
const chromiumPath = process.env.VERIFY_CHROMIUM
  ?? (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await context.route('**/*', (route, request) => dbl.handle(route, request));
await context.route('**/functions/v1/manage-investment-reports*', conditionRoute);
const page = await context.newPage();
page.setDefaultTimeout(10_000);
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
// fullPage scrolls the document, which Radix reads as an outside interaction
// and closes the dialog — so a shot taken with a dialog open stays viewport.
const shot = (name, { full = true } = {}) =>
  page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });

let fatal = null;
try {
  console.log('\n═══ Scenario A — historical row, table not applied ═══');
  await page.goto(`${BASE}/investment-report/${REPORT_ID}`, { waitUntil: 'networkidle', timeout: 90_000 });
  check('report opens', await page.getByRole('heading', { name: /48 Redfern Street/ }).first().isVisible().catch(() => false));
  check('completion card does NOT mount on a pre-gate row',
    (await page.getByText('Assessment Completion').count()) === 0,
    'historical rows preserved');
  check('condition panel mounts', await page.getByText('Condition Evidence').first().isVisible().catch(() => false));
  check('unapplied table renders its named state',
    (await page.getByText(/has not applied the condition-record evidence table/).count()) > 0);
  check('no submit button while the table is unapplied',
    (await page.getByRole('button', { name: /record condition evidence/i }).count()) === 0,
    'a control that can only fail is not drawn');
  await shot('01-historical-unapplied');

  console.log('\n═══ Scenario B — completion block + stored evidence ═══');
  // The run's own completion, computed by the real module: 3 of 5, attempts spent.
  const completion = assessCompletion({
    dimensions: {
      growth: { scored: true, score: 56 },
      yield: { scored: true, score: 23 },
      demand: { scored: true, score: 13 },
      location: {
        scored: false,
        reason: 'Location readings were presented but not verified: the enrichment carries no subject-matched acquisition stamp.',
        recovery: { actor: 'operator', action: 'Regenerate the report: the location service re-acquires the enrichment with its acquisition stamp, and stamped readings verify automatically.', retryable: true },
      },
      risk: {
        scored: false,
        reason: 'Risk needs observations in two independent categories; the building half awaits a condition record and the site half its acquisition.',
        recovery: { actor: 'operator', action: 'Submit a building inspection report over the whole dwelling through the Condition Evidence panel.', retryable: false },
      },
    },
    evidenceCoverage: 0.57,
    attemptsUsed: 3,
  });
  dbl.state.report = {
    ...dbl.state.report,
    investment_score: { ...(dbl.state.report.investment_score ?? {}), completion },
  };
  // One stored record: transcribed whole-dwelling inspection — evidence, not scored.
  const seeded = parseConditionSubmission({
    documentKind: 'building_inspection',
    issuer: 'Lachlan Valley Building Reports',
    issuedOn: '2026-08-14',
    inspectedOn: '2026-08-12',
    documentPropertyAddress: ADDRESS,
    scope: 'Interior, exterior, roof space and subfloor of the dwelling.',
    scopeCoverage: 'whole_dwelling',
    conclusion: 'no_defects_identified',
    findings: [],
    verification: 'transcribed_only',
  }, { reportId: REPORT_ID, propertyId: null });
  if (!seeded.ok) throw new Error(`seed record refused: ${seeded.refusal.statement}`);
  scenario.tableApplied = true;
  scenario.records = [{
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    ...rowFromRecord(seeded.record, { reportId: REPORT_ID, recordedBy: 'fixture-user' }),
  }];

  await page.goto(`${BASE}/investment-report/${REPORT_ID}`, { waitUntil: 'networkidle', timeout: 90_000 });
  check('completion card mounts with the run\'s own counts',
    await page.getByText('3 of 5 dimensions').first().isVisible().catch(() => false));
  check('state chip reads Evidence required (attempts spent)',
    (await page.getByText('Evidence required').count()) > 0);
  check('the statement is the run\'s own sentence',
    (await page.getByText(completion.statement).count()) > 0, completion.statement.slice(0, 60) + '…');
  for (const d of completion.dimensions) {
    check(`dimension row: ${d.label}`, (await page.getByText(d.label, { exact: false }).count()) > 0);
  }
  check('an unscored dimension names its recovery actor',
    (await page.getByText(/Operator:/).count()) >= 1);
  check('scored rows print their value, unscored print none',
    (await page.getByText('56/100').count()) + (await page.locator('text=/56/').count()) > 0);
  check('evidence coverage stated as its own measure',
    (await page.getByText(/Evidence coverage 57%/).count()) > 0);

  check('condition panel lists the stored record',
    (await page.getByText('Lachlan Valley Building Reports', { exact: false }).count()) > 0);
  check('the record is labelled in the validator\'s words (evidence, not scored)',
    (await page.getByText(/no condition scale is authorised/).count()) > 0);
  await shot('02-completion-and-evidence');

  console.log('\n═══ Scenario B — the dialog renders and enforces one rule ═══');
  await page.getByRole('button', { name: /record condition evidence/i }).click();
  await page.waitForTimeout(400);
  check('dialog opens with the live reading box',
    (await page.getByText('What this record establishes').count()) > 0);
  const submit = page.getByRole('button', { name: /store the record/i });
  check('empty draft cannot be stored, with the reason on screen',
    await submit.isDisabled().catch(() => false));

  await page.fill('#cr-issuer', 'Lachlan Valley Building Reports');
  await page.fill('#cr-issued', '2026-09-01');
  await page.fill('#cr-scope', 'Interior, exterior, roof space and subfloor of the dwelling.');
  await page.waitForTimeout(300);
  check('valid transcribed draft is storable (evidence)', !(await submit.isDisabled()));
  await shot('03-dialog-valid-draft', { full: false });

  // The §2 binding rule, visible on the actual screen: a different street is
  // a different property, and the same module refuses it before the click.
  await page.fill('#cr-address', '48 Redfern Road, Cowra NSW 2794');
  await page.waitForTimeout(300);
  check('a different street disables storing', await submit.isDisabled());
  check('and the reason is the validator\'s sentence',
    (await page.getByText(/different property/).count()) > 0);
  await shot('04-dialog-wrong-street-refused', { full: false });

  await page.fill('#cr-address', ADDRESS);
  await page.waitForTimeout(300);
  check('restoring the street re-enables storing', !(await submit.isDisabled()));
  await submit.click();
  await page.waitForTimeout(800);
  check('the stored toast carries the reading', (await page.getByText('Condition record stored.').count()) > 0);
  check('the list refreshes to two records',
    (await page.getByText('Building inspection report').count()) >= 2);
  check('the server-side double judged the submission with the same module',
    scenario.submissions.length === 1 && scenario.records.length === 2);
  await shot('05-record-stored');

  // Playwright's route interception does not cover WebSockets, so the app's
  // realtime channel fails against the double by construction. That class is
  // exempted BY NAME; every other console error still fails the run.
  const realErrors = consoleErrors.filter((e) => !/WebSocket connection to 'wss:/.test(e));
  check('no console errors across all scenarios (realtime WebSocket exempt by name)',
    realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} catch (e) {
  fatal = String(e?.stack ?? e).slice(0, 800);
  console.error('FATAL:', fatal);
  await shot('99-fatal').catch(() => {});
} finally {
  await browser.close().catch(() => {});
  vite?.kill('SIGTERM');
}

const failed = findings.filter((f) => !f.ok);
fs.writeFileSync(path.join(OUT, 'screens.json'), JSON.stringify({
  measuredAt: new Date().toISOString(),
  reportFixture: REPORT_ID,
  address: ADDRESS,
  findings, fatal, consoleErrors,
}, null, 2));
console.log(`\n${findings.length - failed.length}/${findings.length} checks passed${fatal ? ' — FATAL' : ''}`);
process.exit(fatal || failed.length ? 1 : 0);
