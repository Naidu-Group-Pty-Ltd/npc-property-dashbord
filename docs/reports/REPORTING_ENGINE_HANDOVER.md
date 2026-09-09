# Reporting Engine audit — state of play and handover

**As at 2026-09-09.** Written to be picked up cold by a different agent or engineer.
Read this first, then the audit sections it points at. Nothing here restates
what the audit already records; it says **where the work stands, what is
blocked, and what must not be broken**.

---

## 1. The governing doctrine

One rule sits above everything else in this programme:

> **If a figure can be produced deterministically from the system record, the
> model must never be asked to calculate, guess, transcribe or recreate it.**

Three corollaries that have each been paid for at least once:

- **Absent is absent** — never `0`, never `50`, never a placeholder. A derived
  figure whose basis is missing is itself missing.
- **An observation is not a dimension** — a fact about one thing does not
  become a score for another.
- **Configuration is not reachability** — a source that is catalogued,
  credentialled and documented may still never have answered. Measure it.

### Standing constraints (do not relax without the owner's word)

- Do not replace functioning infrastructure to make architecture cleaner.
- Do not perform unrelated refactoring. Do not remove existing functionality.
- Prefer real generated reports as evidence over theoretical code analysis.
- **Grades: A = 75, A+ = 85.** Do not lower thresholds. Do not target a
  predetermined A/A+ percentage.
- No property-type bonus or penalty; no state premium; no buyer financing
  inside property quality; no missing-data neutral defaults.
- **Scoring V2 is not wired into production or live report generation.**
- No fabricated or synthetic market evidence. No LLM-created values. No
  model-written narrative as a financial source fact. Do not ask an LLM to
  determine geography.
- Do not scrape realestate.com.au, SQM, or journey-planner websites.
- Do not rewrite historical issued reports or corrupted historical addresses.
- Do not run an irreversible mass backfill on historical reports.
- Never expose credential values — presence only, never a value, length or
  prefix. `INTERNAL_EDGE_SECRET` is never held or transited.
- WA SLIP planning data is never fetched (licence bars commercial
  republication).
- A probe must never take a URL from the request body — that is SSRF in a
  function holding service-role credentials.
- Never disable TLS verification or unset `HTTPS_PROXY`.
- Do not manually bypass deployment controls.

---

## 2. Where the work is right now

| | |
| --- | --- |
| Branch | `claude/reporting-engine-audit-4850hs` |
| Last code commit | `b0185fc92215fadf4877f6f113804649b1e6b4f1` (this document is committed on top of it, and is the only later commit) |
| Base | `main` @ `5b2cf9aabaea4a47d0f830e14a4af08967c33e41` |
| Open PR | **#2578** — 2 commits ahead of main, no merge conflict |
| PR state | **DRAFT** — this is why it cannot be merged |
| CI | green **except `supply-chain`** (see §3) |

Two commits are on the branch and **not yet in `main`**:

1. `dc08be5e5` — ME-6 zero-cost evidence strategy (audit §64)
2. `b0185fc92` — ME-6 closure: one Growth denominator, frozen ME-7 population (audit §65)

Everything below §64 in the audit document **is** merged and live.

---

## 3. Blockers, in the order that unblocks the most

### 3.1 `supply-chain` CI check — blocks every PR in the repo

Two advisories published against `@tiptap/core@3.26.1`:

- `GHSA-cp6q-959q-f8rh` — `mergeAttributes()` turns an own `__proto__` key into inherited executable DOM attributes
- `GHSA-j95f-988m-3j2f` — quadratic ReDoS in Markdown attribute parsing (affects `>=3.7.0 <3.30.5`)

**This is not PR #2578's.** That PR changes no dependency file, and `main`
carries the identical `3.26.1`. `npm audit` is deterministic over a lockfile,
so `main` fails identically.

Measured remedies that **do not** work:

1. `npm audit fix` — moves 9 packages, leaves `@tiptap/core` at `3.26.1`.
2. Re-resolving `tldraw` inside its declared `^5.3.2` — lands `5.4.0`, which
   asks for `@tiptap/core: ^3.12.1`; npm keeps the satisfying `3.26.1`.
