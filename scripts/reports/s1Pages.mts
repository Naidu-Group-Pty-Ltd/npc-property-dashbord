/**
 * S1 — six representative pages, from the Annabelle record, on the Chancery master.
 *
 * Composed with the production block registry and rendered by
 * `compileTemplateHtmlForPdf`, which is the print contract `render-template-pdf`
 * applies before it invokes the engine. The tokens are Chancery's own, lifted
 * from the seeded master rather than restated, and the table treatment is the
 * one `tablePlan('ledger_hairline')` resolves for the Private Banking family,
 * so the palette, the type scale and the ruled statement are the ones the
 * Templates workflow would use.
 *
 * Every figure on these pages is read from the stored row. Where a value is
 * real but the PROJECTION does not publish it yet, the page carries a
 * provisional chip naming the stage that publishes it. Nothing is invented.
 *
 * ── Why this script measures before it lays out ──────────────────────────────
 *
 * Every block in this system is absolutely positioned, so a block that draws
 * one line taller than its author assumed does not overflow the page — it
 * prints over the block beneath it. `blocks.ts` records the same lesson from
 * the other side: `spacing.rowHeight` is a number no part of the renderer
 * reads, and trusting it put 45 blocks of the catalogue 33–52pt past their
 * reserved space.
 *
 * So nothing here is laid out from an assumed height. Pass one renders every
 * flowed block alone, on its own page, on its own ground, through the pinned
 * engine, and measures the ink. Pass two stacks them from those measurements
 * and asserts that no page's last block reaches the running foot.
 *
 *   npx tsx scripts/reports/s1Pages.mts
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { compileTemplateHtmlForPdf } from '../../src/lib/reportTemplate/compileTemplateForPdf';
import { applyInvestmentProjection } from '../../supabase/functions/_shared/reportBindingProjection.pure';
import { applyOrganisationProjection } from '../../supabase/functions/_shared/organisationProjection.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from '../template-library/investmentCompass/templates';

const REPO = resolve(import.meta.dirname, '../..');
const F = (p: string) => resolve(REPO, 'reports/fixtures', p);
mkdirSync(resolve(REPO, 'reports/html'), { recursive: true });
mkdirSync(resolve(REPO, 'reports/pdf'), { recursive: true });

const row = JSON.parse(readFileSync(F('annabelle-row.json'), 'utf8'));
const MARK = readFileSync(F('mark-monogram.txt'), 'utf8').trim();
const li = row.location_intelligence ?? {};
const score = row.investment_score ?? {};
const v2 = score.v2 ?? {};

// ── the binding context, through the production projection ──────────────────
const flat = (o: unknown) => (o && typeof o === 'object' ? { ...(o as object) } : {});
const data: Record<string, any> = {
  report: { id: row.id, type: 'investment', generated_at: row.updated_at },
  property: flat(row.property_specs),
  financials: flat(row.financial_calculations),
  scores: flat(row.investment_score),
  brand: { tokens: {}, logo: null },
};
applyInvestmentProjection(data, row);
applyOrganisationProjection(
  data,
  {
    company_name: 'Naidu Property Consulting Services',
    email_signature_phone: '02 8609 3299',
    email_signature_email: 'admin@npcservices.com.au',
    email_signature_website: 'npcservices.com.au',
    email_signature_address: 'Level 5 Nexus Norwest, 4 Columbia Ct, Norwest NSW 2153',
  } as never,
  { mark: MARK, markMono: MARK },
  {
    contact: {
      company_name: 'Naidu Property Consulting Services',
      abn: '50 684 555 771',
      email: 'admin@npcservices.com.au',
      phone: '02 8609 3299',
      address: 'Level 5 Nexus Norwest, 4 Columbia Ct, Norwest NSW 2153',
      website: 'www.npcservices.com.au',
    },
    disclaimer: { is_enabled: true, font_size: 'medium', text: readFileSync(F('disclaimer.txt'), 'utf8') },
  } as never,
);

// ── Chancery's own tokens ───────────────────────────────────────────────────
const chancery: any = INVESTMENT_COMPASS_TEMPLATES.find(
  (t: any) => String(t.slug ?? '').includes('-pb-01-'),
);
const TOKENS = chancery.schema.tokens;
const C = TOKENS.colors;
const PAD = TOKENS.spacing.padding;   // 57
const W = 595 - PAD * 2;              // 481
const FOOT_RULE = 786;                // the running foot's rule
const FLOOR = FOOT_RULE - 12;         // nothing flowed may reach this

/**
 * The Private Banking table treatment, verbatim.
 *
 * `tablePlan('ledger_hairline')` resolves to tracked column heads over a single
 * heavy rule, hairlines between rows, no outer border and an alternate-row
 * tint — a statement, not a filled band. Taken from the seeded Chancery master
 * rather than restated, so a change to the family reaches this document.
 */
const TABLE = {
  headerStyle: 'rule', headerBg: 'token:primary', headerFg: 'token:onPrimary',
  headerFont: 'token:mono', headerSize: 6, headerTracking: 0.1,
  numericFont: 'token:heading', rowRule: true, outerBorder: false,
  stripeBg: 'token:panel', cellFg: 'token:ink', borderColor: 'token:line',
  emphasisColor: 'token:ink', negativeColor: 'token:negative',
  fontSize: 8.5, cellPadding: 4.5,
};

