/**
 * The infrastructure and development a report may describe, and what each
 * item's status actually rests on.
 *
 * ## The defect this exists to end
 *
 * The prompt asked for an infrastructure pipeline whether or not a single
 * project was evidenced. Its own worked examples were the shape of the
 * problem: a SWOT strength reading *"**Metro connectivity:** [Metro Line]
 * opened [Year], fundamentally improving transport profile … This
 * infrastructure investment typically drives long-term capital growth"*, an
 * opportunity reading *"**Infrastructure development:** Planned residential
 * and commercial developments in [Suburb] region support continued population
 * growth and property appreciation"*, and a directive requiring every
 * pipeline to be drawn as a `{{timeline: Existing … 0-2y … 3-5y … 5y+}}`
 * ribbon. None of that is a question a model can answer from the record, so
 * what came back was a plausible pipeline: named projects, horizons, and a
 * causal claim about capital growth, with nothing behind any of it.
 *
 * Meanwhile the enrichment already holds evidenced development facts and the
 * outlook sections used none of them — the same shape as the zoning section
 * (`planningFacts.pure.ts`). Queensland's StatePlanning layers answer, at the
 * property's own coordinate, whether it sits inside a declared priority
 * development area, state development area, coordinated project or
 * infrastructure designation, each with the publisher's own status word and
 * its gazettal date. New South Wales' Online DA register answers what has
 * been lodged and determined in the council over a stated window, with costs,
 * dwelling counts and the largest applications by cost.
 *
 * ## The rules
 *
 * 1. **A project is named only where a register named it.** There is no
 *    inferred pipeline and no horizon a publisher did not state.
 * 2. **A status is the publisher's own word.** The vocabulary a reader needs
 *    — proposed, approved, funded, under construction, completed, delayed,
 *    cancelled — is added in parentheses ONLY where the publisher's word maps
 *    onto it unambiguously. An unrecognised word is printed as it stands
 *    rather than forced into a category it may not belong in. Approval is not
 *    funding and funding is not delivery, so nothing here promotes one to
 *    another.
 * 3. **A completion date is never invented.** A gazettal or determination
 *    date is a date something HAPPENED, and it is labelled as that. Where a
 *    register states no delivery date, the item says so.
 * 4. **An announcement is never a capital-growth claim.** Nothing composed
 *    here quantifies an uplift or asserts that a project will raise values,
 *    and the rules handed to the model forbid it in the prose beside this.
 * 5. **Coverage is stated honestly, every time.** What these two registers do
 *    NOT cover — council capital works, state budget programmes, agency
 *    announcements, transport and utility projects — is named on the page, so
 *    a short list reads as a short search rather than a quiet area.
 * 6. **Development nearby cuts both ways.** Dwellings in the pipeline are
 *    competing supply as well as a sign of confidence, and the reading says
 *    so rather than filing them under opportunity.
 * 7. **An absence may not be rated.** A register that answered nothing has
 *    measured the SEARCH, not the area, so nothing it returned can carry a
 *    risk rating, a score or a favourable finding. 262 Pallas Street is what
 *    this exists for: its risk register read *"Infrastructure timing and
 *    pipeline | **Low** | The absence of a named infrastructure pipeline in
 *    the registers searched means this property's performance is tied to
 *    broader Maryborough fundamentals"*, chipped **Verified**. Two things go
 *    wrong there and rules 7 and 8 close one each. The **Low** is a
 *    conclusion about the area drawn from the coverage of a search — and the
 *    coverage statement three paragraphs above it says these registers do not
 *    reach council capital works, budget programmes or agency announcements,
 *    which is where a regional centre's infrastructure actually lives. It is
 *    the asymmetry this repository has already written down twice: *a stop
 *    found is a fact about the area; no stop found is a fact about the
 *    FEEDS*, and a sanctions hit is a signal while a miss says nothing.
 * 8. **An evidence note describes the retrieval, never the conclusion beside
 *    it.** "Verified" was true of the layer reading on that row — the four
 *    Queensland layers were checked at the coordinate and matched nothing —
 *    and it was written against the *rating*, lending a retrieval's
 *    verification to an inference the retrieval does not support.
 * 9. **The two absences are different sentences.** `none_at_point` is a
 *    register that was asked here and holds nothing here; everything else is
 *    a register that was never asked at all. That row called the Queensland
 *    development-application register one of "the registers searched", and it
 *    cannot be searched — no state-wide feed is published for the
 *    jurisdiction. `absences` was a flat list of strings, so the prose had no
 *    way to tell them apart.
 * 10. **One designation, one row — and identity is confirmed before anything
 *    is merged.** The two Queensland sources read the SAME MapServer: the
 *    instruments probe asks layers 25/30/35/40 one at a time, the constraint
 *    register calls `identify` with `layers: all` on the same service. So a
 *    property inside a priority development area got two rows that disagreed
 *    on every cell but the name (executed 18 Sep 2026). Merging is on the
 *    publisher's own source string plus the publisher's own name, equal after
 *    trim, case-fold and whitespace collapse — never on token overlap, edit
 *    distance or a shared word. Two projects that read alike are two
 *    projects, and merging them deletes one; nothing merges across sources at
 *    all. The layer-specific reading wins, because it parses that layer's own
 *    fields where the identify-all row parses whatever the server offered.
 *
 * Pure: no fetch, no Deno, no clock.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** What a reader needs to know about where a project has got to. */
