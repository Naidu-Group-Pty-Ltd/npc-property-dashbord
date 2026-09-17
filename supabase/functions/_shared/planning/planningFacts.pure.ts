/**
 * The planning controls a report may state, and what each one rests on.
 *
 * ## The defect this exists to end
 *
 * `planning-data-service` has worked since 2026-09-06. It resolves the
 * jurisdiction from the layers themselves, returns the zone, the parcel, the
 * state development instruments and the DA activity, and says which kind of
 * absence each empty cell is. `generate-investment-report` fetches it,
 * assigns it to `enhancedData.planningData` — and then **reads nothing back
 * out of it for the zoning section**.
 *
 * Measured on 262 Pallas Street, Maryborough QLD 4650 (report
 * `aa41bcec-5a5c-434d-9162-96deb50e9bdb`, 16 Sep 2026): the stored row has
 * `spec_zoning` null, `spec_council` null, no zoning key among its 25
 * overrides and no `planning` entry in `data_sources`, while a live call to
 * the deployed service at that report's own coordinate answers
 * `jurisdiction: QLD`, `parcel.status: ok`, `lga: "Fraser Coast Regional"`,
 * `locality: "Maryborough"` under CC BY 4.0. The enrichment worked and the
 * report discarded all of it.
 *
 * What the reader got instead was the prompt's own furniture. The zoning
 * section was a template of bracketed placeholders — `[XX]%` site coverage,
 * `[X]m` setbacks, "Refer to LEP" for minimum lot size, height and floor
 * space ratio, and the sentence "Check minimum lot size requirements
 * (typically 450m²)" — handed to a model with nothing to fill them from. A
 * model asked for a control it has not been given will supply a plausible
 * one: 450 m², 8.5 m, 0.5:1 are the numbers that came back, and a reader
 * cannot tell them from measurements. The template was also written for New
 * South Wales — LEP, DCP, a s10.7 certificate — on a Queensland property,
 * where none of those instruments exists.
 *
 * ## The rules
 *
 * 1. **A control with no source is never a number.** Every cell is a value
 *    with a provenance or a named absence; there is no default, no "typical",
 *    and no bracketed placeholder for a model to fill. This is the rule that
 *    the 450/8.5/0.5 trio broke.
 * 2. **An audited operator override outranks a layer, and says so.** A person
 *    who has read the certificate knows more than a spatial layer, so an
 *    override is never overwritten by an automatic reading — but it is
 *    labelled `operator_stated` rather than presented as a published control.
 * 3. **A layer is indicative; the instrument settles it.** Every answer
 *    carries the jurisdiction's own verification instrument, and the section
 *    says in its own words that this is desktop research rather than a
 *    planning certificate.
 * 4. **The four absences are different sentences.** `not_served` (the
 *    jurisdiction publishes no such dataset), `not_integrated` (no verified
 *    adapter), `licence_restricted` (the data exists and may not be
 *    republished), `none_at_point` (the service answered and nothing covers
 *    this point) and `unavailable` (the read failed) are five different
 *    things, and collapsing them is how "we did not look" comes to read as
 *    "there is nothing there".
 * 5. **Adopted controls and draft amendments never merge.** A draft is
 *    reported under its own heading with its own standing, because acting on
 *    a draft as though it were in force is the expensive mistake here.
 * 6. **Development potential from a zone is conditional, never approval.**
 *    A zone admitting a use is not consent for it; the sentence says so
 *    wherever a potential is stated.
 *
 * Pure: no fetch, no Deno, no clock. The retrieval stamp comes in with the
 * reading.
 */

import {
  VERIFICATION_INSTRUMENT,
  type PlanningJurisdiction,
} from './planningSources.pure.ts';

// ---------------------------------------------------------------------------
// Vocabulary

/**
 * Why a cell reads as it does.
 *
 * `stated` and `operator_stated` carry a value; every other member carries a
 * note instead, and the five absences are deliberately distinct (rule 4).
 */
export type PlanningCellStatus =
  | 'stated'
  | 'operator_stated'
  | 'none_at_point'
  | 'not_published'
  | 'not_served'
  | 'licence_restricted'
  | 'not_integrated'
  | 'unavailable';

/** Whether a control is in force or proposed. Never inferred (rule 5). */
export type PlanningStanding = 'adopted' | 'draft';