// ── helpers ─────────────────────────────────────────────────────────────────
let n = 0;
const id = (t: string) => `s1-${t}-${++n}`;
const B = (type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ id: id(type), type, props: { x: PAD, width: W, ...props }, overlays: [], ...extra });

const eyebrow = (text: string, color = C.accentOnField) =>
  B('text-block', { body: text, bodySize: 6.5, bodyFont: 'token:mono', bodyTracking: 0.28, color });
const title = (text: string, size = 22, color = C.ink) =>
  B('text-block', { body: text, bodySize: size, bodyFont: 'token:heading', bodyLineHeight: 1.18, bodyTracking: -0.01, color });
const para = (text: string, opts: Record<string, unknown> = {}) =>
  B('text-block', { body: text, bodySize: 9.5, bodyFont: 'token:body', bodyLineHeight: 1.5, color: C.ink, ...opts });
const rule = (color = C.line, width = W) => B('divider', { color, thickness: 0.6, width });

/** The provisional chip. Names the stage that will publish the binding. */
const provisional = (stage: string, what: string) =>
  B('text-block', {
    body: `PROVISIONAL · ${stage}   ${what}`,
    bodySize: 6, bodyFont: 'token:mono', bodyTracking: 0.14, bodyLineHeight: 1.6, color: C.caution,
  });

/**
 * The interpretation callout, in Chancery's own treatment.
 *
 * The family declares `callout_style: 'tinted_gold_bar'` and `radius: '0'`, so
 * a tinted panel with a gold left bar and square corners is the design; the
 * block's own defaults are a 6pt radius and the legacy off-white, which is the
 * one element on the page that would ignore the colourway.
 *
 * `maxWords` is passed for the reason `blocks.ts` passes it: the 60-word
 * default silently truncates at word 61 and prints an ellipsis, and a
 * client-facing sentence that stops mid-clause is worse than a longer card.
 */
const callout = (heading: string, body: string) =>
  B('decision-box', {
    heading, body, maxWords: 130,
    accent: 'token:primary', bg: 'token:panel', color: 'token:ink',
    headingColor: 'token:accentInk', headingFont: 'token:mono',
    headingSize: 6.5, headingTracking: 0.18,
    bodyFont: 'token:body', bodySize: 9.5,
    radius: 0, barWidth: 2,
  });

const foot = (pageNo: string) => ([
  B('divider', { color: C.line, thickness: 0.6, width: W, y: FOOT_RULE }),
  B('text-block', { body: `18 Annabelle Crescent, Kellyville NSW 2155 · Investment Compass`, bodySize: 6.5, bodyFont: 'token:mono', bodyTracking: 0.12, color: C.muted, y: FOOT_RULE + 10, width: 340 }),
  B('text-block', { body: pageNo, bodySize: 6.5, bodyFont: 'token:mono', bodyTracking: 0.12, color: C.muted, y: FOOT_RULE + 10, x: PAD + W - 120, width: 120, align: 'right' }),
]);

// ── real values, read from the row ──────────────────────────────────────────
const amenities: any[] = Array.isArray(li.amenities) ? li.amenities : [];
const amen = (cat: string) => amenities.find((a) => a.category === cat) ?? {};
const km = (d: unknown) => (typeof d === 'number' ? `${d.toFixed(2)} km` : '—');
/** Small counts are spelled in prose, and a four-figure measurement is grouped. */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n: unknown) => (typeof n === 'number' && n <= 10 && n >= 0 ? WORDS[n] : String(n));
const grouped = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('en-AU') : String(n));
const schools: any[] = li.schools?.topSchools ?? [];
const stops: any[] = li.transport?.detailedStops ?? [];
const nearestStopMetres = Math.round(stops[0]?.metres ?? 0);

const dims = [
  { key: 'growth', label: 'Capital growth' },
  { key: 'location', label: 'Location' },
  { key: 'yield', label: 'Rental return' },
  { key: 'demand', label: 'Market demand' },
  { key: 'risk', label: 'Property risk' },
].map((d) => {
  const rec = (v2.dimensions ?? []).find((x: any) => x.key === d.key) ?? {};
  const gap = (score.gradeGaps ?? []).find((g: any) => g.dimension === d.key);
  return { ...d, ...rec, reason: gap?.reason ?? null, remedy: gap?.remedy ?? null };
});
const coverage = v2.evidenceCoverage != null ? Math.round(v2.evidenceCoverage * 100) : null;
/**
 * The four readings the record holds, kept apart — owner correction C2.1.
 *
 *   performance  the composite over the dimensions that COULD be measured,
 *                and the grade that composite alone would carry
 *   coverage     the share of the method the evidence reached
 *   issued       the grade actually issued, after the evidence cap
 *   conclusion   whether the evidence supports an overall recommendation
 *
 * Merging the first and third is what made the cover read "assessment
 * performance F · 40" while page three said the composite would be C.
 */