3. `npm update` on the tiptap family — still `3.26.1`.

**Why**: 28 packages peer-depend on **exactly** `3.26.1`, all transitive under
`tldraw`. Core cannot move without an `overrides` block covering the family.

Two options, and **this is an owner's decision, not an agent's**:

**(a)** `overrides` in `package.json` to `^3.30.5` for `@tiptap/core`,
`@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit`. Clears both advisories.
Crosses a peer-dependency pin, so the tldraw canvas and the rich-text surfaces
must be exercised before merge.

**(b)** Triage into `scripts/security/dependency-audit-allowlist.json`, as was
already done for `image-size`, `pptxgenjs` and `vite`.

**(b) was deliberately not taken.** Accepting a high-severity
prototype-pollution and ReDoS advisory is a security decision with an owner,
and this repository has already had one lesson about making a gate go green by
telling it something convenient (§63, the CORS contract). Diagnosis is on the
PR as `issuecomment-5595294197`.

### 3.2 PR #2578 is a draft

Mark it ready for review; the merge button does nothing on a draft.

### 3.3 The two vendor questions — the only route to ME-7

Both are drafted and ready to send. Neither can be answered from inside the
repository, and **neither may be assumed, inferred or substituted**.

- `docs/integrations/DOMAIN_ACTIVATION_REQUEST.md` — the lead question is
  whether `api_properties_read` and `api_suburbperformance_read` can be enabled
  on the **existing** Aurixa application **at no additional charge**.
- `docs/integrations/PROPTRACK_TRIAL_REQUEST.md` — 12 questions on the official
  API trial, each mapped mechanically onto an `EvidenceAcquisition` value.

### 3.4 The operator probe has never been run

`market-source-probe` is deployed and verified (v14, byte-identical to main).
The operator surface is at **`/integrations`** — *not* `/admin/integrations`,
which 404s. One click on **Run source probe**, once.

The four-case reading is **pre-registered** and must not be re-derived after
seeing the result — `domain_address_suggest` against
`domain_v2_suburb_performance`:

| suggest | suburb performance | conclusion |
| --- | --- | --- |
| 2xx | 2xx | key valid, both entitled — conclusive |
| 2xx | 403 | key valid, Suburb Performance not entitled — names the commercial ask |
| 401 | 401 | key not accepted at all — operator-side, **not** entitlement |
| 403 | 403 | **ambiguous, stays ambiguous** — no owner assigned |

Entitlement is never inferred from a 403 alone. A government 403 is never an
entitlement finding.

---

## 4. The canonical facts a successor must not re-derive

### 4.1 The Growth-ready population is 665 of 867

Predicate `me7.pop.1`, in
`supabase/functions/_shared/reports/market/growthPopulation.pure.ts`. **No
second component may define "Growth-addressable".**

The audit previously carried two numbers, 641 and 663. They are the same
predicate with and without one exclusion:

| step | count |
| --- | ---: |
| trusted geography (suburb AND state) | 867 |
| `property_specs.property_type`, non-placeholder | 663 |
| less `land` (26) | 637 |
| plus §62.4's 4 sibling recoveries | 641 |

**663 was too loose** (a land parcel has no dwelling, so no house/unit median
series describes it). **641 was too narrow** (one field; two further
deterministic routes sat unused).

Canonical:

| route | reports |
| --- | ---: |
| `property_specs.property_type` | 663 |
| `financial_calculations.propertySpecs.propertyType` | +15 (all `house`, operator-stated) |
| unambiguous sibling on `canonical_property_key` | +13 |
| any type resolved | 691 |
| less `land` | −26 |
| **canonical** | **665** |

**Requires**: trusted geography, and a dwelling type mapping to a class a
provider publishes (`house` or `attached`).
**Does not require**: LVR, cash flow, rent, Risk, composite readiness, or
postcode. Sibling recovery is a **route**, never a requirement.

Distribution:

| state | ready | houses | attached |
| --- | ---: | ---: | ---: |
| QLD | 338 | 278 | 60 |
| WA | 137 | 89 | 48 |
| VIC | 131 | 120 | 11 |
| NSW | 40 | 31 | 9 |
| SA/TAS/ACT/NT | 19 | 18 | 1 |
| **total** | **665** | **536** | **129** |

228 distinct suburbs. QLD + WA = 475 (71%).

### 4.2 The population is frozen in the database

`me7_backtest_populations` / `me7_backtest_population_members`, sealed under
`me7.pop.1`, 867 members / 665 included. Immutability mirrors
`market_evidence_snapshots` — draft → sealed once, no unseal, UPDATE and DELETE
refused on a sealed row and its members. Both refusals proven by execution.

**The rule it enforces**: provider coverage is measured **against** the
population and never defines it. Otherwise a provider outage shrinks the
denominator and the coverage percentage *improves* under exactly the fault it
should reveal.

### 4.3 The zero-cost finding: the open data is not where the properties are

Measured 2026-09-08 from **two** networks — this repository's development
container and the **production Supabase egress via `pg_net`**.

- **QLD (50.8%)** — QGSO's housing theme is building approvals. No open
  suburb-level median sale price series.
- **WA (20.6%)** — Landgate's only candidate is `Custom (Other)` licensed.
- **VIC (19.7%)** — publishes exactly the right dataset (median house and unit
  by suburb, quarterly, dwelling-segmented, CC BY 3.0 AU) and
  `land.vic.gov.au` answers a Cloudflare interstitial (403) to **both**
  egresses. Licence permits what transport denies.
- **ABS** — all 1,227 dataflows enumerated. `RES_DWELL_ST` is state grain,
  `RPPI` capital-city. **None** carries suburb-level price.

Recorded as data in `zeroCostSources.pure.ts`, where `licence` and
`reachability` are **separate fields that are never inferred from one
another** — a licensing gap needs a commercial conversation, a transport gap
needs the publisher contacted, and reporting one as the other sends somebody to
the wrong door.

**SQM**: `manual/context only — automated commercial ingestion not authorised`.
Its terms prohibit automated retrieval; that is considered policy rather than a
generic bot rule, and it is the one source that was deliberately not retried.

### 4.4 Evidence acquisition footing

`EvidencePoint.acquisition`, orthogonal to `licensingStatus`. Licensing asks
*may this be printed for a client*; acquisition asks *on what footing do we
hold it at all*, and that decides production eligibility.

`open_public` · `existing_licensed` · `trial_shadow_only` ·
`commercial_upgrade_required` · `licensing_unverified` (**default**)

Three rules, all tested: the default is conservative; a trial may be
shadow-scored and never rendered; `acquisitionLicensingConflict` refuses
contradictory combinations. **Provider name and point shape never override the
footing** — an ABS point with no declared footing is still not production
evidence.

---

## 5. ME-7 entry gate — the go/no-go

`me7EntryGate.pure.ts`. ME-7 may begin only when **all** hold:

- the population manifest is sealed;
- **QLD and WA both have subject Growth evidence** (they are 475 of 665, so a
  VIC/NSW-only sample validates the methodology against 26% of the portfolio
  while reporting a number about the other 74%);
- at least one dwelling class is represented;
- an acquisition footing is recorded and is not universally
  `commercial_upgrade_required`;
- the evidence snapshot is sealed and reproducible.

Explicitly **not** required: 100% corpus coverage, a complete Demand dataset,
Victoria specifically, or postcode-level evidence.

Evidence precedence (also in that module):

- **Subject Growth**: Domain-at-$0 → PropTrack trial → open state suburb series → **unavailable**
- **Demand**: provider/open → government context → **unavailable**
- **ABS regional/state data is never subject Growth** — `mayServeSubjectGrowth`
  refuses it by name. It is a benchmark.

### Current answer: **No — do not start ME-7.**

Measured: **0 evidence snapshots, 0 evidence records.** Growth coverage
**0 / 665**. Demand coverage **0 / 665**.

> **ME-7 cannot be run representatively under the zero-spend constraint with
> the currently accessible evidence.**

It becomes runnable the moment **either** Domain activates the two scopes at no
charge **or** PropTrack grants a trial permitting internal evaluation. Do not
create a substitute.