export interface PlanningCell {
  /** The control, in the reader's words — "Minimum lot size". */
  label: string;
  /** The value as it should be printed, units included, or null. */
  value: string | null;
  status: PlanningCellStatus;
  /** Why there is no value. Null exactly when a value is present. */
  note: string | null;
  /** The publisher and dataset, as the adapter names them. */
  source: string | null;
  /** A page a reader can open to check it. */
  sourceUrl: string | null;
  licence: string | null;
  /** The instrument's own currency or gazettal date, where it states one. */
  effectiveDate: string | null;
  /** When THIS deployment retrieved the reading. */
  retrievedAt: string | null;
  standing: PlanningStanding | null;
}

export interface PlanningInstrumentFact {
  kind: string;
  name: string;
  status: string | null;
  gazetted: string | null;
  detail: string | null;
}

export interface PlanningFacts {
  jurisdiction: PlanningJurisdiction | null;
  /** The local government the answering layer named — never a guess. */
  council: string | null;
  locality: string | null;
  lotPlan: string | null;
  parcelAreaSqm: number | null;
  parcelAreaBasis: 'surveyed' | 'computed' | null;
  zoning: PlanningCell;
  zoneFamily: string | null;
  overlays: PlanningCell;
  /** Minimum lot size, height and floor space ratio, in that order. */
  controls: PlanningCell[];
  /** State development instruments the point sits inside. */
  instruments: PlanningCell;
  instrumentList: PlanningInstrumentFact[];
  /** Development applications in the surrounding register, where one exists. */
  developmentActivity: PlanningCell;
  developmentActivitySummary: Record<string, unknown> | null;
  /** The sentence that says what settles the question. */
  verification: string;
  retrievedAt: string | null;
  /** True when at least one cell carries a value. */
  anyStated: boolean;
  /** True when the enrichment was never reached at all. */
  enrichmentMissing: boolean;
}

/**
 * Where a reader goes to check the answer themselves.
 *
 * The adapter's `source` names the dataset and its host; this names the
 * public portal a person can open, which is what "persist the source URL"
 * has to mean for somebody who is not going to call an ArcGIS endpoint.
 */
export const PLANNING_VERIFICATION_URL: Readonly<Record<PlanningJurisdiction, string>> = {
  NSW: 'https://www.planningportal.nsw.gov.au/spatialviewer',
  VIC: 'https://mapshare.vic.gov.au/vicplan/',
  QLD: 'https://planning.statedevelopment.qld.gov.au/planning/spatial-mapping/interactive-mapping',
  WA: 'https://www.wa.gov.au/organisation/department-of-planning-lands-and-heritage/planwa',
  SA: 'https://plan.sa.gov.au/',
  TAS: 'https://maps.thelist.tas.gov.au/listmap/app/list/map',
  ACT: 'https://www.planning.act.gov.au/territory-plan',
  NT: 'https://ntlis.nt.gov.au/planning/',
};

// ---------------------------------------------------------------------------
// Readers

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** A cell with nothing in it, carrying the reason and nothing else. */
function absent(label: string, status: PlanningCellStatus, note: string): PlanningCell {
  return {
    label, value: null, status, note,
    source: null, sourceUrl: null, licence: null,
    effectiveDate: null, retrievedAt: null, standing: null,
  };
}

/**
 * The status a service cell's own `status` word maps onto.
 *
 * The service already distinguishes the five absences; this only widens the
 * vocabulary with the two an override can produce. An unrecognised word is
 * `unavailable` rather than an absence, because a word this module does not
 * know is a failure to understand the answer, not evidence about the land.
 */
function statusOf(raw: unknown): PlanningCellStatus {
  switch (str(raw)) {
    case 'ok': return 'stated';
    case 'none_at_point': return 'none_at_point';
    case 'not_served': return 'not_served';
    case 'licence_restricted': return 'licence_restricted';
    case 'not_integrated': return 'not_integrated';
    case 'unavailable': return 'unavailable';
    default: return 'unavailable';
  }
}

export interface PlanningOverrides {
  zoningCode?: unknown;
  zoningDescription?: unknown;
  permittedUses?: unknown;
  developmentPotential?: unknown;
  zoningOverlays?: unknown;
  minimumLotSize?: unknown;
  maximumHeight?: unknown;
  floorSpaceRatio?: unknown;
}