const nominalPoints = Number(
  String(v2.gradeCapReasons?.[0] ?? '').match(/delivers (\d+) of the composite/)?.[1] ?? NaN,
);
const capCeiling = v2.gradeEligibility?.ceiling ?? null;
const measured = (v2.dimensions ?? []).filter((d: any) => d.available).length;
const total = (v2.dimensions ?? []).length;

// ── the layout model ────────────────────────────────────────────────────────
type Entry = [gap: number, block: any];
interface Sheet { name: string; background?: unknown; top: number; flow: Entry[]; pinned: any[]; }

// ═══ 1 · COVER ══════════════════════════════════════════════════════════════
// One governed conclusion, with evidence coverage disclosed beside it and never
// merged into it. No financial band: the weekly position, loan and repayment
// belong to the Financial Analysis.
const COVER: Sheet = {
  name: 'Cover',
  background: { color: 'token:bg' },
  top: 300,
  pinned: [
    B('image', { src: MARK, fit: 'contain', placeholder: false, x: PAD, y: PAD, width: 46, height: 37 }),
    B('text-block', { body: 'Naidu Property Consulting Services', bodySize: 8.5, bodyFont: 'token:display', bodyTracking: 0.26, color: C.text, y: 112 }),
    B('divider', { color: C.primary, thickness: 1, y: 140, width: 64, x: PAD }),
    B('text-block', { body: 'Prepared 17 September 2026   ·   Private and confidential', bodySize: 6.5, bodyFont: 'token:mono', bodyTracking: 0.16, color: C.mutedOnField, y: 800 }),
  ],
  flow: [
    [0, eyebrow('INVESTMENT COMPASS')],
    [16, B('text-block', { body: '18 Annabelle Crescent\nKellyville NSW 2155', bodySize: 34, bodyFont: 'token:heading', bodyLineHeight: 1.1, bodyTracking: -0.02, color: C.text })],
    [18, B('text-block', {
      body: 'Where the property is, who wants to live there, what is mapped over the land, and what the assessment concluded.',
      bodySize: 10, bodyFont: 'token:body', bodyLineHeight: 1.5, color: C.mutedOnField, width: 400,
    })],
    [40, rule('#4A3F32')],
    [16, eyebrow('THE CONCLUSION')],
    [14, B('text-block', {
      body: 'The evidence available does not support an overall\nrecommendation on this property.',
      bodySize: 16, bodyFont: 'token:heading', bodyLineHeight: 1.3, color: C.text, width: 430,
    })],
    [16, B('text-block', {
      body: `${measured} of ${total} assessment criteria could be measured — capital growth in full, rental return in full, market demand on 15% of its method. Location and property risk could not be measured at all. On what WAS measured the property scores ${v2.score}, a ${v2.scoreGrade}; the grade issued is ${v2.grade}, because a criterion that was not measured never lifts a grade. Those are three different statements and this report keeps them apart.`,
      bodySize: 9, bodyFont: 'token:body', bodyLineHeight: 1.55, color: C.mutedOnField, width: 430,
    })],
    // No divider here: the `ruled` band draws its own 1.5pt rule over itself,
    // and that rule is what attaches it to what it sits under. A second one
    // above it prints as a doubled line.
    [44, B('kpi-grid', {
      variant: 'ruled', columns: 3, height: 74,
      items: [
        { label: 'Measured-criteria score', value: `${v2.score} · ${v2.scoreGrade}` },
        // One line. The ruled band does not reserve the label's line height, so
        // a label that wraps drops its own value below the other two baselines
        // — the reservation `AmlMetricCard` already makes for the same reason.
        { label: 'Evidence coverage', value: `${coverage}%` },
        { label: 'Grade issued, after the cap', value: String(v2.grade) },
      ],
      valueFont: 'token:heading', labelFont: 'token:mono', labelSize: 6, labelTracking: 0.18,
      valueSize: 13, valueColor: C.text, labelColor: C.mutedOnField, ruleColor: '#4A3F32', emphasisColor: '#4A3F32',
    })],
  ],
};

// ═══ 2 · CONTENTS ═══════════════════════════════════════════════════════════
// Two levels, built from the sections the document actually renders. The
// delivered contents lists eight page archetypes and puts 29 pages of analysis
// behind one line reading "The report".
const IN = '    ';   // a real indent: HTML collapses ordinary spaces
const SECTIONS: Array<[string, string, string]> = [
  ['1', 'Executive verdict', '6'],
  ['2', 'Property & locality snapshot', '7'],
  ['3', 'Why this location matters', '8'],
  ['', 'Capital growth context and suburb trajectory', '8'],
  ['', 'Planning framework and development controls', '9'],
  ['4', 'Demand drivers', '11'],
  ['', 'Population, income and socio-economic profile', '12'],
  ['', 'Employment, industry mix and local job anchors', '12'],
  ['5', 'Amenity & access', '14'],
  ['', 'Education access', '14'],
  ['', 'Parks, lifestyle and daily living', '15'],
  ['6', 'Transport & connectivity', '15'],
  ['7', 'Planning, zoning & what is mapped over the land', '16'],
  ['', 'Zoning and primary development controls', '16'],
  ['', 'Verification steps before contract', '18'],
  ['8', 'Infrastructure & ten-year outlook', '19'],
  ['9', 'Environment, climate & safety', '19'],
  ['10', 'Market positioning', '21'],
  ['11', 'Property fit within the suburb', '23'],
  ['12', 'Risk dashboard', '24'],
  ['13', 'Due diligence checklist', '29'],
  ['14', 'Recommendation, suitability & monitoring', '30'],
  ['15', 'Appendix, sources & disclaimer', '31'],
];