export type DeliveryStanding =
  | 'proposed'
  | 'approved'
  | 'funded'
  | 'under_construction'
  | 'completed'
  | 'delayed'
  | 'cancelled';

export const DELIVERY_STANDING_LABEL: Readonly<Record<DeliveryStanding, string>> = {
  proposed: 'Proposed',
  approved: 'Approved',
  funded: 'Funded',
  under_construction: 'Under construction',
  completed: 'Completed',
  delayed: 'Delayed',
  cancelled: 'Cancelled',
};

/**
 * A publisher's status word, read onto the reader's vocabulary — or not.
 *
 * Deliberately narrow (rule 2). Every entry is a phrase a register actually
 * publishes, and anything else answers null so the publisher's own word is
 * printed unmapped. "Approved" is never read as funded and "funded" is never
 * read as under construction: those are the three a reader most wants
 * collapsed and the three it would be most expensive to collapse wrongly.
 */
export function readDeliveryStanding(raw: string | null): DeliveryStanding | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^(lodged|under assessment|pending|on exhibition|proposed|nominated)\b/.test(s)) return 'proposed';
  if (/^(approved|determined - approved|determination - approved|granted|declared|gazetted)\b/.test(s)) return 'approved';
  if (/^(funded|committed|budgeted)\b/.test(s)) return 'funded';
  if (/^(under construction|construction|commenced|in delivery)\b/.test(s)) return 'under_construction';
  if (/^(complete|completed|finalised|operational)\b/.test(s)) return 'completed';
  if (/^(deferred|delayed|on hold|paused)\b/.test(s)) return 'delayed';
  if (/^(withdrawn|refused|rejected|cancelled|lapsed|discontinued)\b/.test(s)) return 'cancelled';
  return null;
}

/**
 * A register that returned no item, and whether it was actually asked.
 *
 * Rule 9. The planning service publishes five distinct absences
 * (`none_at_point`, `not_served`, `not_integrated`, `licence_restricted`,
 * `unavailable`) and this collapses them onto the ONE distinction a reader's
 * conclusion turns on: was the question put, or not.
 */
export interface RegisterReading {
  /** Which register, in words a reader can match to the sentence. */
  register: 'development instruments' | 'development applications';
  /**
   * `searched_empty` — the register was asked at this location and answered
   * that it holds nothing here. Within that register's own coverage, that is
   * a fact about the AREA.
   *
   * `not_searched` — nothing was asked. The jurisdiction publishes no such
   * register, the layer is not integrated, its licence forbids it, or the
   * request failed. That is a fact about THIS PLATFORM, and no finding about
   * the area follows from it at all.
   */
  reading: 'searched_empty' | 'not_searched';
  /** The service's own note, verbatim. */
  note: string;
}

export interface InfrastructureItem {
  /** What it is, in the publisher's own words. */
  name: string;
  /**
   * The publisher's own reference for it — a council application number, an
   * instrument's identifier. Null where the publisher gave none.
   *
   * A reader asked to act on an entry has to be able to look it up, and the
   * rendered table named a concatenated list of development types ("Alterations
   * or additions to an existing building or structure, High technology
   * industry, Data centre") with no number and no address, while the register
   * carried both. Identity is the first of the six things the brief asks for
   * per project.
   */
  reference: string | null;
  /** The kind of instrument or application. */
  kind: string;
  /** The publisher's status word, verbatim. Null where it stated none. */
  statedStatus: string | null;
  /** That word read onto the reader's vocabulary, where it maps (rule 2). */
  standing: DeliveryStanding | null;
  /** A date something HAPPENED, with what happened. Never a forecast (rule 3). */
  dateLabel: string | null;
  date: string | null;
  /** Where, as the register states it. Null where it states nothing. */
  where: string | null;
  /** The full address the register states, where it states one. */
  address: string | null;
  /**
   * The cost the register states, where it carries one.
   *
   * **It is a cost and not funding.** A development-application register
   * carries the APPLICANT'S OWN stated cost of development; no register this
   * platform reads publishes who is paying or whether anything is funded, and
   * the brief asks for funding per project. Saying so is the only honest
   * answer; printing a dollar figure with no qualifier lets it read as one.
   */
  statedCost: number | null;
  /**
   * What the publisher says about WHEN this will be delivered.
   *
   * Null on every entry from a DA register, which publishes decision and
   * lodgement dates and no delivery date at all. The brief requires unknown
   * timing to be explicit, so this is rendered as its own statement per entry
   * rather than left to a footnote at the end of the table.
   */
  statedDelivery: string | null;
  /**
   * Present ONLY for an entry that came from an application register.
   *
   * A development amended three times is one development, and the reader is
   * told it was amended rather than shown three copies of it. Null on a
   * gazetted instrument or a strategic designation, which are not
   * applications and have no window — as a sub-object rather than three
   * fields, so a reader can never take a `false` about something that was
   * never asked.
   */
  applications: {
    inWindow: number;
    amendments: number;
    /** No new application falls inside the window — it was approved earlier. */
    approvedBeforeWindow: boolean;
  } | null;
  /** The publisher and dataset. */
  source: string;
  licence: string | null;
  /** When this deployment retrieved it. */
  retrievedAt: string | null;
}