export interface PlanningFactsInput {
  /** `enhancedData.planningData` — the service's answer, or absent. */
  planningData?: unknown;
  /** The audited manual overrides, which outrank a layer (rule 2). */
  overrides?: PlanningOverrides;
}

/** `R2 Low Density Residential`, from whichever parts the reading carries. */
function zoneLine(code: string | null, label: string | null): string | null {
  const parts = [code, label].filter((p): p is string => !!p);
  return parts.length ? [...new Set(parts)].join(' — ') : null;
}

/** An override's own words, tidied but never reinterpreted. */
function overrideText(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  // Stored overrides are slug-shaped (`dual_occupancy`). Spacing them is
  // presentation; nothing here changes which control was recorded.
  return s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

const OPERATOR_NOTE =
  'Recorded by an operator against this report rather than read from a published layer.';

function operatorCell(label: string, value: string, retrievedAt: string | null): PlanningCell {
  return {
    label, value, status: 'operator_stated', note: OPERATOR_NOTE,
    source: 'Operator override recorded against this report',
    sourceUrl: null, licence: null, effectiveDate: null,
    retrievedAt, standing: null,
  };
}

/**
 * Build the planning record a report may state, from the enrichment and the
 * operator's own overrides.
 *
 * Nothing here fetches, and nothing here invents: every cell either carries a
 * value with its provenance or names which absence it is.
 */
export function buildPlanningFacts(input: PlanningFactsInput): PlanningFacts {
  const data = isRecord(input.planningData) ? input.planningData : null;
  const o = input.overrides ?? {};
  const retrievedAt = data ? str(data.fetchedAt) : null;

  const jurisdiction = (str(data?.jurisdiction) as PlanningJurisdiction | null) ?? null;
  const portal = jurisdiction ? PLANNING_VERIFICATION_URL[jurisdiction] ?? null : null;

  const zoningRaw = isRecord(data?.zoning) ? data!.zoning : null;
  const parcelRaw = isRecord(data?.parcel) ? data!.parcel : null;
  const instrumentsRaw = isRecord(data?.developmentInstruments) ? data!.developmentInstruments : null;
  const activityRaw = isRecord(data?.developmentActivity) ? data!.developmentActivity : null;

  // ── the zone ──────────────────────────────────────────────────────────────
  // The override wins (rule 2); otherwise the layer's own words, or the named
  // absence the service already worked out.
  const overrideZone = zoneLine(overrideText(o.zoningCode), overrideText(o.zoningDescription));
  let zoning: PlanningCell;
  if (overrideZone) {
    zoning = operatorCell('Zone', overrideZone, retrievedAt);
  } else if (!data) {
    zoning = absent('Zone', 'unavailable',
      'The planning enrichment did not run for this report, so no zone was retrieved.');
  } else if (statusOf(zoningRaw?.status) === 'stated') {
    const line = zoneLine(str(zoningRaw?.zoneCode), str(zoningRaw?.zoneLabel));
    zoning = {
      label: 'Zone',
      value: line,
      status: line ? 'stated' : 'unavailable',
      note: line ? null : 'The layer answered without a zone code.',
      source: str(zoningRaw?.source),
      sourceUrl: portal,
      licence: str(zoningRaw?.licence),
      effectiveDate: str(zoningRaw?.currencyDate),
      retrievedAt,
      // A published scheme layer is the instrument in force. A draft
      // amendment is not published on these layers at all, which is exactly
      // why the draft section below says nothing rather than guessing.
      standing: line ? 'adopted' : null,
    };
  } else {
    zoning = absent('Zone', statusOf(zoningRaw?.status),
      str(zoningRaw?.note) ?? 'No zone was returned for this point.');
  }

  // ── overlays ──────────────────────────────────────────────────────────────
  // No integrated layer publishes overlays at a point yet, so the only
  // overlay a report may state is one an operator recorded. Saying "no
  // significant overlays identified" from an absence — which the old template
  // did — asserts a search nobody performed.
  const overrideOverlays = overrideText(o.zoningOverlays);
  const overlays = overrideOverlays
    ? operatorCell('Overlays', overrideOverlays, retrievedAt)
    : absent('Overlays', 'not_integrated',
      'Overlay mapping (heritage, flood, bushfire, character, acoustic) is held in the council scheme and is not retrieved by this platform. '
      + 'Nothing here states that the property carries no overlay — only that none was looked up.');

  // ── the numeric controls ──────────────────────────────────────────────────
  // Minimum lot size, height and floor space ratio: the three the old
  // template printed as "Refer to LEP" beside a model free to invent them.
  // No integrated layer publishes any of them, so unless an operator recorded
  // one the cell states that and carries no figure (rule 1).
  const controlSpecs: Array<{ label: string; value: unknown; suffix: string }> = [
    { label: 'Minimum lot size', value: o.minimumLotSize, suffix: ' m²' },
    { label: 'Maximum building height', value: o.maximumHeight, suffix: ' m' },
    { label: 'Floor space ratio', value: o.floorSpaceRatio, suffix: ':1' },
  ];
  const controls = controlSpecs.map(({ label, value, suffix }) => {
    const stated = num(value) ?? (str(value) ? Number(str(value)) : null);
    if (stated !== null && Number.isFinite(stated)) {
      return operatorCell(label, `${stated}${suffix}`, retrievedAt);
    }
    return absent(label, 'not_published',
      `Set by the ${jurisdiction === 'QLD' ? 'council planning scheme' : 'planning instrument'} and not published on any layer this platform reads. `
      + 'No figure is stated here; read it from the scheme or the certificate.');
  });

  // ── state development instruments ─────────────────────────────────────────
  const instrumentList: PlanningInstrumentFact[] = Array.isArray(instrumentsRaw?.instruments)
    ? (instrumentsRaw!.instruments as unknown[]).flatMap((raw) => {
      if (!isRecord(raw)) return [];
      const name = str(raw.name);
      if (!name) return [];
      return [{
        kind: str(raw.kind) ?? 'instrument',
        name,
        status: str(raw.status),
        gazetted: str(raw.gazetted),
        detail: str(raw.detail),
      }];
    })
    : [];
  const instruments = !data
    ? absent('State development instruments', 'unavailable',
      'The planning enrichment did not run for this report.')
    : statusOf(instrumentsRaw?.status) === 'stated'
      ? {
        label: 'State development instruments',
        value: `${instrumentList.length} declared instrument${instrumentList.length === 1 ? '' : 's'} cover this point`,
        status: 'stated' as const,
        note: null,
        source: str(instrumentsRaw?.source),
        sourceUrl: portal,
        licence: str(instrumentsRaw?.licence),
        effectiveDate: null,
        retrievedAt,
        standing: 'adopted' as const,
      }
      : absent('State development instruments', statusOf(instrumentsRaw?.status),
        str(instrumentsRaw?.note) ?? 'No state development instrument reading for this point.');

  // ── development activity ──────────────────────────────────────────────────
  const activitySummary = isRecord(activityRaw?.summary)
    ? activityRaw!.summary as Record<string, unknown>
    : null;
  const developmentActivity = !data
    ? absent('Development applications', 'unavailable',
      'The planning enrichment did not run for this report.')
    : statusOf(activityRaw?.status) === 'stated' && activitySummary
      ? {
        label: 'Development applications',
        value: str(activitySummary.headline)
          ?? `${num(activitySummary.total) ?? 0} applications in the register window`,
        status: 'stated' as const,
        note: null,
        source: str(activityRaw?.source),
        sourceUrl: portal,
        licence: str(activityRaw?.licence),
        effectiveDate: str(activitySummary.to),
        retrievedAt,
        standing: null,
      }
      : absent('Development applications', statusOf(activityRaw?.status),
        str(activityRaw?.note) ?? 'No development-application register reading for this jurisdiction.');

  const parcelStated = statusOf(parcelRaw?.status) === 'stated';
  const council = parcelStated ? str(parcelRaw?.lga) : (zoning.status === 'stated' ? str(zoningRaw?.lga) : null);

  const cells = [zoning, overlays, ...controls, instruments, developmentActivity];
  return {
    jurisdiction,
    council,
    locality: parcelStated ? str(parcelRaw?.locality) : null,
    lotPlan: parcelStated ? str(parcelRaw?.lotPlan) : null,
    parcelAreaSqm: parcelStated ? num(parcelRaw?.area) : null,
    parcelAreaBasis: parcelStated
      ? (str(parcelRaw?.areaBasis) === 'surveyed' ? 'surveyed' : str(parcelRaw?.areaBasis) === 'computed' ? 'computed' : null)
      : null,
    zoning,
    zoneFamily: zoning.status === 'stated' ? str(zoningRaw?.zoneFamily) : null,
    overlays,
    controls,
    instruments,
    instrumentList,
    developmentActivity,
    developmentActivitySummary: activitySummary,
    verification: str(data?.verification)
      ?? (jurisdiction
        ? `A spatial layer is indicative; what settles the question is ${VERIFICATION_INSTRUMENT[jurisdiction]}.`
        : 'A spatial layer is indicative; verify with the relevant council or planning authority.'),
    retrievedAt,
    anyStated: cells.some((c) => c.status === 'stated' || c.status === 'operator_stated'),
    enrichmentMissing: !data,
  };
}

// ---------------------------------------------------------------------------
// Rendering

const INSTRUMENT_LABEL: Record<string, string> = {
  priority_development_area: 'Priority development area',
  state_development_area: 'State development area',
  coordinated_project: 'Coordinated project',
  infrastructure_designation: 'Infrastructure designation',
};

/** `1 Jan 2026` from an ISO date, or the string back if it is not one. */
function auDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

/** The evidence reference a row carries: publisher, currency, retrieval. */
function evidenceRef(cell: PlanningCell): string {
  if (cell.status === 'operator_stated') return 'Recorded by operator';
  if (!cell.source) return '—';
  const bits = [cell.source];
  const effective = auDate(cell.effectiveDate);
  if (effective) bits.push(`current at ${effective}`);
  const got = auDate(cell.retrievedAt);
  if (got) bits.push(`retrieved ${got}`);
  if (cell.licence) bits.push(cell.licence);
  return bits.join('; ');
}

/** What a row prints where it has no value: the absence, in words. */
function absenceText(cell: PlanningCell): string {
  return cell.note ?? 'Not retrieved.';
}

/**
 * The planning table a client reads, and the sentences that qualify it.
 *
 * Composed here rather than asked of a model, because every figure in it is
 * either retrieved or absent and neither is a writing task. The prose the
 * model does write is constrained by `planningFactBlocks` below.
 */
export function renderPlanningControls(facts: PlanningFacts): string {
  const lines: string[] = [];

  const where = [
    facts.locality ? `**Locality:** ${facts.locality}` : null,
    facts.council ? `**Local government:** ${facts.council}` : null,
    facts.jurisdiction ? `**Jurisdiction:** ${facts.jurisdiction}` : null,
    facts.lotPlan ? `**Lot / plan:** ${facts.lotPlan}` : null,
    facts.parcelAreaSqm !== null
      ? `**Parcel area:** ${facts.parcelAreaSqm.toLocaleString('en-AU')} m²${facts.parcelAreaBasis ? ` (${facts.parcelAreaBasis})` : ''}`
      : null,
  ].filter((l): l is string => l !== null);
  if (where.length) lines.push(where.join(' · '), '');

  lines.push('| Control | Reading | Standing | Evidence |');
  lines.push('|---|---|---|---|');
  for (const cell of [facts.zoning, facts.overlays, ...facts.controls]) {
    const reading = cell.value ?? absenceText(cell);
    const standing = cell.status === 'operator_stated'
      ? 'Operator record'
      : cell.standing === 'adopted' ? 'Adopted'
        : cell.standing === 'draft' ? 'Draft — not in force'
          : '—';
    lines.push(`| ${cell.label} | ${reading} | ${standing} | ${evidenceRef(cell)} |`);
  }
  lines.push('');

  if (facts.instrumentList.length) {
    lines.push('**State development instruments covering this point:**', '');
    lines.push('| Instrument | Name | Status | Gazetted |');
    lines.push('|---|---|---|---|');
    for (const i of facts.instrumentList) {
      lines.push(`| ${INSTRUMENT_LABEL[i.kind] ?? i.kind} | ${i.name} | ${i.status ?? '—'} | ${auDate(i.gazetted) ?? '—'} |`);
    }
    lines.push('', `Source: ${facts.instruments.source ?? 'state planning layers'}${facts.instruments.licence ? ` (${facts.instruments.licence})` : ''}.`, '');
  } else {
    lines.push(`**State development instruments:** ${absenceText(facts.instruments)}`, '');
  }

  lines.push(
    facts.developmentActivity.value
      ? `**Development applications:** ${facts.developmentActivity.value} — ${evidenceRef(facts.developmentActivity)}.`
      : `**Development applications:** ${absenceText(facts.developmentActivity)}`,
    '',
  );

  // Rules 3 and 6, said on the page rather than left to a reader to infer.
  lines.push(
    `**What this is.** These readings are desktop research against the jurisdiction's published spatial layers, `
    + `retrieved automatically at the property's verified coordinate. They are not a planning certificate and do not `
    + `substitute for one. ${facts.verification}`,
  );
  lines.push('');
  lines.push(
    '**What a zone is not.** A zone that admits a use is not consent for it. Any development potential described here '
    + 'is conditional on assessment against the scheme and remains subject to approval; nothing in this report is an '
    + 'approval, a pre-lodgement view, or evidence that one would be granted.',
  );
  if (facts.zoning.status !== 'stated' && facts.zoning.status !== 'operator_stated') {
    lines.push('');
    lines.push(
      '**No zone was retrieved for this property.** The rows above say which kind of absence each one is. '
      + 'A blank is not a finding that the control does not apply.',
    );
  }
  return lines.join('\n');
}

/**
 * The rules the prose beside the table must obey.
 *
 * Deliberately NOT a second copy of the readings: `planningStatBlocks`
 * already puts the measured cells in the prompt and `renderPlanningControls`
 * hands over the table itself, so repeating them here would give a model
 * three versions of one fact to choose between. What was missing was the
 * prohibitions — the old template offered `[XX]%` site coverage, `[X]m`
 * setbacks and "typically 450m²" with nothing to fill them from, and a model
 * asked for a control it has not been given supplies a plausible one.
 */
export function planningFactBlocks(facts: PlanningFacts): string {
  if (facts.enrichmentMissing) {
    return 'PLANNING RULES FOR THE WHOLE REPORT — no planning enrichment ran. State in one sentence that '
      + 'zoning and planning controls were not retrieved and must be confirmed with the local planning '
      + 'authority. Do NOT print a zoning table, a control table, a minimum lot size, a height limit, a '
      + 'floor space ratio, a setback, a site coverage figure or an overlay finding. Do NOT name a planning '
      + 'instrument. This holds in every section, and a figure found by live web search is still a figure '
      + 'this report did not retrieve.';
  }
  const instrumentRule = facts.jurisdiction === 'NSW'
    ? '3. This property is in New South Wales, so the Local Environmental Plan, the Development Control Plan and '
      + 'the s10.7 certificate are the right instruments to name.'
    : '3. This property is in ' + (facts.jurisdiction ?? 'a jurisdiction the layers did not resolve')
      + '. Do NOT mention a Local Environmental Plan, a Development Control Plan or a s10.7 planning certificate — '
      + 'those are New South Wales instruments and do not exist here. Name only the instrument in the verification '
      + 'sentence.';
  return [
    'PLANNING RULES FOR THE WHOLE REPORT — they apply in every section, including risk registers, '
    + 'checklists, summaries and verdicts, and they override any example elsewhere in this prompt AND '
    + 'anything a live web search returns. A portal, a listing site or a news page is not a retrieval: '
    + 'if a control is not in the table below, this report did not retrieve it.',
    '1. The planning controls table above is supplied complete. Reproduce it EXACTLY as given. Do not add a row, '
    + 'a column, a figure or a bracketed placeholder to it.',
    '2. Do NOT state a minimum lot size, maximum building height, floor space ratio, site coverage, setback, '
    + 'landscaping percentage, parking minimum or overlay finding that is not in the table. There is no typical '
    + 'value and no default. If it is not in the table it was not retrieved, and the correct sentence says so.',
    instrumentRule,
    '4. An absence in the table is a statement about what was retrieved, never a finding about the land. Never write '
    + 'that no overlay applies, that the property is not heritage listed, or that it is not flood or bushfire affected — '
    + 'not in prose, not in a risk register row, not in a checklist, and not on the authority of a listing portal or a '
    + 'property data site. Those report what they hold, not what the council scheme maps.',
    '5. A zone that admits a use is not approval for it. Describe any development potential as conditional and subject '
    + 'to assessment, and never quantify an uplift.',
    '6. Say plainly that this is desktop research and that the verification instrument is what settles it.',
  ].join('\n');
}