const CONTENTS: Sheet = {
  name: 'Contents',
  top: PAD,
  pinned: foot('Page 2 of 36'),
  flow: [
    [0, eyebrow('IN THIS REPORT', C.muted)],
    [16, title('Contents')],
    [20, rule()],
    [18, B('data-table', {
      ...TABLE,
      headers: ['', 'Section', 'Page'],
      columnWidths: [0.06, 0.82, 0.12],
      numericColumns: [2],
      rows: SECTIONS.map(([num, name, pg]) => ({ cells: [num, num ? name : IN + name, pg] })),
      // No zebra here. The tint alternates by DRAWN row, so on a two-level
      // contents it cuts across the level it is meant to sit behind — a part
      // and one of its sub-entries land in the same band while the next
      // sub-entry does not, and the pattern reads as a third kind of row.
      // The hairlines and the indent carry the structure.
      stripeBg: 'transparent',
      fontSize: 8.4, cellPadding: 5,
    })],
    [22, provisional('S3', 'Section list and page numbers are bound from the rendered spine; the master currently indexes page archetypes.')],
  ],
};

// ═══ 3 · THE ASSESSMENT ═════════════════════════════════════════════════════
// Five dimensions, always five. A dimension that could not be measured draws a
// row carrying its reason and its remedy, rather than being dropped so that a
// heading reading "Five dimensions" sits over three.
const ASSESSMENT: Sheet = {
  name: 'The assessment',
  top: PAD,
  pinned: foot('Page 4 of 36'),
  flow: [
    [0, eyebrow('HOW THE ASSESSMENT WAS REACHED', C.muted)],
    [16, title('Performance, and what it rests on')],
    [20, rule()],
    [12, para('Three things are kept apart here and never combined: how the property SCORED on what could be measured, how much of the method the evidence REACHED, and the GRADE issued once the second limits the first.')],
    [14, eyebrow('PERFORMANCE ON MEASURED CRITERIA')],
    [12, B('data-table', {
      ...TABLE,
      headers: ['Criterion', 'Score', 'Weight applied', 'Measured on'],
      columnWidths: [0.32, 0.12, 0.13, 0.43],
      numericColumns: [1, 2],
      rows: dims.filter((d) => d.available).map((d) => ({
        cells: [
          d.label,
          String(d.performance),
          `${Math.round((d.effectiveWeight ?? 0) * 100)}%`,
          d.coverage === 1 ? 'Full method' : `${Math.round((d.coverage ?? 0) * 100)}% of method`,
        ],
      })),
    })],
    [8, para(`Weight applied is not the criterion\u2019s share of the whole method. Capital growth carries ${Math.round((dims.find((d) => d.key === 'growth')?.nominalWeight ?? 0) * 100)}% of the full method, rental return and market demand ${Math.round((dims.find((d) => d.key === 'yield')?.nominalWeight ?? 0) * 100)}% each; with location and property risk unmeasured, those three are re-weighted across what remains, so they sum to 100 here. Figures are rounded to the nearest whole point.`, { bodySize: 8.4, color: C.muted })],
    [12, eyebrow('NOT MEASURED — AND WHY')],
    // The record's own reason, and nothing else.
    //
    // Each gap also stores a `remedy`, and neither belongs on a client page:
    // one is engineering prose ("the location service re-acquires the
    // enrichment with its acquisition stamp (RF-7.2B)"), and the property-risk
    // one is written in the past tense — "Answered property-risk questions
    // from the per-class schema" — so printed as a remedy it reads as though
    // the work had already been done. They are operator instructions and are
    // named in the chip below rather than set as the reader's next step.
    [8, B('definition-list', {
      title: '',
      items: dims.filter((d) => !d.available).map((d) => ({ term: d.label, definition: d.reason })),
    })],
    [10, para('Neither absence is a finding about the property. Closing both is our work — the location readings re-acquire when this report is next produced, and the property-risk criterion needs its per-class questions answered on this file. The certificates and searches on the risk page are separate, and remain yours to obtain before contract.', { bodySize: 8.4 })],
    [10, provisional('S2', 'Both absences and their reasons are read from the stored record; the projection publishes the three scored rows only.')],
    [12, rule()],
    [8, eyebrow('EVIDENCE COVERAGE')],
    [4, B('progress-bars', {
      title: '',
      // The block prints the value as a percentage on the right of every bar,
      // so a label that also carries the figure prints it twice.
      items: [
        { label: 'Share of the method the evidence reached', value: coverage },
      ],
      accent: C.primary,
    })],
    [14, eyebrow('WHY THE GRADE IS LOWER THAN THE SCORE')],
    [8, para(`A separate measure sets the CEILING: across the full method the measured criteria deliver ${nominalPoints} of its 100 nominal points, and ${nominalPoints} supports at most ${capCeiling}. So the score is ${v2.score} (${v2.scoreGrade}) and the grade issued is ${v2.grade} — not a second opinion and not a penalty, but the rule that an unmeasured criterion never lifts a grade.`, { bodySize: 8.8 })],
    [12, callout('What this means for this property', 'The largest gap is location, the second-heaviest criterion, on a property 90 m from a public school and 106 m from a bus stop in a straight line — so what is missing here is not obscure. Until it is measured this report gives you the score, the coverage and the grade, and stops short of an overall recommendation.')],
  ],
};