---

## 6. Where the detail lives

The full audit is `docs/reports/REPORTING_ENGINE_AUDIT_2026_09.md` (7,389
lines). The ME-programme sections:

| § | subject |
| --- | --- |
| §54 | Provider discovery closes — PropTrack, SQM, final hierarchy |
| §55 | ME-4 — scoring integration hardening, backtest readiness |
| §56–58 | ME-5 — canonical geography, Location evidence, centre selection |
| §59–60 | ME-5.1 — correcting Risk, the provider activation pack |
| §61 | ME-6 — real market evidence activation |
| §62 | ME-6 — first authoritative runtime result, and the classification defect it exposed |
| §63 | ME-6 — one trustworthy Domain diagnostic |
| **§64** | **ME-6 — zero-cost evidence strategy** (on the branch, not yet merged) |
| **§65** | **ME-6 closure — one denominator, frozen population** (on the branch) |

Integration requests: `docs/integrations/DOMAIN_ACTIVATION_REQUEST.md`,
`docs/integrations/PROPTRACK_TRIAL_REQUEST.md`.

Key modules under `supabase/functions/_shared/reports/market/`:
`growthPopulation` · `me7EntryGate` · `zeroCostSources` · `marketEvidence` ·
`evidenceSnapshot` · `evidenceQuality` · `evidenceSampleFrame` ·
`sourceProbeReading` · `growth/growthPeriods` · `shadowScorer` ·
`backtestInput` · `backtestHarness`.

**Bridge contract**: every `supabase/functions/_shared/**/*.pure.ts` needs a
one-line `src/lib/**/*.pure.ts` re-export. CI enforces it.

---

## 7. How to verify before pushing

CI has **two separate job step lists** — `verify` and `security` — **47 steps
total** in `.github/workflows/ci.yml`. Run both.

Two tests fail **in a constrained container** and are not defects:

- `src/lib/security/migrationSyntax.test.ts` — 5s timeout over 1,030 migrations
- `src/lib/aml/diditProviderConfigTruth.spec.ts` — 5s timeout over 4,495 tests

Both pass at `--testTimeout=60000`, and both **pass on GitHub CI**. Do not
"fix" them by skipping, quarantining or raising the repo-wide timeout.

Generated artefacts to regenerate when touching their inputs:

- `supabase/migration-object-index.json` → `npm run migrations:index`
- `docs/security/SECURITY_INVENTORY.json` → `npm run security:inventory`

Edge checks need Deno on PATH: `export PATH="$PATH:/root/.deno/bin"`.

---

## 8. Environment facts that cost time to rediscover

- **Frontend deploys via Lovable**, project `7976d60b-c277-4851-889b-c170285f4be2`.
  There is no frontend deploy workflow in the repo.
- **Edge functions deploy via** `.github/workflows/deploy-supabase-functions.yml`
  on merge to `main`. A `_shared/` change redeploys everything; only functions
  whose bundle actually changed take a new version.
- **The live site is behind a Cloudflare challenge** and the agent proxy resets
  browser tunnels, so the deployed bundle cannot be fetched from a sandbox.
  Browser rendering via Playwright is blocked for the same reason —
  `curl` works, Chromium tunnels do not.
- `pg_net` is installed and is the way to measure the **production** egress.
- Supabase project `dduzbchuswwbefdunfct`.

---

## 9. Immediate next actions

1. **Decide the tiptap remedy** (§3.1) — unblocks every PR in the repo.
2. **Mark PR #2578 ready** and merge (§3.2).
3. **Send the Domain and PropTrack requests** (§3.3).
4. **Run the probe once** at `/integrations` and capture the result (§3.4).
5. When either vendor answers at $0: record the footing, build **only** that
   one adapter, normalise into `MarketEvidence`, seal the first genuine
   evidence snapshot, and re-evaluate the ME-7 gate.

Do not begin ME-7 before the gate opens. Do not change scoring weights, grade
thresholds or evidence methodology to make it open sooner — **evidence scarcity
is a coverage problem, not permission to alter scoring.**