export interface InfrastructureEvidence {
  items: InfrastructureItem[];
  /** Dwellings the register says are in the pipeline nearby, and over what. */
  pipelineDwellings: { total: number; rowsStating: number; window: string; council: string } | null;
  /** Aggregate stated investment, with how many rows stated one. */
  pipelineInvestment: { total: number; rowsStating: number } | null;
  /**
   * How much of the register these totals were summed from.
   *
   * `daActivityLine` already discloses a partial walk on the planning
   * controls line; the pipeline paragraph did not, and the pipeline paragraph
   * is where the money is. The Kellyville report printed "680 new dwellings …
   * $808,649,729" from **300 of the 650 applications the register stated**,
   * with nothing on the page saying so. Reading the rest gives 3,442 and
   * $2.364bn on the same counting rule — so the published figures were not
   * merely stale, they were a little over a third of the register, presented
   * as the register.
   *
   * Null where the reading carried no walk figures at all, which is a
   * different statement from a complete walk.
   */
  registerWalk: { rowsRead: number; totalStated: number } | null;
  /**
   * Why an empty list is empty, per register — as strings, for the persisted
   * record and for every caller that already reads it.
   */
  absences: string[];
  /**
   * The same absences, typed, so the prose can say which kind each one is
   * (rule 9). Derived from `absences`' own readings rather than beside them,
   * so the two can never disagree.
   */
  readings: RegisterReading[];
  /** What these registers do not reach at all (rule 5). */
  coverageLimits: string[];
  retrievedAt: string | null;
  /** True when at least one register answered with something. */
  anyEvidenced: boolean;
  /** True when the enrichment never ran. */
  enrichmentMissing: boolean;
}

const INSTRUMENT_LABEL: Record<string, string> = {
  priority_development_area: 'Priority development area',
  state_development_area: 'State development area',
  coordinated_project: 'Coordinated project',
  infrastructure_designation: 'Infrastructure designation',
};

/**
 * What these two registers cannot see.
 *
 * Named on every reading, including a full one, because a list of two
 * instruments with no coverage statement reads as "these are the projects
 * around this property" — which is a claim neither register makes.
 */
export const INFRASTRUCTURE_COVERAGE_LIMITS: readonly string[] = [
  'council capital works programmes and their budgets',
  'state and federal budget infrastructure programmes',
  'transport, water, energy and health agency project announcements',
  'projects outside the local government area the registers were asked about',
];

export interface InfrastructureEvidenceInput {
  /** `enhancedData.planningData` — the planning service's answer, or absent. */
  planningData?: unknown;
}