// ═══ 4 · AMENITY & ACCESS ═══════════════════════════════════════════════════
const AMENITY: Sheet = {
  name: 'Amenity & access',
  top: PAD,
  pinned: foot('Page 14 of 36'),
  flow: [
    [0, eyebrow('PART 05 · AMENITY & ACCESS', C.muted)],
    [16, title('What is nearby, and how far')],
    [22, rule()],
    [16, para('Two registers answer this page. The amenity register is an OpenStreetMap slice loaded on a schedule and read locally, so a count is what it holds rather than a live search; stops come from the Transport for NSW GTFS feed. EVERY DISTANCE HERE IS STRAIGHT-LINE from the verified coordinate — no walking or driving route is measured.')],
    [12, eyebrow('NEAREST ON RECORD')],
    [10, B('data-table', {
      ...TABLE,
      headers: ['Category', 'Nearest on record', 'Distance', 'What it means, and its limit'],
      columnWidths: [0.14, 0.24, 0.1, 0.52],
      numericColumns: [2],
      rows: [
        { cells: ['Schools', amen('Schools').nearest, km(amen('Schools').distance), 'Nearest of five held. Proximity is not catchment.'] },
        { cells: ['Healthcare', amen('Healthcare').nearest, km(amen('Healthcare').distance), 'An allied-health practice, not a medical centre; no hospital is held at this grain.'] },
        { cells: ['Shopping', amen('Shopping').nearest, km(amen('Shopping').distance), 'A full-line supermarket under a kilometre away in a straight line.'] },
        { cells: ['Recreation', amen('Recreation').nearest, km(amen('Recreation').distance), 'A local park for everyday use, not a destination reserve.'] },
        { cells: [
          'Transport',
          li.transport?.detailedStops?.[0]?.name ?? '—',
          `${Math.round((li.transport?.detailedStops?.[0]?.metres ?? 0))} m`,
          `The nearest of the ${word(stops.length)} stops this record names. Mode and service frequency are not published per stop, so neither is stated.`,
        ] },
      ],
      fontSize: 8.2,
    })],
    [14, B('text-block', {
      bodySize: 8.2, bodyFont: 'token:body', bodyLineHeight: 1.5, color: C.caution,
      body: `Two figures here look like they disagree and do not. The stop register holds ${grouped(li.transport?.stopsWithin1km)} boarding places within ${grouped(li.transport?.radiusMetres)} m of this property \u2014 a station and its platforms counted once \u2014 and the ${word(stops.length)} above are the nearest of them, which is all this record names. Separately, the amenity register reports no public transport at all, because its transit category is rail, metro and tram STATIONS within two kilometres and matches no bus stop: that nought is true about stations and says nothing about buses.`,
    })],
    [12, eyebrow('THE FIVE NEAREST SCHOOLS')],
    [10, B('data-table', {
      ...TABLE,
      headers: ['School', 'Distance'],
      columnWidths: [0.79, 0.21],
      numericColumns: [1],
      rows: schools.map((s: any) => ({ cells: [s.name, `${s.distance.toFixed(2)} km`] })),
      fontSize: 8.2,
    })],
    [12, callout('What this means, and what to do before contract', 'The nearest of every category sits within a kilometre in a straight line, which suits the family tenant this dwelling is built for. Three limits matter: the register caps each category at ten, so a count of ten is a floor rather than a measurement; no rating, ranking or catchment is published here; and no walking or driving route is measured, so a short straight line is not a short walk. Before contract, confirm the catchment by address with the NSW School Finder and travel to the Windsor Road stop at the hour you would use it.')],
    [16, provisional('S3 · S4', 'Named facilities and distances are read from the stored enrichment; the projection does not yet publish an amenity namespace.')],
  ],
};

// ═══ 5 · INFRASTRUCTURE & TEN-YEAR OUTLOOK ══════════════════════════════════
// A determination date is not a delivery date. Every row the NSW register
// returned for this window carries a determination and no published delivery
// horizon, so every row sits under "Timing unconfirmed" and says so.
const DA = [
  { what: 'Demolition, residential flat building, shop-top housing, hotel or motel accommodation', cat: 'Residential supply', where: 'Castle Hill', cost: '$181,934,581', det: 'Determined 7 Jul 2026' },
  { what: 'Alterations or additions, high technology industry, data centre', cat: 'Retail & employment', where: 'Norwest', cost: '$93,180,778', det: 'Determined 7 May 2026' },
  { what: 'Alterations or additions, high technology industry, data centre', cat: 'Retail & employment', where: 'Norwest', cost: '$93,180,778', det: 'Determined 2 Jul 2026' },
  { what: 'Alterations or additions, high technology industry, data centre', cat: 'Retail & employment', where: 'Norwest', cost: '$93,180,778', det: 'Determined 30 Jul 2026' },
  { what: 'Erection of a new structure, multi-dwelling housing (terraces)', cat: 'Residential supply', where: 'Gables', cost: '$29,752,831', det: 'Determined 22 Jul 2026' },
];

