"""Builders for the finance templates."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import components as C  # noqa: E402
from content import Fill  # noqa: E402
from oxml import page_break  # noqa: E402
from theme import Theme  # noqa: E402


# ==========================================================================
# Borrowing Capacity Report — Financial Analytical
# ==========================================================================

def borrowing_capacity_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Assessed borrowing position",
        title=f("report.title", "Borrowing Capacity Report"),
        subtitle=f("report.subtitle",
                   "What you can borrow, from whom, on what assumptions, and what would "
                   "change it."),
        chips=["ASSESSED", "MULTI-LENDER", "STRESS-TESTED"])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Assessed capacity", "Headline position")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("MAXIMUM CAPACITY", f("assessment.maxCapacity", "$1,284,000"), "Highest on panel"),
        ("INDICATIVE PRICE", f("assessment.indicativePrice", "$1,590,000"), "At 80% LVR"),
        ("DEPOSIT REQUIRED", f("assessment.deposit", "$318,000"), "Plus costs"),
        ("ASSESSMENT RATE", f("assessment.rate", "9.15%"), "Incl. 3% buffer"),
    ])
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme, title="What this means",
        headline=f("report.headline",
                   "Your capacity varies by $214,000 across the panel — lender selection "
                   "matters more than rate at your income profile."),
        paragraphs=f.text("report.summary", [
            "Assessed capacity ranges from $1,070,000 to $1,284,000 depending on how each "
            "lender treats your rental income and your existing credit card limits. The "
            "spread is driven almost entirely by rental shading policy: lenders applying "
            "80% shading assess $34,000 less annual income than those applying 90%.",
            "Reducing your credit card limits from $28,000 to $10,000 would add "
            "approximately $96,000 to capacity at every lender on the panel, because "
            "limits are assessed at 3.8% of the limit regardless of the balance drawn.",
        ]))
    page_break(doc)

    C.section_opener(doc, theme, "02", "Inputs", "What the assessment is built on")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Applicant", "Income type", "Gross annual", "Shading", "Assessed"],
        f.rows("applicants", [
            ["Applicant 1", "PAYG base salary", "$142,000", "100%", "$142,000"],
            ["Applicant 1", "Bonus (2-year average)", "$18,000", "80%", "$14,400"],
            ["Applicant 2", "PAYG base salary", "$98,000", "100%", "$98,000"],
            ["Joint", "Rental — 4 Example St", "$31,200", "80%", "$24,960"],
            ["Joint", "Rental — 12 Sample Ave", "$28,600", "80%", "$22,880"],
        ], ["{{applicant}}", "{{incomeType}}", "{{gross}}", "{{shading}}", "{{assessed}}"],
            count=5),
        widths=[34, 52, 32, 22, 32], numeric_cols={2, 4},
        total_row=["Total assessed income", "", "$317,800", "", "$302,240"],
        caption="Income")
    C.gap(doc, theme, 0.7)
    C.data_table(
        doc, theme, ["Commitment", "Lender", "Limit / balance", "Actual", "Assessed"],
        f.rows("commitments", [
            ["Home loan — 4 Example St", "Lender A", "$412,000", "$2,310/mo", "$3,140/mo"],
            ["Home loan — 12 Sample Ave", "Lender B", "$389,000", "$2,180/mo", "$2,965/mo"],
            ["Credit card", "Lender A", "$18,000", "$0/mo", "$684/mo"],
            ["Credit card", "Lender C", "$10,000", "$0/mo", "$380/mo"],
            ["Car loan", "Lender D", "$24,400", "$610/mo", "$610/mo"],
        ], ["{{type}}", "{{lender}}", "{{limit}}", "{{actual}}", "{{assessed}}"], count=5),
        widths=[54, 30, 34, 28, 30], numeric_cols={2, 3, 4},
        total_row=["Total assessed commitments", "", "", "", "$7,779/mo"],
        caption="Commitments",
        note="Credit card limits are assessed at 3.8% of the limit each month whether or "
             "not the card is drawn.")
    C.gap(doc, theme, 0.7)
    C.info_card(doc, theme, title="Assessment assumptions", columns=2, fields=[
        ("Assessment rate", f("assessment.rate", "9.15% (product rate + 3.00% buffer)")),
        ("Living expenses basis", f("assessment.hem", "Higher of declared and HEM")),
        ("Declared expenses", f("assessment.declared", "$5,840/month")),
        ("HEM benchmark", f("assessment.hemValue", "$6,120/month — applied")),
        ("Rental shading", f("assessment.rentalShading", "80% unless stated")),
        ("Bonus shading", f("assessment.bonusShading", "80%, two-year average")),
        ("Assessment date", f("assessment.date", "31/07/2026")),
        ("Dependants", f("assessment.dependants", "2")),
    ], footnote="Assessment rates and policies change frequently. This assessment is "
                "indicative only and is not an approval or an offer of credit.")
    page_break(doc)

    C.section_opener(doc, theme, "03", "Lender comparison", "Where capacity differs")
    C.gap(doc, theme)
    C.bar_chart(doc, theme, caption="Assessed capacity by lender",
                rows=f.tuples("lenders.chart", [
                    ("Lender A", 1284000, "$1,284,000"),
                    ("Lender B", 1218000, "$1,218,000"),
                    ("Lender C", 1155000, "$1,155,000"),
                    ("Lender D", 1092000, "$1,092,000"),
                    ("Lender E", 1070000, "$1,070,000"),
                ], ("{{lender.name}}", 1, "{{lender.capacity}}"), count=4),
                note="Capacity is the maximum loan each lender's calculator returns on the "
                     "inputs above. It is not an approval.")
    C.gap(doc, theme, 0.7)
    C.data_table(
        doc, theme, ["Lender", "Capacity", "Assessment rate", "Rental shading", "Policy note"],
        f.rows("lenders", [
            ["Lender A", "$1,284,000", "8.95%", "90%", "Accepts bonus at 80% over 2 years"],
            ["Lender B", "$1,218,000", "9.10%", "85%", "Adds 15% to declared expenses"],
            ["Lender C", "$1,155,000", "9.15%", "80%", "Assesses cards at 3.8% of limit"],
            ["Lender D", "$1,092,000", "9.40%", "80%", "Shades bonus to 50%"],
            ["Lender E", "$1,070,000", "9.55%", "75%", "Does not accept bonus income"],
        ], ["{{name}}", "{{capacity}}", "{{rate}}", "{{shading}}", "{{note}}"], count=5),
        widths=[28, 32, 32, 28, 60], numeric_cols={1},
        emphasis_rows={0}, caption="Lender detail")
    page_break(doc)

    C.section_opener(doc, theme, "04", "Sensitivity", "What changes the answer")
    C.gap(doc, theme)
    C.comparison_table(
        doc, theme,
        subject_labels=["Base case", "Rate +1%", "Rate +2%", "Income −10%"],
        attributes=[
            ("Assessed capacity", [f("sensitivity.base", "$1,284,000"),
                                   f("sensitivity.rate1", "$1,168,000"),
                                   f("sensitivity.rate2", "$1,064,000"),
                                   f("sensitivity.income", "$1,142,000")]),
            ("Indicative price", ["$1,590,000", "$1,455,000", "$1,330,000", "$1,418,000"]),
            ("Change", ["—", "−$116,000", "−$220,000", "−$142,000"]),
            ("Deposit required", ["$318,000", "$291,000", "$266,000", "$284,000"]),
        ],
        caption="Capacity under stress", winner_index=0)
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("assessment.levers", [
        "Reduce credit card limits from $28,000 to $10,000 — adds approximately $96,000.",
        "Clear the car loan balance of $24,400 — adds approximately $71,000.",
        "Provide a third year of bonus history — adds approximately $34,000 at Lender A.",
        "Increase the rental appraisal evidence on 12 Sample Avenue — adds approximately "
        "$18,000 where shading is 90%.",
    ]), title="What would improve capacity", columns=1)
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="warning", title="Important",
        text=f("report.caveat",
               "This report is an indicative assessment of borrowing capacity. It is not "
               "credit assistance, an application, a pre-approval or an offer of credit. "
               "Lender policies, assessment rates and benchmarks change without notice and "
               "each lender will form its own view on a full application."))
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Finance Strategy Report — Modern Technology
# ==========================================================================

def finance_strategy_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Debt structure & funding plan",
        title=f("report.title", "Finance Strategy Report"),
        subtitle=f("report.subtitle",
                   "How your lending should be structured to support the next three "
                   "acquisitions, and the order the moves need to happen in."),
        chips=["STRATEGY", "SEQUENCED", "STRESS-TESTED"])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Executive summary", "The strategy in brief")
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme,
        headline=f("report.headline",
                   "Split the cross-collateralised facilities first, then release equity — "
                   "doing it the other way round costs you a full valuation cycle."),
        paragraphs=f.text("report.summary", [
            "Your four properties are currently secured under two cross-collateralised "
            "facilities with a single lender. That structure has produced a blended rate "
            "0.34% above market and, more importantly, means any equity release requires "
            "revaluation of all four assets together.",
            "The recommended structure separates each property into a standalone facility "
            "across two lenders, with a dedicated equity release facility against the two "
            "assets that have grown most. This releases $340,000 of usable equity and "
            "reduces the blended rate to 6.18%.",
            "Sequencing matters. Releasing equity before splitting the facilities would "
            "lock the current lender's valuations in for a further six months.",
        ]),
        takeaways=f.items("report.takeaways", [
            "Unwind cross-collateralisation before any equity release.",
            "Blended rate falls from 6.52% to 6.18% — $9,180 per year.",
            "$340,000 of usable equity is released, funding two acquisitions.",
            "The full sequence takes approximately 14 weeks.",
        ]))
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("TOTAL DEBT", f("position.totalDebt", "$1,847,000"), "Across 4 assets"),
        ("BLENDED RATE", f("position.blendedRate", "6.52%"), "Current"),
        ("USABLE EQUITY", f("position.usableEquity", "$340,000"), "At 80% LVR"),
        ("CURRENT LVR", f("position.lvr", "63.4%"), "Portfolio"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "02", "Position today", "Current structure")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Facility", "Security", "Limit", "Balance", "Rate", "Type", "Expiry"],
        f.rows("facilities", [
            ["Facility 1", "4 Example St + 12 Sample Ave", "$801,000", "$789,400", "6.44%",
             "P&I variable", "—"],
            ["Facility 2", "21 Test Rd + 9 Demo Cl", "$1,062,000", "$1,057,600", "6.58%",
             "IO fixed", "03/2027"],
        ], ["{{name}}", "{{security}}", "{{limit}}", "{{balance}}", "{{rate}}", "{{type}}",
            "{{expiry}}"], count=3),
        widths=[26, 52, 26, 26, 20, 28, 22], numeric_cols={2, 3, 4},
        caption="Current facilities",
        note="Both facilities are cross-collateralised. No property can be released, sold "
             "or revalued independently under this structure.")
    C.gap(doc, theme, 0.7)
    C.info_card(doc, theme, title="Goals & constraints", columns=1, fields=[
        ("Objective", f("goals.objective",
                        "Acquire two further investment properties over 24 months")),
        ("Constraint", f("goals.constraint",
                         "Total portfolio LVR must remain below 70%")),
        ("Constraint", f("goals.constraint2",
                         "No additional cash contribution available")),
        ("Preference", f("goals.preference",
                         "Reduce exposure to a single lender")),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "03", "Target structure", "Where we are going")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Facility", "Security", "Limit", "Purpose", "Lender", "Type"],
        f.rows("strategy.target", [
            ["A1", "4 Example St", "$412,000", "Standalone investment", "Lender A", "IO variable"],
            ["A2", "12 Sample Ave", "$389,000", "Standalone investment", "Lender A", "IO variable"],
            ["B1", "21 Test Rd", "$524,000", "Standalone investment", "Lender B", "P&I variable"],
            ["B2", "9 Demo Close", "$522,000", "Standalone investment", "Lender B", "P&I variable"],
            ["B3", "21 Test Rd (2nd)", "$340,000", "Equity release — deposits", "Lender B",
             "IO variable"],
        ], ["{{name}}", "{{security}}", "{{limit}}", "{{purpose}}", "{{lender}}", "{{type}}"],
            count=4),
        widths=[22, 40, 26, 48, 26, 28], numeric_cols={2},
        emphasis_rows={4}, caption="Proposed facilities")
    C.gap(doc, theme, 0.7)
    C.comparison_table(
        doc, theme, subject_labels=["Today", "Target", "Change"],
        attributes=[
            ("Facilities", ["2", "5", "+3"]),
            ("Lenders", ["1", "2", "+1"]),
            ("Cross-collateralised", ["Yes — all four", "No", "Removed"]),
            ("Blended rate", ["6.52%", "6.18%", "−0.34%"]),
            ("Annual interest", ["$120,424", "$115,146", "−$5,278"]),
            ("Usable equity accessible", ["$0", "$340,000", "+$340,000"]),
            ("Portfolio LVR", ["63.4%", "69.1%", "+5.7%"]),
        ],
        caption="Current versus target", winner_index=1)
    page_break(doc)

    C.section_opener(doc, theme, "04", "Sequencing", "The order matters")
    C.gap(doc, theme)
    C.process_flow(doc, theme, f.tuples("strategy.sequence", [
        ("Valuations", "Order upfront valuations on all four assets with Lender B."),
        ("Split", "Refinance 21 Test Rd and 9 Demo Close to Lender B as standalone facilities."),
        ("Unwind", "Release the remaining two securities from Facility 2 with Lender A."),
        ("Restructure", "Convert the Lender A exposure into two standalone facilities."),
        ("Release", "Establish the $340,000 equity release facility against 21 Test Rd."),
        ("Deploy", "Funds available for the next two acquisitions."),
    ], ("{{step.name}}", "{{step.detail}}"), count=5))
    C.gap(doc, theme)
    C.chart_frame(doc, theme, title="Funding runway", kind="stacked column chart",
                  binding="{{strategy.runway}}", height_mm=54,
                  caption="Capacity released against planned acquisitions, 24 months",
                  source="Aurixa funding model",
                  alt_text="Released equity covers both planned deposits with $42,000 headroom")
    C.gap(doc, theme)
    C.risk_box(doc, theme, risks=f.tuples("risks", [
        ("Valuations come in below the assumed figures",
         "High", "The equity release reduces proportionally. Order upfront valuations "
                 "before committing to the refinance."),
        ("Lender B policy changes during the 14-week sequence",
         "Medium", "Obtain formal approval on all four facilities before discharging "
                   "anything with Lender A."),
        ("Break costs on the fixed facility expiring 03/2027",
         "Medium", "Break cost is estimated at $4,100. Sequence step 2 after the fixed "
                   "period expires, or accept the cost against the $5,278 annual saving."),
    ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=3))
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("strategy.actions", [
        "Confirm you accept the estimated $4,100 break cost.",
        "Provide the last two years of tax returns for both applicants.",
        "Authorise upfront valuations on all four properties.",
        "Confirm the target acquisition timeline has not changed.",
    ]), title="What we need from you", columns=1)
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Loan Comparison Report — Financial Analytical
# ==========================================================================

def loan_comparison_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Product shortlist",
        title=f("report.title", "Loan Comparison Report"),
        subtitle=f("report.subtitle",
                   "Four shortlisted products compared on rate, fees, features, policy "
                   "fit and true cost over your intended hold period."),
        chips=["4 PRODUCTS", "TRUE COST", "AS AT 31/07/26"])
    page_break(doc)

    C.section_opener(doc, theme, "01", "What was compared", "Method and basis")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="info", title="Comparison basis",
        text=f("comparison.basis",
               "Every figure below is calculated on the same loan amount, the same hold "
               "period and the same repayment type. A comparison run on different "
               "assumptions is not a comparison."),
        items=f.items("comparison.basisItems", [
            "Loan amount: $648,000 (80% of $810,000).",
            "Repayment type: interest only for five years, then principal and interest.",
            "Assumed hold period: seven years.",
            "Rates as at 31 July 2026; all lenders on the panel were assessed.",
            "True cost includes interest, establishment, ongoing and discharge fees.",
        ]))
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("LOWEST RATE", f("comparison.lowestRate", "6.09%"), "Lender C"),
        ("LOWEST TRUE COST", f("comparison.lowestCost", "$281,940"), "Lender A, 7 years"),
        ("SPREAD", f("comparison.spread", "$18,620"), "Best to worst"),
        ("RECOMMENDED", f("comparison.recommended", "Lender A"), "See section 05"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "02", "Product comparison", "Rate, fees and structure")
    C.gap(doc, theme)
    C.comparison_table(
        doc, theme,
        subject_labels=[f("products.0.short", "Lender A"), f("products.1.short", "Lender B"),
                        f("products.2.short", "Lender C"), f("products.3.short", "Lender D")],
        attributes=[
            ("Product", ["Investment IO Package", "Investor Variable",
                         "Basic Investor", "Investor Plus"]),
            ("Interest rate", ["6.14%", "6.22%", "6.09%", "6.34%"]),
            ("Comparison rate", ["6.41%", "6.38%", "6.12%", "6.59%"]),
            ("Establishment fee", ["$0", "$395", "$0", "$600"]),
            ("Annual package fee", ["$395", "$0", "$0", "$395"]),
            ("Discharge fee", ["$350", "$350", "$300", "$395"]),
            ("Offset account", ["Included", "Included", "Not available", "Included"]),
            ("Redraw", ["Free", "Free", "$25 per redraw", "Free"]),
            ("Splits", ["Up to 6, no fee", "Up to 4, no fee", "Not available",
                        "Up to 8, no fee"]),
            ("Rate lock", ["Available, $750", "Available, $500", "Not available",
                           "Available, $600"]),
            ("True cost, 7 years", ["$281,940", "$285,610", "$283,180", "$300,560"]),
        ],
        caption="Shortlisted products", winner_index=0)
    C.gap(doc, theme)
    C.bar_chart(doc, theme, caption="True cost over the assumed seven-year hold",
                rows=f.tuples("products.trueCost", [
                    ("Lender A", 281940, "$281,940"),
                    ("Lender C", 283180, "$283,180"),
                    ("Lender B", 285610, "$285,610"),
                    ("Lender D", 300560, "$300,560"),
                ], ("{{product.short}}", 1, "{{product.trueCost}}"), count=4),
                note="True cost is total interest plus all fees over seven years on the "
                     "stated assumptions. It is not the comparison rate, which assumes a "
                     "25-year term on a $150,000 loan.")
    page_break(doc)

    C.section_opener(doc, theme, "03", "Feature matrix", "Available or not")
    C.gap(doc, theme)
    C.status_table(
        doc, theme, headers=["Feature", "Lender A", "Lender B", "Lender C", "Availability"],
        rows=f.tuples("products.features", [
            (["100% offset", "Yes", "Yes", "No", "Pass"], "pass"),
            (["Free redraw", "Yes", "Yes", "No", "Pass"], "pass"),
            (["Unlimited splits", "6 max", "4 max", "None", "Review"], "review"),
            (["Portability", "Yes", "Yes", "Yes", "Pass"], "pass"),
            (["Construction option", "No", "Yes", "No", "Review"], "review"),
            (["Fixed-rate option", "Yes", "Yes", "Yes", "Pass"], "pass"),
            (["Rate lock at application", "Yes, $750", "Yes, $500", "No", "Review"],
             "review"),
        ], (["{{feature}}", "{{a}}", "{{b}}", "{{c}}", "Pending"], "pending"), count=6),
        widths=[52, 30, 30, 30, 30], caption="Features by product",
        note="Feature availability is stated as a word as well as a fill, so this table "
             "reads correctly in grayscale.")
    C.gap(doc, theme)

    C.section_opener(doc, theme, "04", "Policy fit", "How each lender treats your position")
    C.gap(doc, theme)
    C.status_table(
        doc, theme, headers=["Ref", "Your circumstance", "Lender treatment", "Lender", "Status"],
        rows=f.tuples("products.policy", [
            (["4.1", "Bonus income, two-year history", "Accepted at 80%", "Lender A",
              "Pass"], "pass"),
            (["4.2", "Bonus income, two-year history", "Accepted at 50%", "Lender B",
              "Review"], "review"),
            (["4.3", "Rental income from two properties", "Shaded to 90%", "Lender A",
              "Pass"], "pass"),
            (["4.4", "Rental income from two properties", "Shaded to 80%", "Lender C",
              "Review"], "review"),
            (["4.5", "Credit card limits of $28,000", "Assessed at 3.8% of limit", "All",
              "Review"], "review"),
            (["4.6", "Existing exposure with Lender A", "Within single-lender limit",
              "Lender A", "Pass"], "pass"),
        ], (["{{ref}}", "{{circumstance}}", "{{treatment}}", "{{lender}}", "Pending"],
            "pending"), count=6),
        widths=[16, 56, 52, 30, 26], caption="Policy assessment")
    C.gap(doc, theme)
    C.recommendation_box(
        doc, theme,
        recommendation=f("report.recommendation",
                         "Lender A, Investment IO Package. Lowest true cost over seven "
                         "years, the only lender accepting your bonus income at 80%, and "
                         "the full feature set you asked for."),
        rationale=f.text("report.rationale", [
            "Lender C has the lowest headline rate but no offset account, and on the "
            "$40,000 balance you typically hold that costs approximately $2,440 a year in "
            "forgone interest offset — more than the 0.05% rate difference saves.",
            "Lender A's $395 annual package fee is recovered by the offset benefit inside "
            "the first year, and its bonus-income treatment materially improves your "
            "capacity for the next acquisition.",
        ]),
        actions=f.items("report.nextSteps", [
            "Confirm you want the offset account and are comfortable with the package fee.",
            "Decide whether to pay $750 to lock the rate at application.",
            "Provide the last two years of bonus statements.",
        ]),
        confidence=f("report.confidence", "High"))
    C.disclaimer_page(doc, theme, extra_sections=[
        ("Comparison basis and currency",
         "Rates, fees and policies are as at the date stated on the cover and change "
         "without notice. This report compares products; it is not an application, an "
         "approval or an offer of credit, and no lender is bound by anything in it."),
    ])


# ==========================================================================
# Cash-Flow & Net Position Report — Financial Analytical
# ==========================================================================

def cash_flow_net_position_report(doc, theme: Theme, f: Fill) -> None:
    title = "Cash-Flow & Net Position Report"
    C.cover(
        doc, theme,
        eyebrow_text="Ten-year projection",
        title=f("report.title", title),
        subtitle=f("report.subtitle",
                   "What this asset costs or returns, year by year, after tax — with the "
                   "assumptions that produced it and the sensitivity around them."),
        chips=["10 YEARS", "AFTER TAX", "STRESS-TESTED"])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Position summary", "Headline outcome")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("YEAR 1 NET", f("summary.year1", "-$4,368"), "After tax, per year"),
        ("10-YEAR CUMULATIVE", f("summary.cumulative", "$68,420"), "Nominal, after tax"),
        ("BREAK-EVEN YEAR", f("summary.breakEven", "Year 6"), "Cash-flow positive"),
        ("WEEKLY COST, YEAR 1", f("summary.weekly", "$84"), "After tax"),
    ])
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme, title="What this means",
        headline=f("report.headline",
                   "The property costs $84 a week after tax in year one and turns "
                   "cash-flow positive in year six."),
        paragraphs=f.text("report.summary", [
            "On the assumptions in section two, the property runs at a small after-tax "
            "deficit for the first five years and is cash-flow positive from year six. "
            "Cumulative after-tax cash flow over ten years is positive at $68,420, before "
            "any capital growth.",
            "The projection is most sensitive to the interest rate. A sustained two "
            "percentage point rise moves the year-one weekly cost from $84 to $214 and "
            "pushes break-even from year six to year nine.",
        ]))
    C.gap(doc, theme)

    C.section_opener(doc, theme, "02", "Assumptions", "Every input, with its basis")
    C.gap(doc, theme)
    C.chart_frame(doc, theme, title="Cumulative after-tax net position",
                  kind="line chart", binding="{{cashflow.series}}", height_mm=54,
                  caption="Ten years, nominal", source="Aurixa cash-flow model",
                  alt_text="Cumulative after-tax position crosses zero during year six "
                           "and reaches $68,420 by year ten")
    C.gap(doc, theme, 0.6)
    C.info_card(doc, theme, title="Projection assumptions", columns=2, fields=[
        ("Purchase price", f("assumptions.price", "$865,000")),
        ("Loan amount", f("assumptions.loan", "$692,000 (80% LVR)")),
        ("Interest rate", f("assumptions.rate", "6.40%, interest only 5 years")),
        ("Capital growth", f("assumptions.growth", "4.5% p.a. — 10-year suburb average")),
        ("Starting rent", f("assumptions.rent", "$765 per week — appraised")),
        ("Rental growth", f("assumptions.rentGrowth", "3.0% p.a.")),
        ("Vacancy allowance", f("assumptions.vacancy", "2 weeks per year")),
        ("Management fee", f("assumptions.management", "6.9% incl. GST")),
        ("Expense inflation", f("assumptions.inflation", "2.5% p.a.")),
        ("Marginal tax rate", f("assumptions.taxRate", "39% incl. Medicare levy")),
        ("Depreciation", f("assumptions.depreciation", "Quantity surveyor schedule")),
        ("Ownership", f("assumptions.ownership", "Joint, 50/50")),
    ], footnote="Projections are not forecasts. Every figure that follows depends on "
                "these assumptions holding, and none of them will hold exactly.")
    C.gap(doc, theme)
    C.chart_frame(doc, theme, title="Cumulative after-tax net position",
                  kind="line chart", binding="{{cashflow.series}}", height_mm=58,
                  caption="Ten years, nominal", source="Aurixa cash-flow model",
                  alt_text="Cumulative after-tax position crosses zero during year six "
                           "and reaches $68,420 by year ten")

    # The eleven-column projection needs the width; the alternative is shrinking
    # the type until the table is unreadable.
    # A Word section is a page-setup marker in the same body, so the container
    # stays `doc` and only the theme changes to the landscape geometry.
    land = C.begin_landscape(doc, theme, title)
    C.section_opener(doc, land, "03", "Year-by-year projection", "The model output")
    C.gap(doc, land)
    C.data_table(
        doc, land,
        ["Year", "Rent", "Vacancy", "Expenses", "Interest", "Pre-tax", "Deprec.",
         "Taxable", "Tax effect", "After tax", "Cumulative"],
        f.rows("cashflow.years", [
            ["1", "$39,780", "-$1,530", "-$9,215", "-$44,288", "-$15,253", "-$11,400",
             "-$26,653", "$10,395", "-$4,858", "-$4,858"],
            ["2", "$40,973", "-$1,576", "-$9,445", "-$44,288", "-$14,336", "-$9,800",
             "-$24,136", "$9,413", "-$4,923", "-$9,781"],
            ["3", "$42,202", "-$1,623", "-$9,682", "-$44,288", "-$13,391", "-$8,600",
             "-$21,991", "$8,576", "-$4,815", "-$14,596"],
            ["4", "$43,468", "-$1,672", "-$9,924", "-$44,288", "-$12,416", "-$7,700",
             "-$20,116", "$7,845", "-$4,571", "-$19,167"],
            ["5", "$44,772", "-$1,722", "-$10,172", "-$44,288", "-$11,410", "-$7,000",
             "-$18,410", "$7,180", "-$4,230", "-$23,397"],
            ["6", "$46,115", "-$1,774", "-$10,426", "-$42,104", "-$8,189", "-$6,400",
             "-$14,589", "$5,690", "-$2,499", "-$25,896"],
            ["7", "$47,499", "-$1,827", "-$10,687", "-$40,982", "-$5,997", "-$5,900",
             "-$11,897", "$4,640", "-$1,357", "-$27,253"],
            ["8", "$48,924", "-$1,882", "-$10,954", "-$39,798", "-$3,710", "-$5,500",
             "-$9,210", "$3,592", "-$118", "-$27,371"],
            ["9", "$50,392", "-$1,938", "-$11,228", "-$38,549", "-$1,323", "-$5,100",
             "-$6,423", "$2,505", "$1,182", "-$26,189"],
            ["10", "$51,904", "-$1,996", "-$11,509", "-$37,232", "$1,167", "-$4,800",
             "-$3,633", "$1,417", "$2,584", "-$23,605"],
        ], ["{{year}}", "{{rent}}", "{{vacancy}}", "{{expenses}}", "{{interest}}",
            "{{preTax}}", "{{depreciation}}", "{{taxable}}", "{{taxEffect}}",
            "{{afterTax}}", "{{cumulative}}"], count=10),
        widths=[16, 26, 24, 26, 26, 24, 24, 24, 25, 25, 26],
        numeric_cols={1, 2, 3, 4, 5, 6, 7, 8, 9, 10},
        total_row=["Total", "$456,029", "-$17,540", "-$103,242", "-$420,105", "-$84,858",
                   "-$72,200", "-$157,058", "$61,253", "-$23,605", ""],
        caption="Ten-year after-tax cash flow",
        note="Negative figures are outflows. 'Tax effect' is the reduction in tax payable "
             "from the taxable loss at the stated marginal rate; it is a benefit only to "
             "the extent there is other income to offset.")
    C.end_landscape(doc, theme, title)

    C.section_opener(doc, theme, "04", "Expense breakdown", "Where year one goes")
    C.gap(doc, theme)
    C.bar_chart(doc, theme, caption="Year-one expenses by category",
                rows=f.tuples("expenses.breakdown", [
                    ("Loan interest", 44288, "$44,288"),
                    ("Property management", 2745, "$2,745"),
                    ("Council rates", 2140, "$2,140"),
                    ("Insurance", 1650, "$1,650"),
                    ("Repairs allowance", 1500, "$1,500"),
                    ("Water and sewer", 1180, "$1,180"),
                ], ("{{expense.name}}", 1, "{{expense.amount}}"), count=5),
                note="Interest is 82% of year-one outgoings, which is why the projection "
                     "is more sensitive to rates than to anything else.")
    C.gap(doc, theme)

    C.section_opener(doc, theme, "05", "Sensitivity", "What changes the answer")
    C.gap(doc, theme)
    C.comparison_table(
        doc, theme,
        subject_labels=["Base", "Rate +1%", "Rate +2%", "Vacancy 6 wks", "Rent -10%"],
        attributes=[
            ("Year-1 after tax", ["-$4,858", "-$9,077", "-$13,296", "-$7,655", "-$7,285"]),
            ("Year-1 weekly", ["-$93", "-$175", "-$256", "-$147", "-$140"]),
            ("Break-even year", ["Year 6", "Year 8", "Year 9", "Year 7", "Year 8"]),
            ("10-year cumulative", ["-$23,605", "-$58,420", "-$93,235", "-$41,180",
                                    "-$52,940"]),
        ],
        caption="After-tax position under stress", winner_index=0)
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="warning", title="Read this alongside the projection",
        text=f("report.caveat",
               "This is a projection on stated assumptions, not a forecast. It excludes "
               "capital growth, which is the return most investors are actually buying, "
               "and it excludes selling costs and capital gains tax. It is not tax advice; "
               "the depreciation and tax figures should be confirmed with the client's "
               "accountant against their whole position."))
    C.disclaimer_page(doc, theme)