export function buildInfrastructureEvidence(input: InfrastructureEvidenceInput): InfrastructureEvidence {
  const data = isRecord(input.planningData) ? input.planningData : null;
  const retrievedAt = data ? str(data.fetchedAt) : null;
  const items: InfrastructureItem[] = [];
  const readings: RegisterReading[] = [];

  /*
   * A register that answered nothing, filed by whether it was asked (rule 9).
   *
   * `none_at_point` is the ONLY status that means the question was put and
   * the answer was "nothing here". `not_served`, `not_integrated`,
   * `licence_restricted` and `unavailable` all mean no question was put, for
   * four different reasons — and a report that describes any of them as a
   * register it searched has stated something false about its own evidence.
   */
  const note = (
    register: RegisterReading['register'],
    block: Record<string, unknown>,
    fallback: string,
  ): void => {
    readings.push({
      register,
      reading: str(block.status) === 'none_at_point' ? 'searched_empty' : 'not_searched',
      note: str(block.note) ?? fallback,
    });
  };

  /*
   * ── one designation, one row (rule 10) ───────────────────────────────────
   *
   * The two Queensland sources overlap, and the overlap is exact rather than
   * incidental. `QLD_INSTRUMENT_LAYERS` queries layers 25, 30, 35 and 40 of
   * `PlanningCadastre/StatePlanning/MapServer` one at a time; the constraint
   * register calls `identify` on the SAME MapServer with `layers: all`, so a
   * priority development area at the point comes back from both, and
   * `classify()` files the second copy under `growthArea` / `context`.
   *
   * Executed 18 Sep 2026: one designation produced two rows disagreeing on
   * every cell but the name — `Priority development area` / `Declared` /
   * `PLA-MBH` beside `Growth / priority area` / `Statutory` / `Wide Bay
   * Burnett Regional Plan`. That is the legacy report's own failure, the one
   * `compassDocumentContract` was written against: three copies of one zoning
   * section on one lot disagreeing on every control.
   *
   * §9's rule is **confirm project identity before deduplication**, so this
   * merges on identity and never on resemblance: the SAME publisher's source
   * string, and the publisher's own name equal after trimming, case-folding
   * and collapsing internal whitespace. No token overlap, no edit distance,
   * no stemming — two projects that merely read alike are two projects, and
   * a report that merged them would have deleted one.
   *
   * The instrument reading wins because it is the more specific read: it
   * queries the named layer and parses that layer's own fields (`pda_name`,
   * `pda_status`, `gazetted_date`), where the identify-all row is a generic
   * parse of whatever the server volunteered. Nothing is merged across
   * sources — a council development application and a state instrument are
   * never one item however alike their names — and the suppression is silent,
   * because a client document does not narrate its own production.
   */
  const identityOf = (name: string, source: string | null): string =>
    `${(source ?? '').trim().toLowerCase()}\u0000${name.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  const instrumentIdentities = new Set<string>();

  // ── state development instruments, at the property's own coordinate ───────
  const inst = isRecord(data?.developmentInstruments) ? data!.developmentInstruments : null;
  if (inst?.status === 'ok' && Array.isArray(inst.instruments)) {
    const source = str(inst.source) ?? 'state planning layers';
    const licence = str(inst.licence);
    for (const raw of inst.instruments as unknown[]) {
      if (!isRecord(raw)) continue;
      const name = str(raw.name);
      if (!name) continue;
      const statedStatus = str(raw.status);
      instrumentIdentities.add(identityOf(name, source));
      items.push({
        name,
        kind: INSTRUMENT_LABEL[str(raw.kind) ?? ''] ?? (str(raw.kind) ?? 'Instrument'),
        statedStatus,
        standing: readDeliveryStanding(statedStatus),
        // A gazettal is a declaration, not a delivery. Rule 3.
        dateLabel: str(raw.gazetted) ? 'Gazetted' : null,
        date: str(raw.gazetted),
        where: str(raw.detail),
        // An instrument applies over an area rather than to an address, and
        // no layer read here publishes a delivery date or a cost.
        address: null,
        reference: str(raw.reference),
        statedCost: null,
        statedDelivery: null,
        applications: null,
        source,
        licence,
        retrievedAt,
      });
    }
  } else if (inst) {
    note('development instruments', inst, 'No state development-instrument reading for this point.');
  }

  /*
   * ── the strategic designations the point sits inside ─────────────────────
   *
   * Added 17 Sep 2026, and the measurement is why. The instruments probe asks
   * four named Queensland layers — priority development areas, state
   * development areas, coordinated projects, infrastructure designations — and
   * at 262 Pallas Street none of them matched, so the report said "the
   * property lies inside no declared priority development area, state
   * development area, coordinated project or infrastructure designation" and
   * stopped. True, and it left out what the SAME service returns at the SAME
   * coordinate: `Maryborough Priority Living Area`, inside the `Wide Bay
   * Burnett Regional Plan`, **Legal status: Statutory, Version: December
   * 2023**.
   *
   * A regional plan does not control what is built on one lot, and nothing
   * here says it does — `standing` is null and the kind is the register's own
   * word. What it does is state, in the publisher's own instrument, what the
   * area is planned to BECOME, which is the most reliable published statement
   * about long-term direction a report of this kind can carry. The legacy
   * long-form report filled that space by inventing a station, a freeway
   * extension and a dwelling target.
   *
   * It is drawn from the constraint register's `context` readings alone.
   * Anything the register filed as a hazard, a development control or a
   * protected value belongs to the planning section, not to this one.
   */
  const contextual = Array.isArray(data?.constraints) ? data!.constraints as unknown[] : [];
  for (const raw of contextual) {
    if (!isRecord(raw)) continue;
    if (str(raw.kind) !== 'context') continue;
    const name = str(raw.label);
    if (!name) continue;
    // Rule 10: the same publisher's same designation, already carried by the
    // layer-specific read above.
    const contextSource = str(raw.source) ?? 'state planning layers';
    if (instrumentIdentities.has(identityOf(name, contextSource))) continue;
    const family = str(raw.family);
    items.push({
      name,
      kind: family === 'regionalPlan' ? 'Regional plan'
        : family === 'growthArea' ? 'Growth / priority area'
          : 'Strategic designation',
      /*
       * The publisher's own word for the instrument's standing, and NOT
       * `detail`.
       *
       * `detail` is a join of everything the layer published — legal status,
       * version, region, hazard class — which reads correctly in the planning
       * register's "What the register returned" column and is wrong in a
       * column called **Status**. On 262 Pallas Street the Priority Living
       * Area's `detail` is `Wide Bay Burnett`, so the first render of this
       * table gave a project the status "Wide Bay Burnett", which is a region.
       *
       * Where the register stated no standing the cell is empty, and the
       * renderer prints an em dash: a designation with no published standing
       * is a real state, and inventing one is the defect above in the other
       * direction.
       */
      statedStatus: str(raw.standingLabel),
      // A designation is not a project and has no delivery standing. Reading
      // one as `approved` would put a plan in the same column as a road under
      // construction.
      standing: null,
      dateLabel: str(raw.currencyDate) ? 'Current at' : null,
      date: str(raw.currencyDate),
      // The region the register named — a place. It used to be `instrument`,
      // which is a layer or plan name: "Priority Living Area" is not a WHERE,
      // and on the regional-plan row it repeated the project's own name.
      where: str(raw.region),
      // A designation covers an area rather than an address, states no cost,
      // and publishes no delivery date — it says what the area is planned to
      // BECOME, on a horizon nobody has dated.
      address: null,
      reference: str(raw.instrument),
      statedCost: null,
      statedDelivery: null,
      applications: null,
      source: contextSource,
      licence: str(raw.licence),
      retrievedAt,
    });
  }

  // ── the council's own development-application register ────────────────────
  const act = isRecord(data?.developmentActivity) ? data!.developmentActivity : null;
  const summary = act?.status === 'ok' && isRecord(act.summary) ? act.summary : null;
  let pipelineDwellings: InfrastructureEvidence['pipelineDwellings'] = null;
  let pipelineInvestment: InfrastructureEvidence['pipelineInvestment'] = null;
  let registerWalk: InfrastructureEvidence['registerWalk'] = null;
  if (summary) {
    const source = str(act?.source) ?? 'the council development-application register';
    const licence = str(act?.licence);
    const council = str(summary.councilName) ?? 'the council';
    // The reader's date, not the register's. This printed the ISO pair
    // verbatim — "2026-03-18 to 2026-09-17" — in a sentence otherwise written
    // in English, on the same page as `27 Feb 2026` and `7 Aug 2026`. Two
    // date formats in one document is a raw marker like any other.
    const window = [auDate(str(summary.periodFrom)), auDate(str(summary.periodTo))]
      .filter(Boolean).join(' to ');
    // NEW applications only. A modification restates the development it
    // modifies — the register carries the whole cost and the whole dwelling
    // count on the modification row, not the delta — so the two may never be
    // added. Measured on this register 17 Sep 2026 (The Hills Shire, 659
    // applications over six months): summing them stated $2.367bn against
    // $1.177bn of genuinely new proposals, and 3,447 dwellings against 1,412.
    // See `classifyApplicationType`.
    const newApps = isRecord(summary.newApplications) ? summary.newApplications : null;
    const dwellings = num(newApps?.newDwellingsTotal);
    if (dwellings !== null) {
      pipelineDwellings = {
        total: dwellings,
        rowsStating: num(newApps?.rowsWithDwellings) ?? 0,
        window,
        council,
      };
    }
    const cost = num(newApps?.statedCostTotal);
    if (cost !== null) {
      pipelineInvestment = { total: cost, rowsStating: num(newApps?.rowsWithCost) ?? 0 };
    }
    const rowsRead = num(summary.rowsRead);
    const totalStated = num(summary.totalInPeriod);
    if (rowsRead !== null && totalStated !== null) registerWalk = { rowsRead, totalStated };
    // One entry per DEVELOPMENT. `summariseDaRows` resolves an amendment to
    // the parent application it amends (see `DaDevelopment`), because the
    // list used to rank ROWS: three of the five largest "projects" on the
    // rendered Kellyville report were 1382/2025/JP/A, /B and /C — one data
    // centre at 3 Brookhollow Avenue, printed three times at $93,180,778.
    for (const raw of Array.isArray(summary.largestDevelopments) ? summary.largestDevelopments as unknown[] : []) {
      if (!isRecord(raw)) continue;
      const types = Array.isArray(raw.types) ? (raw.types as unknown[]).map((t) => str(t)).filter((t): t is string => !!t) : [];
      const statedStatus = str(raw.status);
      const amendments = num(raw.amendmentsInWindow) ?? 0;
      const approvedBefore = raw.parentOutsideWindow === true;
      items.push({
        name: types.length ? types.join(', ') : 'Development application',
        reference: str(raw.reference),
        // Named for what the register holds. A development that reaches this
        // window only through its amendments was approved before it, and a
        // reader told "Development application" would read it as new. How
        // many times it was amended is the cell's business, not the kind's.
        kind: approvedBefore ? 'Approved development' : 'Development application',
        statedStatus,
        standing: readDeliveryStanding(statedStatus),
        // A determination date is when a decision was made; a lodgement date
        // is when one was asked for. Neither is a completion date (rule 3).
        dateLabel: raw.latestDateKind === 'determined'
          ? 'Determined' : raw.latestDateKind === 'lodged' ? 'Lodged' : null,
        date: str(raw.latestDate),
        where: str(raw.suburb),
        address: str(raw.address),
        statedCost: num(raw.statedCost),
        // A DA register publishes no delivery date, for any application. Rule
        // 3 already forbids reading a decision date as a completion date; this
        // says the absence out loud per entry rather than once at the foot.
        statedDelivery: null,
        applications: {
          inWindow: num(raw.rowsInWindow) ?? 1,
          amendments,
          approvedBeforeWindow: approvedBefore,
        },
        source,
        licence,
        retrievedAt,
      });
    }
  } else if (act) {
    note('development applications', act, 'No development-application register reading for this jurisdiction.');
  }

  return {
    items,
    pipelineDwellings,
    pipelineInvestment,
    // The strings stay exactly what they were, in exactly the order they were
    // pushed, so the persisted record and every existing reader are unchanged.
    absences: readings.map((r) => r.note),
    readings,
    registerWalk,
    coverageLimits: [...INFRASTRUCTURE_COVERAGE_LIMITS],
    retrievedAt,
    anyEvidenced: items.length > 0 || pipelineDwellings !== null,
    enrichmentMissing: !data,
  };
}

// ---------------------------------------------------------------------------
// Rendering

/** `1 Jan 2026` from an ISO date, or the string back if it is not one. */
function auDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

const money = (v: number): string => `$${Math.round(v).toLocaleString('en-AU')}`;

/**
 * The funding cell.
 *
 * Every register this platform reads publishes a COST and no funding at all —
 * a development application states what the applicant says the work will
 * cost, which says nothing about who is paying or whether anything is
 * committed. The brief asks for funding per project, so the answer is stated
 * rather than left as an empty cell a reader fills in from the figure beside
 * it.
 */
function fundingCell(item: InfrastructureItem): string {
  return item.statedCost !== null
    ? 'Not stated — the figure is the applicant\u2019s own cost of development'
    : 'Not stated by this register';
}

/**
 * The type cell, and how many times the register was asked about it again.
 *
 * Three rows for one data centre is what this replaces, so the amendments are
 * counted in the entry rather than printed as more entries.
 */
function kindCell(item: InfrastructureItem): string {
  const a = item.applications;
  if (!a || a.amendments < 1) return item.kind;
  return `${item.kind} · amended ${a.amendments} time${a.amendments === 1 ? '' : 's'} in this window`;
}

/** The status cell: the publisher's word, and the reading where one is certain. */
function statusCell(item: InfrastructureItem): string {
  if (!item.statedStatus) return 'Status not stated by the register';
  const read = item.standing ? DELIVERY_STANDING_LABEL[item.standing] : null;
  return read && read.toLowerCase() !== item.statedStatus.toLowerCase()
    ? `${item.statedStatus} (${read})`
    : item.statedStatus;
}

/**
 * What part of the register a total was summed from, where that is not all of
 * it. Empty on a complete walk — a sentence saying "all of it" on every
 * complete reading is noise, and the figures then mean what they say.
 */
function walkNote(walk: InfrastructureEvidence['registerWalk']): string {
  if (!walk || walk.rowsRead >= walk.totalStated) return '';
  const n = (v: number) => v.toLocaleString('en-AU');
  return `Both totals were summed from ${n(walk.rowsRead)} of the ${n(walk.totalStated)} applications the register `
    + 'states for this window, so each is a FLOOR rather than a total: reading the remainder can only raise it. ';
}

/**
 * The evidenced outlook a client reads.
 *
 * Composed here rather than asked of a model, because every row is either
 * retrieved or absent and neither is a writing task.
 */
export function renderInfrastructureOutlook(evidence: InfrastructureEvidence): string {
  const lines: string[] = [];

  if (evidence.items.length) {
    // The six things the brief asks for per project: identity, location,
    // source date, recorded status, funding and published delivery timing.
    // Identity is the publisher's own reference — the table used to open on a
    // joined list of development types with no number and no address, so
    // nothing in it could be looked up. Funding and timing get columns of
    // their own precisely BECAUSE no register read here publishes either:
    // an absence stated in a footnote is an absence most readers never see.
    lines.push('| Reference | Project or instrument | Type | Status | Date recorded | Where | Stated cost | Funding | Delivery timing |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    for (const i of evidence.items) {
      const when = i.date ? `${i.dateLabel ?? 'Recorded'} ${auDate(i.date)}` : 'No date stated';
      const where = i.address ?? i.where ?? '—';
      lines.push(
        `| ${i.reference ?? '—'} | ${i.name} | ${kindCell(i)} | ${statusCell(i)} | ${when} | ${where} | `
        + `${i.statedCost !== null ? money(i.statedCost) : '—'} | ${fundingCell(i)} | `
        + `${i.statedDelivery ?? 'Not published by this register'} |`,
      );
    }
    lines.push('');
    const sources = [...new Set(evidence.items.map((i) => `${i.source}${i.licence ? ` (${i.licence})` : ''}`))];
    lines.push(`Sources: ${sources.join('; ')}. Retrieved ${auDate(evidence.retrievedAt) ?? 'this run'}.`);
    lines.push('');

    /*
     * How to count this table, said on the page.
     *
     * `summariseDaRows` already resolves an amendment to the development it
     * amends, so the table is right — and the RENDERED Kellyville report still
     * read "**Three separate data centre and high-technology industry projects
     * in Norwest**, each with stated costs of **$93.18 million**", drew a
     * timeline stop saying "three approvals at $93.18m", and put "three
     * determined Norwest applications each at $93,180,778" in its risk
     * register. There is ONE data centre: PAN-619414, PAN-643600 and PAN-638082
     * carry the same coordinate (150.968022088, -33.73252699), the same lot
     * (2021/DP831173), the same address and the same $93,180,778, and the
     * council numbers are 1382/2025/JP/A, /B and /C.
     *
     * The fix that resolved them into one row is also what invites the error
     * now: a cell reading "amended 3 times in this window" is a reasonable
     * thing to read as three approvals. Saying what the count IS costs one
     * sentence and reaches the reader as well as the model — the prose above
     * was wrong by about $186 million, and a reader had nothing on the page to
     * check it against.
     */
    const withApps = evidence.items.filter((i) => i.applications);
    if (withApps.length) {
      const rowsBehind = withApps.reduce((n, i) => n + (i.applications?.inWindow ?? 1), 0);
      const amended = withApps.filter((i) => (i.applications?.amendments ?? 0) > 0).length;
      const plural = (n: number, one: string) => `${n.toLocaleString('en-AU')} ${one}${n === 1 ? '' : 's'}`;
      lines.push(
        `**How to count these.** ${plural(withApps.length, 'development')} from the application register `
        + `${withApps.length === 1 ? 'is' : 'are'} listed above, resolved from ${plural(rowsBehind, 'register row')}.`
        + (amended
          ? ' An amendment restates the development it amends — the register carries the WHOLE cost and the whole'
            + ' dwelling count on the amendment row rather than the change — so a development amended three times'
            + ' is one development, its stated cost is counted once, and the amendment count is not a number of'
            + ' projects.'
          : ''),
      );
      lines.push('');
    }
  }

  if (evidence.pipelineDwellings) {
    const d = evidence.pipelineDwellings;
    /**
     * Two counts, and each says what it counts.
     *
     * This read "680 new dwellings across 171 applications … with
     * $808,649,729 of stated development cost across 278 applications" — one
     * window, one council, two different application counts, and nothing
     * saying why they differ. A reader cannot tell whether 171 or 278 is the
     * number of applications, and the document looked as though it could not
     * add up.
     *
     * It always could. `rowsStating` is the rows that STATED that figure, and
     * an application need state neither a dwelling count nor a cost of
     * development — so the denominators are genuinely different and the
     * arithmetic was never wrong. Only the sentence was. Saying what each
     * count is makes both readings true of the same window.
     */
    const inv = evidence.pipelineInvestment;
    const apps = (n: number) => `${n.toLocaleString('en-AU')} application${n === 1 ? '' : 's'}`;
    lines.push(
      `**Dwellings in the register's pipeline.** ${d.total.toLocaleString('en-AU')} new dwellings were stated on `
      + `the ${apps(d.rowsStating)} that gave a dwelling count in ${d.council}${d.window ? `, ${d.window}` : ''}`
      + `${inv
        ? `, and ${money(inv.total)} of development cost on the ${apps(inv.rowsStating)} that gave a cost`
        : ''}. `
      + `${inv && inv.rowsStating !== d.rowsStating
        ? 'The two counts differ because an application need state neither figure, and many state only one. '
        : ''}`
      /*
       * And how much of the register they were summed from.
       *
       * A sum of non-negative figures over part of a set is a FLOOR, which is
       * the honest word: reading the rest can only raise it. The rendered
       * Kellyville report printed these two totals from 300 of 650 rows with
       * nothing saying so, and the complete walk on the same counting rule is
       * 3,442 dwellings and $2.364bn — so "680" and "$808,649,729" were not a
       * stale reading of the area, they were a third of the register
       * presented as the register.
       */
      + `${walkNote(evidence.registerWalk)}`
      + 'That is activity in the local government area, not at this address, and it reads both ways: it is a sign of '
      + 'confidence in the area and it is competing supply for a landlord letting a comparable dwelling.',
    );
    lines.push('');
  }

  /*
   * Each absence under the heading that is true of it (rule 9).
   *
   * Every one of these used to read "**Not retrieved.**", which is right for a
   * register nobody could ask and wrong for one that was asked and answered
   * "nothing here" — the Queensland layers were checked at this coordinate and
   * matched none of the four. Printing one heading over both is what let the
   * prose beside the table call an unsearchable register one of "the registers
   * searched".
   */
  for (const r of evidence.readings) {
    lines.push(r.reading === 'searched_empty'
      ? `**Searched, nothing found.** ${r.note} That is what these layers hold at this point, within the `
        + 'coverage stated below.'
      : `**Not searched.** ${r.note} No question was put to this register, so nothing about this area follows `
        + 'from it.');
    lines.push('');
  }

  // Rule 5, stated whether the list is long or empty.
  lines.push(
    '**What this covers, and what it does not.** These entries come from the planning registers this platform '
    + 'reads at the property\'s own coordinate and for its local government area. They do NOT cover '
    + `${evidence.coverageLimits.join(', ')}. A short list here is a statement about those registers rather than `
    + 'a finding that nothing is planned nearby, and it is not a basis for rating infrastructure risk as low: '
    // "a regional centre's" was wrong here and right in the rule it mirrors.
    // This paragraph draws on every property the platform reports on, and the
    // first two it was measured against are Maryborough and Kellyville — one
    // regional centre and one metropolitan Sydney suburb.
    + 'what these registers do not reach is where much of an area\u2019s infrastructure is actually recorded.',
  );
  lines.push('');
  lines.push(
    '**What a status means.** Each status above is the register\'s own word. An approval is not funding, funding is '
    + 'not a start on site, and a date recorded above is the date something was decided or declared — not a '
    + 'completion date. No delivery date is stated here unless a publisher stated one.',
  );

  return lines.join('\n');
}