const INFRA: Sheet = {
  name: 'Infrastructure & ten-year outlook',
  top: PAD,
  pinned: foot('Page 19 of 36'),
  flow: [
    [0, eyebrow('PART 08 · INFRASTRUCTURE & TEN-YEAR OUTLOOK', C.muted)],
    [16, title('What is coming, and what is only decided')],
    [22, rule()],
    [16, para('A development application that has been DETERMINED has been decided by the consent authority. That is all this register records: whether the work is funded, whether it has started and when it might finish are NOT ESTABLISHED by anything below. No row carries a publisher-stated delivery date, so nothing below is placed on a horizon.')],
    [18, eyebrow(`TIMING UNCONFIRMED — ${WORDS[DA.length].toUpperCase()} APPLICATIONS IN THE REGISTER WINDOW`)],
    [12, B('data-table', {
      ...TABLE,
      headers: ['Project', 'Category', 'Where', 'Status recorded', 'Stated cost'],
      columnWidths: [0.3, 0.155, 0.115, 0.235, 0.195],
      numericColumns: [4],
      rows: DA.map((d) => ({ cells: [d.what, d.cat, d.where, d.det, d.cost] })),
      fontSize: 7.6, cellPadding: 4,
    })],
    [16, B('text-block', {
      bodySize: 8.4, bodyFont: 'token:body', bodyLineHeight: 1.5, color: C.caution,
      body: 'Three Norwest rows share a description, a suburb and a stated cost to the dollar, and differ only in determination date. They are flagged as a possible relationship and are NOT merged: identity is confirmed by application number or a documented modification record, and the register’s identifiers have not yet been read. They are counted here as three applications, not as three projects.',
    })],
    [14, rule()],
    [12, eyebrow('TOTALS, SEPARATELY LABELLED')],
    [12, B('data-table', {
      ...TABLE,
      headers: ['Basis', 'Figure', 'What it counts'],
      columnWidths: [0.26, 0.21, 0.53],
      numericColumns: [1],
      rows: [
        { cells: ['Selected applications', '$491,229,746', 'The five rows above, summed. Not de-duplicated.'] },
        { cells: ['Council-wide cost', '$808,649,729', '278 applications, The Hills Shire, 18 Mar – 17 Sep 2026.'] },
        { cells: ['Council-wide dwellings', '680', '171 applications, same window.'] },
      ],
      fontSize: 8.2,
    })],
    [16, callout('What this means for this property', 'Activity in the local government area is visible and substantial, and none of it is at this address. For a landlord it reads both ways: confidence in the district, and competing supply for a comparable dwelling. None of it can be given a completion date from this register.')],
    [14, eyebrow('NOT COVERED BY THIS REGISTER')],
    [10, para('Council capital works programmes, state transport, education and health capital registers, and agency announcements are not integrated. Their absence here is not evidence that nothing is planned.', { bodySize: 8.6 })],
    [12, provisional('S4', 'Six-category filing, the evidence fields and the identity check are the agreed design; only the NSW DA register is integrated today.')],
  ],
};

