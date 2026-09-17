# Suite rebuild — the protected baseline

Stage 0 of the authorised non-production programme. This file records what the
system was **before** any change, so a regression can be told from a
pre-existing defect and so the protected financial workflow can be proved
unchanged rather than asserted.

Captured **17 September 2026**. Nothing in this file is a change; it is a
measurement.

---

## 1. Code baseline

| | |
| --- | --- |
| Working branch | `claude/adoring-hopper-g02tdt` |
| Baseline commit | `b95287c09e46ef89fe64741d4bbab65da5b6c00b` |
| Branch state | Level with `origin/main` (`1d71a807`); working tree clean |

## 2. Deployed edge functions (production project `dduzbchuswwbefdunfct`)

| Function | Version | Deployed |
| --- | --- | --- |
| `generate-investment-report` | v362 | 2026-09-17 08:43 UTC |
| `planning-data-service` | v266 | 2026-09-17 08:48 UTC |
| `investment-scoring-service` | v326 | 2026-09-16 23:08 UTC |
| `location-intelligence-service` | v353 | 2026-09-16 05:37 UTC |
| `render-template-pdf` | v356 | 2026-09-16 05:41 UTC |
| `public-transport-service` | v346 | 2026-09-12 08:46 UTC |

423 functions deployed in total.

## 3. Frontend build identity

**A build marker already exists and needs no change.** `vite.config.ts`
resolves a `BUILD_ID` (commit sha, 12 chars) and the
`npc-build-version-manifest` plugin emits `/version.json` beside the bundle;
`src/lib/buildVersion.ts` reads it at `VERSION_MANIFEST_PATH`.

**Open, with a one-step resolution.** This environment's network policy denies
the NPC hosts, so `/version.json` cannot be fetched from here. The deployed
build is identified by opening `https://<production host>/version.json`, which
returns `{"buildId":"<12-char commit sha>"}`.

**Bounded meanwhile:** the bundle predates commit `4717c10` (17 Sep 2026),
proved by the pre-separation standfirst on the 17 Sep Annabelle cover. It is
**at least** eight `src/` commits behind; whether more is unknown until
`/version.json` is read.

## 4. Template baseline

500 seeded masters across ten design families and ten colourways; 50 masters
per migrated report format. Active-master refresh verified in prior work.

**Open:** which master version the deployed picker serves, for the same reason
as §3.

## 5. Baseline report set

Only Compass rows exist for the two test properties. The other four reports
must therefore be built as **isolated fixtures** from these stored rows, never
as new production records.

| Report | Address | Tier | Engine | Created | Chars | Grade | CGR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `9bd41c05…` | 18 Annabelle Crescent, Kellyville NSW 2155 | compass | compass-40 | 17 Sep 08:57 | 66,625 | F | 6.2 |
| `aa41bcec…` | 262 Pallas Street, Maryborough QLD 4650 | compass | compass-40 | 16 Sep 23:36 | 39,832 | C | 9.7 |
| `4640d10a…` | 262 Pallas Street | compass | compass-40 | 17 Sep 03:36 | 44,580 | C | 9.7 |
| `3a4a3d9b…` | 262 Pallas Street | compass | compass-40 | 17 Sep 04:51 | 38,648 | C | 9.7 |

`3a4a3d9b…` is the current Pallas reference.

---

## 6. Growth-input and Cash Flow preservation verification

Read-only. This replaces the withdrawn "capital-growth assumption repair".

### 6.1 The supported journey, traced

```
pre-generation input  →  manual_overrides.capitalGrowth
                      →  mergedOverrides.capitalGrowth → capitalGrowthRate
                      →  financial_calculations.assumptions.capitalGrowth
                      →  projections.{conservative,moderate,optimistic}[]
                      →  binding projection → rendered document
```

### 6.2 Preservation, measured over every report since 1 June 2026

| Cohort | n | Accepted value preserved exactly |
| --- | --- | --- |
| Override supplied | **63** | **63 of 63** |
| No override, value stored | 11 | n/a — all are forks inheriting a parent value, in matched pairs |
| No override, no assumptions object | 5 | n/a |

Comparison is on the stored text, so it is strict: a rounding or precision
change would fail it. **No drift was found.**

Zero values: none supplied in the corpus, so the zero-input branch is
**untested by data** and is covered by a fixture case in the harness instead.

### 6.3 Downstream arithmetic, reproduced on `9bd41c05…`

Accepted input `capitalGrowth: 6.2`, purchase price `$1,490,000`,
weekly rent `$850`, loan `$1,192,000` at `6.5%` interest-only.

| Published figure | Reproduction | Result |
| --- | --- | --- |
| Year 1 property value `1,582,380` | `1,490,000 × 1.062` | exact |
| Year 10 property value `2,719,139` | `1,490,000 × 1.062^10` | exact |
| Year 1 annual rent `45,526` | `850 × 52 × 1.03` | exact |
| Year 10 annual rent `59,401` | `850 × 52 × 1.03^10` | exact |
| Year 1 interest `77,480` | `1,192,000 × 0.065`, principal `0` | exact, matches interest-only |
| Year 10 principal `25,507` | non-zero after the 5-year interest-only period | consistent |

Scenario growth is derived symmetrically from the accepted value:
conservative `4.2`, moderate `6.2`, optimistic `8.2`.

### 6.4 The model-research fallback

`generate-investment-report/index.ts:5323` injects a capital-growth research
instruction, and `:5952` extracts a value from the generated content — **both
guarded by `!manualOverrides.capitalGrowth`**.

Measured: **1** fresh generation since 1 June 2026 carried no growth override.
Every other stored value traces to an operator override (63) or to a parent
report (11 forks, paired). **No stored growth assumption in the corpus is
demonstrably the fallback's output.**

The fallback is **retained unchanged**. It is out of scope for this programme.

### 6.5 Finding

**The supported journey operates as intended.** The accepted input is
preserved exactly into the stored assumption, and the projections reproduce
from it by arithmetic. No mismatch is demonstrated, so this verification item
is **closed** and the growth and Cash Flow workflow is protected as-is.

Recorded for completeness, not as a defect: a *fresh* generation cannot prove
the origin of an *old* value. §6.2 and §6.3 are a replay against historical
evidence, which is why preservation is asserted on the stored corpus rather
than on a new run.

---

## 7. The preservation gate

Before and after every change, for each baseline report:

1. `financial_calculations.assumptions.capitalGrowth` is byte-identical.
2. All three projection series are element-wise identical on
   `propertyValue`, `annualRent`, `interest`, `principal`, `loanBalance`,
   `cashFlow`, `cumulativeCashFlow`, `equity` and `roi`.
3. `keyMetrics`, `loanDetails`, `annualCosts`, `initialCosts`,
   `sensitivityAnalysis` and `taxBenefits` are identical.
4. Layout may change. **Any change to the above fails the gate.**

Checked on the financial fields, not on `report_content` or
`investment_score` alone.

## 8. Pre-existing defects, recorded so they are not read as regressions

Observed on the baseline documents before any change:

- Contents indexes page archetypes, not sections.
- `{{stat block}}` printed raw; bracketed pinned-context markers in prose.
- Planning control table printed twice.
- Near-empty risk page.
- Five figures carrying no information; two charts not drawn to scale.
- Truncation notice citing a Markdown export the recipient lacks.
- `commute`, `walkScore` and `schools.schoolsWithin3km` absent from
  `location_intelligence`; Location scores nothing.
- Acquisition stamp reads `commute: "measured"` on a row carrying no commute.
- Cover, dashboard and method page carry financial modelling from a
  pre-separation frontend bundle.