/**
 * The rating prohibition, in the words the model is handed.
 *
 * Rules 7 and 8 of this module's header. It is one string because the two
 * branches below need the identical prohibition — a short list and an empty
 * one are the same mistake waiting to be made — and two copies of a rule is
 * how one screen comes to warn about something the other does not.
 */
const NO_RATING_FROM_AN_ABSENCE: readonly string[] = [
  'An absence may NOT be rated. Where a risk register, a scorecard, a SWOT table, a heat map or any other '
  + 'rating gives infrastructure a row, the rating cell reads "Not assessed" and the row states which registers '
  + 'were asked and which publish nothing. Never rate it Low, Minimal, Limited, Negligible, Favourable or any '
  + 'other reassuring value, and never file it as a strength or an opportunity. A register that returned '
  + 'nothing has '
  + 'measured the SEARCH, not the area — and the coverage sentence above names council capital works, budget '
  + 'programmes and agency announcements as things it does not reach, which is where much of an area\u2019s '
  + 'infrastructure is actually recorded.',
  'An evidence, confidence or verification note describes the RETRIEVAL and never the conclusion beside it. '
  + '"Verified" may be written of a register reading — that a layer was checked and answered nothing at this '
  + 'coordinate — and may NOT be written of a rating, an outlook, a recommendation or any inference drawn from '
  + 'it. Where the conclusion is yours rather than the register\u2019s, say so in those words.',
];