// ═══ 6 · RISK & INTERPRETATION ══════════════════════════════════════════════
// Exposure and evidence confidence are separate columns. A "Low" exposure with
// an outstanding check is not a clearance, and the page says so in the table
// rather than in a footnote.
const RISK: Sheet = {
  name: 'Risk & interpretation',
  top: PAD,
  pinned: foot('Page 24 of 36'),
  flow: [
    [0, eyebrow('PART 12 · RISK DASHBOARD', C.muted)],
    [16, title('Exposure, and how well it is evidenced')],
    [18, rule()],
    [12, para('EXPOSURE is how much this risk could matter; EVIDENCE names what was actually checked. Where a register published nothing here the exposure reads NOT ESTABLISHED, which is different from low, and a checklist of work still to do is never a clearance.')],
    // A Chancery ledger table rather than the `risk-register` block.
    //
    // Two reasons, both the owner's corrections. The block draws its rating
    // and confidence as pills from a fixed palette in `_chips.html.ts` that
    // reads no template token and ignores `radius: '0'`, so it cannot wear
    // this design (C6.3). And its column widths are fixed at 22/12/13/28/25%,
    // which gives the two prose columns 135pt and 120pt — at five rows of
    // properly qualified wording that is a page and a half. Merging what was
    // checked with what to do into one 48% column halves the wrap.
    //
    // The exposure / evidence separation the owner asked to keep is kept: they
    // are two columns, and the vocabularies stay distinct.
    [12, B('data-table', {
      ...TABLE,
      headers: ['Risk', 'Exposure', 'Evidence', 'What was checked, and what to do before contract'],
      columnWidths: [0.2, 0.14, 0.17, 0.49],
      numericColumns: [],
      fontSize: 8.2,
      rows: [
        { cells: [
          'Environmental — flood, bushfire, hazards',
          'Not established',
          'Desktop layers only',
          'Nineteen hazard layers answered here and returned no mapped feature — but a layer answers at its published scale, not for the lot. An absence of mapping, not of hazard. Order the s.10.7(2) and (5) certificates and obtain AFRIP and RFS mapping.',
        ] },
        { cells: [
          'Planning — subdivision and densification',
          'Moderate',
          'Mapped control',
          'R2 Low Density Residential, The Hills LEP 2019: 10\u00A0m height (cl.\u00A04.3), 700\u00A0m² minimum lot. This 765\u00A0m² lot is 65\u00A0m² above it. Confirm surveyed area and frontage against the minimum before assuming a split.',
        ] },
        { cells: [
          'Planning — floor space ratio',
          'Not established',
          'Not published',
          'FSR caps TOTAL FLOOR AREA across all storeys against site area — not the footprint. The register answered here and published no figure, so permitted floor area is unknown. Read the FSR from the s.10.7(2) certificate and the DCP.',
        ] },
        { cells: [
          'Supply — competing new dwellings',
          'Moderate',
          'Council-wide count',
          '680 new dwellings across 171 applications in The Hills Shire, six months to 17\u00A0Sep\u00A02026. Count how many are comparable detached houses before setting rent and resale assumptions.',
        ] },
        { cells: [
          'Transport — car reliance',
          'Moderate',
          'Stop register only',
          `${grouped(li.transport?.stopsWithin1km)} boarding places within ${grouped(li.transport?.radiusMetres)}\u00A0m, nearest ${nearestStopMetres}\u00A0m straight-line; mode and frequency are not published per stop. Check Transport for NSW timetables for the routes on Windsor Road.`,
        ] },
      ],
    })],
    // C6.2 — a concise source, date and method line on the page; the full
    // provenance belongs in the appendix.
    [16, eyebrow('WHERE EACH ROW CAME FROM', C.muted)],
    [10, para('Hazard and planning controls: NSW Planning Portal and Spatial Services layers, read at this property\u2019s verified coordinate on 17 Sep 2026, each at its own publisher\u2019s scale. Supply: NSW development application register, The Hills Shire, applications determined 18 Mar – 17 Sep 2026. Transport: Transport for NSW GTFS stops (CC BY 4.0), straight-line distance from the coordinate. No field survey, certificate or site inspection informs this page.', { bodySize: 8, color: C.muted })],
    [14, callout('How to read this page', 'Nothing here is rated High and nothing here is settled. All five rows carry an action, and two — environmental exposure and floor space ratio — read NOT ESTABLISHED rather than favourable, because the registers that would settle them published nothing here. This is a starting list for due diligence, not a clearance.')],
    [12, provisional('S3 · S4', 'Rows are read from the stored planning and enrichment records; the projection does not yet publish a risk namespace with separate exposure and evidence fields. Drawn on the template\u2019s own ledger because the shared risk-register block\u2019s chips use a fixed palette that follows no colourway.')],
  ],
};

const SHEETS = [COVER, CONTENTS, ASSESSMENT, AMENITY, INFRA, RISK];

// ── pass one: measure every flowed block on the engine that will draw it ─────
const PROBE_TOP = 40;
const probes = SHEETS.flatMap((s, si) => s.flow.map(([, b], bi) => ({ si, bi, sheet: s, block: b })));

const probeSchema = {
  name: 'S1 probe',
  tokens: TOKENS,
  pages: probes.map((p, i) => ({
    id: `probe-${i}`,
    name: `probe-${i}`,
    size: { width: 595, height: 842 },
    ...(p.sheet.background ? { background: p.sheet.background } : {}),
    blocks: [{ ...p.block, props: { ...p.block.props, y: PROBE_TOP } }],
  })),
};

/**
 * Render on the production print contract, not the CLI's defaults.
 *
 * `render-template-pdf` asks for `pdf/ua-1`, tagged, `optimize_images`,
 * `output_intent: 'srgb'` and `custom_metadata`; a bare `weasyprint in out`
 * asks for none of them and produces an untagged file with no output intent —
 * a different document from the one the product would deliver.
 * `renderWeasy.py` mirrors `weasyprint-service/app.py`'s call, and reports the
 * engine's warnings, each of which is a declaration it dropped.
 */
const weasy = (html: string, pdf: string) => {
  const out = execFileSync('python3', [resolve(REPO, 'scripts/reports/renderWeasy.py'), html, pdf], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  });
  return out.trim().split('\n').filter((l) => l.startsWith('warning\t')).map((l) => l.slice(8));
};

const probeHtml = resolve(REPO, 'reports/html/s1-probe.html');
const probePdf = resolve(REPO, 'reports/pdf/s1-probe.pdf');
writeFileSync(probeHtml, (await compileTemplateHtmlForPdf(probeSchema as never, { data })).html);
weasy(probeHtml, probePdf);

