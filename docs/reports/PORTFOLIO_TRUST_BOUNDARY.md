# The Portfolio trust boundary — what the model may author, and what it may not

*Traced against `main` at `befd44423` on 2026-09-07, before any change.*

The governing rule: **if a figure can be produced deterministically from the
system record, the model is never asked to calculate, guess, transcribe or
recreate it.**

---

## 1. The flow, and where the boundary sits today

```
client_properties ─┐
clients            ├─→ generate-portfolio-analysis/index.ts
borrowing_capacity ┘        │
                            ├─ portfolioMetrics      ← DETERMINISTIC (computed in the function)
                            ├─ propertyAnalyses      ← DETERMINISTIC (computed in the function)
                            └─ analysis              ← MODEL, and today that includes arithmetic
                                    │
                                    ├─→ portfolio_analysis_reports.report_data (jsonb)
                                    │
                                    ├─→ PortfolioAnalysisPDFGenerator.tsx   (pdf-lib, browser)
                                    └─→ _shared/reports/portfolio/normalise.pure.ts
                                            └─→ payload → render → WeasyPrint
```

The deterministic half is already separated and already correct. The defect is
entirely in the third branch: the model's JSON schema asks for numbers.

## 2. Consumers of every field in question

Searched across `src`, `supabase`, `scripts`, `docs`.

| field | consumers | notes |
| --- | --- | --- |
| `analysis.interestRateSensitivity` **(object)** | `PortfolioAnalysisPDFGenerator.tsx` only | KPI boxes at ~2545-2585 and the on-screen block at ~3609 |
| `…investmentProperties.currentMonthlyCashflow` | same, 1 file | |
| `…ownerOccupiedProperties.currentMonthlyRepayment` | same, 1 file | |
| `…plusOnePercentImpact` / `plusTwoPercentImpact` | same, 1 file | |
| `analysis.riskAssessment.interestRateSensitivity` **(string)** | `normalise.pure.ts:663`, PDF `2511` | **A DIFFERENT FIELD.** Prose, not a number. Must not be conflated. |
| `projections.projectedPortfolioValue` | `normalise.pure.ts:412`, PDF, 4 test/fixture files | |
| `projections.projectedEquity` | `normalise.pure.ts:417`, `render.pure.ts`, `payload.pure.ts`, PDF, tests | |
| `projections.projectedMonthlyCashflow` | `normalise.pure.ts:418`, `render.pure.ts`, `payload.pure.ts`, PDF, tests | |
| `executiveSummary.healthScore` | `normalise/render/payload`, `portfolioProjection.pure.ts`, PDF, template catalogue | also an unrelated marketing `healthScore` in 6 files — different feature |
| `compositionAnalysis.diversificationScore` | PDF only | |
| `borrowingCapacityUtilisation.*` | `normalise.pure.ts`, PDF, tests | the function already fetches the deterministic assessment |

**Two shapes must not change**, because live consumers read them: the
`analysis.interestRateSensitivity` object as the PDF generator types it, and
the `projections` object as `toProjection` reads it. The fix therefore changes
*who produces* the numbers, not the persisted shape.

## 3. What the record genuinely carries per loan

`client_properties`, measured over all 52 rows / 47 loans:

| field | populated | verdict |
| --- | --- | --- |
| `loan_remaining` | 47/47 | authoritative |
| `interest_rate` | 47/47 | authoritative |
| `repayment_type` | 46/47 (`interest_only`, `principal_and_interest`) | authoritative |
| `monthly_interest_repayment` | 43/47 | see below |
| `loan_repayment_frequency` | only value present is `monthly` | no frequency variety exists to normalise |
| `interest_only_period_years` | 6/47 | too sparse to drive anything |
| `loan_repayment_amount` | **0/47** | the column exists and has never been populated |
| **loan term (original or remaining)** | **no such column exists** | — |

Two facts settle the mathematics.

**`monthly_interest_repayment` equals `balance × rate ÷ 12` for 20 of 20
interest-only loans, and for 0 of 21 principal-and-interest loans.** So on an
IO loan it is the interest *and* the whole repayment, exactly; on a P&I loan it
is something else and is not derivable.

**There is no loan term anywhere in the schema.** Not original, not remaining,
not on the property, not on any related table.

## 4. The discrepancy — and it is load-bearing

The brief lists "remaining/original term" among the fields to find. **It does
not exist**, for any loan, anywhere in this data model. That is not a gap in
population; there is no column.

The consequence is exact and splits the portfolio cleanly:

- **An interest-only loan is fully determinate.** Its monthly repayment is
  `balance × rate ÷ 12`, verified exactly against 20 of 20 such loans, and a
  +Δ shock changes it by `balance × Δ ÷ 12`. **No term is required and nothing
  is assumed.**
- **A principal-and-interest loan is indeterminate.** The payment is the
  amortisation formula, which needs a term. Without one, neither the current
  payment nor the shocked payment can be computed. The brief forbids assuming
  a term, and rightly — a 30-year guess on a loan with 8 years left overstates
  the balance of the payment and understates the shock.

Per §4's own rule ("do not calculate a partial portfolio sensitivity and
present it as though it covers every loan"), a portfolio containing any P&I
loan therefore has **no defensible sensitivity figure at all** until a term is
captured.

Measured across the 23 clients who hold loans:

| | clients | |
| --- | --- | --- |
| interest-only only → **exact sensitivity** | **15** | 65.2% |
| contains a P&I loan → **unavailable** | **7** | 30.4% |
| contains a loan with no recorded structure → **unavailable** | 1 | 4.3% |

$12,488,000 of principal-and-interest debt cannot be modelled without a term.

**This is the correct outcome, not a regression.** Today the figure is produced
for everyone and is wrong for most: of the 14 stored reports carrying it, only
4 had a +1%/+2% pair inside a generous 1.9×–2.2× band, the observed ratio ran
from 0.000 to 5.842, and against the loans themselves the model's +1% figure
was out by $2,137 a month on average and $9,090 at worst — over $109,000 a
year. Replacing a confidently wrong figure for 23 clients with an exact figure
for 15 and an honest absence for 8 is a strict improvement.

**The real remedy is a data one**: capture a loan term on `client_properties`.
That is named here as the thing which would restore the feature for the other
third, and is deliberately out of scope for this change.

## 5. The boundary this change establishes

**Model authority — judgement, interpretation, prose:**
`healthScore`, `diversificationScore`, health/risk/cashflow/equity/
serviceability classifications, strengths, concerns, strategic roles,
recommendations, market and portfolio commentary, projection narrative.

**System authority — never asked of the model:**
portfolio value, debt, equity, monthly cashflow, monthly repayments, rental
income, expenses, LVR, yield, every rate-sensitivity figure, projected value,
projected equity, and the deterministic borrowing-capacity figures already
present in the assessment record.

**Assembly order:** deterministic facts are computed first and supplied to the
model as authoritative context; the model returns judgement and prose only; the
persisted object is assembled from both. Deterministic fields overwrite nothing,
because the model was never permitted to author them.

## 6. One rendering change is required

`PortfolioAnalysisPDFGenerator.tsx`'s `formatCurrency(null)` returns **`'$0'`**
(line ~266) and `safeNumber(null)` returns **`0`**. An unavailable sensitivity
would therefore print `$0/mo` — the precise failure this work exists to end.
The renderer must distinguish absent from zero. `normalise.pure.ts` already
does this correctly (`toProjection` returns null rather than a zeroed block),
and that is the philosophy being extended rather than replaced.
