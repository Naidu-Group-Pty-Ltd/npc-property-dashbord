# What a report may state about approved dwelling supply

Read this before touching
`_shared/reports/market/openData/absBuildingApprovals.pure.ts`,
`_shared/reports/market/openData/absDataStructure.pure.ts`,
`_shared/reports/market/approvalsFactBlocks.pure.ts`,
`_shared/reports/market/approvalsRegisterRead.ts`, the `approvals` stage in
`market-sales-ingest`, or `scripts/market/abs-approvals-liveness.ts`.

## 1 · The finding

Supply is asked for by name in three prompts and was answered by no register.
The statewide report's section 9 carries

> `**Supply Pipeline Risk:** [New housing supply vs demand balance]`

— a bracketed slot with nothing behind it — its section 10 asks for hotspots
with a `Growth Forecast` column, and the Compass's strategic tier declares a
whole section, *Market Position, Competitive Landscape & Supply Pipeline*. The
only development evidence this platform held was **one state's**
development-application register.

That is exactly the shape `PLANNING_CONTROLS_IN_THE_REPORT.md` records: a
template slot, handed to a model with nothing to fill it from, **filled by the
model**. There was no reason to expect supply to have gone better than zoning
did.

ABS Building Approvals is the one free, keyless, national, sub-state, monthly
measure of approved dwelling supply, under CC BY 4.0. It is the floor beneath
every jurisdiction, exactly as `RES_DWELL_ST` is the floor beneath every price
series.

## 2 · Nothing about it is guessed

Three things are read from the publisher rather than typed, and each is a
defect this programme has already paid for once:

| What | Read from | Why not a constant |
| --- | --- | --- |
| The dataflow | the ABS's own catalogue | the version is part of an SDMX identifier and the ABS reissues it; a stale constant 404s in a way that reads exactly like an outage |
| The edition | the catalogue's own names | the Bureau publishes one flow per edition, not one per subject |
| The query key | the flow's own data structure | an SDMX key is POSITIONAL, and one typed against the wrong positions returns a plausible, wrong slice under an HTTP 200 |

The last one is the mistyped Airtable column with a success code in front of
it, which is why it is the one that most needed reading rather than assuming.

## 3 · What the Bureau actually sends

Measured from a CI runner, 21 Sep 2026. The development egress cannot reach
`data.api.abs.gov.au` — the gateway answers **403 to CONNECT**, and prints
*"Host not in allowlist"*, which is how the check tells a gateway's refusal
from the Bureau's — so every number here is `abs-register-liveness`'s.

```
SA2, 12 months   200    490.8 MB   60.0 s   DID NOT FINISH
SA2, 36 months   200   5045.4 MB   60.1 s   DID NOT FINISH
LGA, 12 months   200     61.8 MB    1.6 s   complete
LGA, 36 months   200     61.8 MB   10.0 s   complete
```

Four things follow, and three of them were surprises.

**`/all` at the finest grain cannot be carried.** An edge function has a
~150 s wall clock; the SA2 download was past five gigabytes and still running
after sixty seconds.

**The window is not the lever.** The two LGA windows are byte-identical, and
the reason is not that the ABS disregards `startPeriod` — it is that
`BA_LGA2026` holds **one month** (2026-07). Shrinking a period cannot shrink a
cube that is wide rather than long.

**The history is in the PRIOR edition.** `BA_LGA2025` answered 470.8 MB from
2025-01 and 528.0 MB from 2023-01, neither finishing. So `currentEdition`
picks the newest *boundary* vintage, which is exactly the edition with the
least *series* behind it — the rule biting from the far side of the one it was
written for. `BA_SA2,2.0.0` ("from July 2021 onwards") has no edition problem
at all, which is one more reason the finest grain is the one worth making
work.

**The download is the whole cube.** Every building type — hotels, shops,
factories, offices, health, education — every measure, and all three series
estimates, of which this register keeps Original estimates of three
residential types on two measures. We were paying to transfer what we then
discard, which is what makes narrowing the source the lever the window is not.

## 4 · Four rules the register holds

**An approval is not a completion.** The ABS counts approvals; a dwelling
approved is not commenced and a dwelling commenced is not finished.
`APPROVALS_ARE_NOT_COMPLETIONS` carries that into any prose quoting a figure,
and it is `infrastructureEvidence`'s rule — an approval is never read as
funding, funding never as a start on site.

**A region download is a HIERARCHY, so the grain is the ROW's.** *"Building
Approvals by SA2 **and above**"* means what it says. The first ceiling was
written for a council area and refused the Bureau's own download over
`Australia 2026-07 reads $22,314,955,000` — an ordinary national figure. Every
fact in that refusal was correct and the conclusion was wrong. The grain now
comes from the publisher's own area code and the ceilings are per grain, an
order of magnitude above the real figures, because they detect a changed
`UNIT_MULT` or a moved column rather than ranking areas. The consequence
reached further than the refusal: stamping every row with the *requested*
grain files the national total as a council area, and the read path would have
served Australia's monthly approvals as one suburb's supply.

**A total summed from part of a register is a FLOOR and says so.**
`DA_REGISTER_RECONCILIATION.md` paid for that rule once. A twelve-month window
states how many of its months carried a figure, an incomplete window's total
is labelled a floor, and a year-on-year change is computed **only between two
complete windows** — comparing a floor with a floor produces a percentage that
describes the gaps rather than the market, and it arrives looking exactly like
a measurement.