const ink = execFileSync('python3', [resolve(REPO, 'scripts/reports/measureInk.py'), probePdf], { encoding: 'utf8' })
  .trim().split('\n').map((l) => Number(l.split('\t')[1]));
if (ink.length !== probes.length) {
  console.error(`probe pages ${ink.length} ≠ blocks ${probes.length}`);
  process.exit(1);
}
const heights = new Map<string, number>();
probes.forEach((p, i) => heights.set(`${p.si}:${p.bi}`, Math.max(0, ink[i] - PROBE_TOP)));

// ── pass two: stack from the measurements, and check the foot ───────────────
const pages = SHEETS.map((s, si) => {
  let y = s.top;
  const blocks = s.flow.map(([gap, b], bi) => {
    y += gap;
    const placed = { ...b, props: { ...b.props, y: Math.round(y * 10) / 10 } };
    const h = heights.get(`${si}:${bi}`) ?? 0;
    if (process.env.S1_HEIGHTS) {
      const what = String((b.props as any).body ?? (b.props as any).heading ?? b.type).slice(0, 44);
      console.log(`      ${String(bi).padStart(2)} ${b.type.padEnd(16)} +${String(gap).padStart(3)}  h=${h.toFixed(1).padStart(6)}  y=${y.toFixed(1).padStart(6)}  ${what.replace(/\n/g, ' ')}`);
    }
    y += h;
    return placed;
  });
  const clear = s.name === 'Cover' ? 812 : FLOOR;
  const verdict = y <= clear ? 'ok' : `OVERRUN ${(y - clear).toFixed(1)}pt`;
  console.log(`${String(si + 1).padStart(2)} ${s.name.padEnd(34)} ends ${y.toFixed(1).padStart(6)}pt of ${clear}  ${verdict}`);
  if (y > clear) process.exitCode = 1;
  return {
    id: id('page'), name: s.name, size: { width: 595, height: 842 },
    ...(s.background ? { background: s.background } : {}),
    blocks: [...blocks, ...s.pinned],
  };
});

const schema = { name: 'S1 review — Annabelle on Chancery', tokens: TOKENS, pages };
const compiled = await compileTemplateHtmlForPdf(schema as never, { data });
const htmlPath = resolve(REPO, 'reports/html/s1-review.html');
const pdfPath = resolve(REPO, 'reports/pdf/s1-review.pdf');
writeFileSync(htmlPath, compiled.html);
const warnings = weasy(htmlPath, pdfPath);

// ── pass three: prove the content SURVIVED, not merely that it fitted ───────
//
// Owner correction C7.1: fitting on the page is not conservation. The
// `decision-box` truncation found in S1 is the proof — a card that stops at
// word 61 and prints an ellipsis clears the running foot perfectly.
//
// So every authored string is looked for in the rendered text. Comparison is
// on letters and digits alone, because the extractor re-flows lines, turns a
// non-breaking space into a space and can split a ligature; anything that
// normalises away is presentation, and anything that does not is content.
const printable = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '');
// `-raw`, never `-layout`. Layout mode re-flows the page into visual columns
// and interleaves a table's cells line by line, which splits every cell's
// sentence across its neighbours — 27 of 152 strings here read as lost while
// the pages were correct. Content order is what a conservation check needs.
const rendered = printable(execFileSync('pdftotext', ['-raw', pdfPath, '-'], { encoding: 'utf8' }));

const authored: Array<{ where: string; text: string }> = [];
SHEETS.forEach((sheet) => {
  const visit = (value: unknown, path: string) => {
    if (typeof value === 'string') {
      // Bindings, colours, fonts and enum-ish props are not prose.
      if (value.length < 12 || value.startsWith('token:') || value.startsWith('#')
        || value.startsWith('data:') || value.includes('{{')) return;
      authored.push({ where: `${sheet.name} · ${path}`, text: value });
      return;
    }
    if (Array.isArray(value)) { value.forEach((v, i) => visit(v, `${path}[${i}]`)); return; }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (k === 'src' || k === 'id' || k === 'type') continue;
        visit(v, `${path}.${k}`);
      }
    }
  };
  [...sheet.flow.map(([, b]) => b), ...sheet.pinned].forEach((b) => visit(b.props, b.type));
});

const lost = authored.filter(({ text }) => !rendered.includes(printable(text)));
console.log(`content conservation: ${authored.length - lost.length} of ${authored.length} authored strings present`);
for (const { where, text } of lost) {
  console.log(`  LOST  ${where}: ${JSON.stringify(text.slice(0, 90))}…`);
}
if (lost.length > 0) process.exitCode = 1;

const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
console.log(`\npages=${info.match(/^Pages:\s+(\d+)/m)?.[1]}  size=${info.match(/^Page size:\s+(.+)$/m)?.[1]}  tagged=${info.match(/^Tagged:\s+(\S+)/m)?.[1]}`);
if (warnings.length) {
  console.log(`engine warnings (${warnings.length}) — each is a declaration the engine dropped:`);
  for (const w of warnings) console.log(`  · ${w}`);
}
if (compiled.droppedAssets.length) console.log('dropped:', compiled.droppedAssets.map((d) => d.where).join(', '));
console.log(pdfPath);
