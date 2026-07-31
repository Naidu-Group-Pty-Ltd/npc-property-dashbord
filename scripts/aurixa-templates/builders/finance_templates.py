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