**An absence may not be rated.** Not Low, not Limited, not Constrained — and
not Strong either, because a rating drawn from the coverage of a search is a
statement about the search (`PLANNING_CONTROLS_IN_THE_REPORT.md` §9).

## 5 · The four absences are four different sentences

`approvalsRegisterRead.ts` answers with a reading or with a named absence, and
which one it is decides what the document says:

| Absence | What it is a statement about |
| --- | --- |
| `not_loaded` | this deployment — the register has never been loaded at that grain |
| `none_for_area` | the area — the register holds rows at that grain and none for it |
| `unavailable` | ours — the read itself failed |
| `no_area_resolved` | the subject — no trusted geography to ask with |

The call site used to derive this from `planningFacts.council ? 'not_loaded' :
'no_area_resolved'` — a stand-in for a question nothing had asked, which would
have told a reader the register was unloaded on a deployment where it was
loaded and simply held nothing.

Two further rules on that read. **Only a TRUSTED geography may select a
reading** — the fields are named for the authority behind them
(`trustedSuburb`, `cadastreLga`), because a field called `suburb` invites a
typed one and choosing the wrong council describes somebody else's market
under this property's address. And **the finest grain that answers wins and
the grain travels**: SA2, then council, then state, with `national`
deliberately not on the ladder, because Australia's monthly approvals printed
beside one address is the benchmark-read-as-the-suburb defect
`MARKET_FIGURES_IN_THE_REPORT.md` records.

## 6 · Narrowing the query

`composeApprovalsKey` builds the SDMX key from the flow's own data structure.
Four rules:

* **the codes are chosen by NAME, with the rules the parse reads by** —
  `BUILDING_TYPE_PATTERNS`, `UNITS_MEASURE`, `VALUE_MEASURE`,
  `ORIGINAL_SERIES` and `MONTHLY_FREQ` are imported rather than restated, so
  asking for what we keep and keeping what we asked for are one declaration;
* **the area dimension is never narrowed**, enforced rather than intended — a
  register narrowed by area is a register about somewhere else, and it would
  answer 200;
* **a rule that matches no code narrows nothing** — the position is left open,
  the whole dimension comes back and the parse filters it as it always has: a
  download bigger than it needed to be, never one missing rows, with the
  unnarrowed dimensions recorded because a silent widening is a byte count
  nobody reads;
* **a structure that cannot be read costs nothing** — the fallback is `/all`,
  which is what shipped.

The key covers the dimensions **other than time**. A slot for `TIME_PERIOD`
shifts nothing visibly and makes every position after it mean a different
dimension.

### The defect writing it found

`UNITS_MEASURE` was `/number of dwelling units|dwelling units|^number\b/i`,
and the cube publishes `Number of buildings` on the same measure dimension. A
block of forty flats is one building and forty dwellings. Because the row key
is `(area, period, building type)`, a building count did not merely leak in —
it **overwrote** the dwelling count for that month whenever it was read
second. Nothing caught it because the fixture published two measures and the
cube publishes three: it was invisible until the *query* had to enumerate what
the publisher actually offers.

## 7 · The check is the instrument

`abs-register-liveness` runs on every CI build, before anything is merged,
deployed or scheduled. It writes nothing anywhere — no database, no
credential. Its exit code is the whole design:

* **the ABS being unreachable exits 0.** A compliance product cannot have its
  build decided by somebody else's uptime — `PEP_SCREENING_ENGINE.md`'s rule.
  The refusing party's own words are printed, because this cannot tell the
  Bureau's 403 from an intermediary's, and a runner behind an allowlist would
  otherwise make the whole gate a placebo that exits 0 having reached nothing.
* **the ABS answering and this reader refusing exits 1.** That is the reader
  being wrong about the publisher, which no synthetic fixture can catch.
* **a download nobody can carry exits 1.** The first version printed *"THE ABS
  DID NOT ANSWER"* and exited 0 over an HTTP 200 that arrived in 6.4 seconds
  and then sent four minutes of body. A size problem on our side reported as
  an outage on theirs is a green build standing over a thing that does not
  work.

It has found a real defect on every run it has made: discovery refusing the
Bureau's own catalogue, a ceiling refusing a correct national figure, an
edition holding one month, and a measure rule admitting building counts.

## 8 · Open

**Whether the narrowed query makes the finest grain loadable.** That is what
4d measures and it is the number the loader's design turns on. If SA2
narrowed still cannot be carried, the next lever is paging by state — the SA2
code's leading digit is its state, and `market-sales-ingest` is already
staged one publisher per invocation for exactly this reason ("one heavy
workbook per invocation", `OPEN_DATA_GROWTH_EVIDENCE.md` §10). If the LGA
fallback is needed, the current and prior editions have to be unioned, which
the register's primary key already does correctly: the newest edition's rows
overwrite where they overlap.

Nothing is written to `market_building_approvals` on any deployment yet, and
until something is, every report reads **Not searched.** and is forbidden from
stating a figure — which is `CLONE_PROVISIONING_GAPS.md`'s rule applied before
the gap exists.