/**
 * How each register that returned nothing must be described (rule 9).
 *
 * A register asked at this point and a register that publishes nothing at all
 * are two different statements, and a report that calls the second one "a
 * register searched" has misdescribed its own evidence. The sentences are
 * generated per reading rather than written once, so a jurisdiction where both
 * kinds occur gets both.
 */
function registerSentences(readings: readonly RegisterReading[]): string[] {
  return readings.map((r, i) => r.reading === 'searched_empty'
    ? `1${String.fromCharCode(97 + i)}. The ${r.register} register WAS asked at this property\u2019s coordinate `
      + `and answered that it holds nothing here: "${r.note}" You may say it was checked and returned nothing. `
      + 'That is true of those layers at this point and of nothing else.'
    : `1${String.fromCharCode(97 + i)}. The ${r.register} register was NOT searched: "${r.note}" Do NOT write `
      + 'that it was searched, that it returned nothing, or that nothing was found in it. No question was put, '
      + 'so no finding about this area follows from it.');
}

/** The rules the prose beside the table must obey. */
export function infrastructureRules(evidence: InfrastructureEvidence): string {
  if (evidence.enrichmentMissing || !evidence.anyEvidenced) {
    return [
      'INFRASTRUCTURE RULES FOR THE WHOLE REPORT — nothing was retrieved for this property. They apply in '
      + 'every section, including risk registers, scorecards, SWOT tables, checklists, summaries and verdicts, '
      + 'and they override anything a live web search returns.',
      '1. Say in one sentence that no infrastructure project or development instrument was retrieved for this '
      + 'location, and that this is a statement about the registers this platform reads rather than a finding '
      + 'that nothing is planned.',
      ...registerSentences(evidence.readings),
      '2. Do NOT name a project, a rail line, a station, a hospital, a road upgrade, a town-centre renewal or a '
      + 'delivery horizon — not from a budget page, a news article or an agency media release found by search. '
      + 'Do NOT draw a `{{timeline: …}}` pipeline. There is nothing to put in it.',
      '3. Do NOT say that infrastructure supports, drives or underwrites capital growth for this property. That is '
      + 'a causal claim, and there is no project here to hang it on.',
      `4. ${NO_RATING_FROM_AN_ABSENCE[0]}`,
      `5. ${NO_RATING_FROM_AN_ABSENCE[1]}`,
    ].join('\n');
  }
  return [
    'INFRASTRUCTURE RULES FOR THE WHOLE REPORT — they apply in every section and override any example '
    + 'elsewhere in this prompt AND anything a live web search returns:',
    '1. The evidenced table above is supplied complete. Name only the projects in it. Do NOT add a rail line, a '
    + 'station, a hospital, a road upgrade or a town-centre renewal that is not in it — including one found by '
    + 'live web search — and do not invent a bracketed placeholder for one.',
    '2. Use each item\'s status as the table states it. An approval is not funding, funding is not a start on site, '
    + 'and none of them is a completion. Do NOT state or imply a completion date; the dates above are dates a '
    + 'decision or declaration was recorded.',
    '3. Do NOT quantify an uplift, a percentage or a dollar effect on value from any project, and do not assert '
    + 'that a project will raise prices or rents. Describe what is proposed or approved and let the reader weigh it.',
    '4. Dwellings in the pipeline are competing supply as well as a sign of confidence. Say both.',
    '5. Draw a `{{timeline: …}}` only from items in the table, and label each stop with what the table\u2019s '
    + 'date IS — "Determined Jul 2026", "Lodged Sep 2026", "Gazetted 2023". A timeline BUCKET is a delivery '
    + 'horizon and this table carries none, so never place an item in "0-2y", "3-5y", "5y+" or any other future '
    + 'bucket: that states a completion the register did not publish. Where every date in the table is a decision '
    + 'date, draw no horizon timeline at all, and if the table carries no dates, draw no timeline.',
    '4a. Where the paragraph under the table says the totals were summed from part of the register, say so '
    + 'whenever you use either figure, and call it a floor rather than a total. Do NOT present a partial sum as '
    + 'the area\u2019s development activity, and do not compare it with a figure read over a different share of '
    + 'the register.',
    '5a. An amendment is NOT another project. A row reading "amended 3 times in this window" is ONE development '
    + 'the register was asked about again; the applications behind it share an address, a lot and a cost, and the '
    + 'register carries the WHOLE cost on each row rather than the change. Never turn an amendment count into a '
    + 'number of projects, never multiply a stated cost by it, and never total the table by counting a '
    + 'development\u2019s cost once per amendment. The number of developments is the number of ROWS above, which '
    + 'the paragraph under the table states.',
    '6. Repeat the coverage limitation in your own words: these registers do not cover council capital works, '
    + 'budget programmes or agency announcements, so a short list is a short search.',
    `7. ${NO_RATING_FROM_AN_ABSENCE[0]} A SHORT list is the same mistake as an empty one: rate what the table `
    + 'states, never the length of it.',
    `8. ${NO_RATING_FROM_AN_ABSENCE[1]}`,
  ].join('\n');
}
