"""Builders for the property templates.

Each function takes a resolved ``Theme`` and a ``Fill``, and returns nothing —
it writes into the document it is given. Section order matches the ``sections``
tuple of the corresponding ``TemplateSpec`` in ``catalogue.py``, so the built
artefact and the published brief cannot diverge.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import components as C  # noqa: E402
from content import Fill  # noqa: E402
from oxml import page_break  # noqa: E402
from theme import Theme  # noqa: E402


# ==========================================================================
# Property Investment Report — Property Visual
# ==========================================================================

def property_investment_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Property investment analysis",
        title=f("report.title", "Property Investment Report"),
        subtitle=f("property.address",
                   "12 Example Street, Northbridge NSW 2063 — a researched investment "
                   "case covering the asset, the numbers, the risks and a recommendation."),
        chips=["RESEARCHED", "MODELLED", "RECOMMENDED"],
        image_caption=f("property.images.0.caption", "Street elevation, facing north"),
    )
    page_break(doc)

    C.table_of_contents(doc, theme, [
        ("01", "Executive summary"), ("02", "Investment metrics"),
        ("03", "Property overview"), ("04", "Location & amenity"),
        ("05", "Financial analysis"), ("06", "Cash-flow projection"),
        ("07", "Comparable sales"), ("08", "Risks & mitigations"),
        ("09", "Recommendation"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Executive summary", "The case in brief")
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme,
        headline=f("report.headline",
                   "The property meets the mandate on yield, holding cost and location, "
                   "with two risks that are manageable."),
        paragraphs=f.text("report.executiveSummary", [
            "The subject property is a three-bedroom freestanding house on 512m² in an "
            "established residential pocket 11km from the CBD. It presents in original but "
            "sound condition and has been continuously tenanted for the last four years.",
            "On the assumptions set out in this report the property produces a gross yield "
            "of 4.6% and a first-year after-tax holding cost of $84 per week, which is "
            "within the budget agreed in the client brief. The suburb has recorded 6.1% "
            "compound annual growth over ten years against a metropolitan average of 5.4%.",
            "Two matters require attention before exchange: the tenancy runs to a fixed "
            "term expiring in four months, and the building report identifies rising damp "
            "to the rear wall. Both are quantified in the risk section and neither is "
            "assessed as material to the recommendation.",
        ]),
        takeaways=f.items("report.takeaways", [
            "Gross yield of 4.6% clears the 4.2% threshold in the client brief.",
            "After-tax holding cost of $84/week is inside the agreed $150/week budget.",
            "Rising damp remediation is estimated at $6,500 and should be negotiated.",
            "Recommended maximum offer is $865,000.",
        ]))
    C.gap(doc, theme)

    C.section_opener(doc, theme, "02", "Investment metrics", "Headline position")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("PURCHASE PRICE", f("financials.price", "$865,000"), "Recommended maximum"),
        ("GROSS YIELD", f("financials.grossYield", "4.6%"), "On appraised rent"),
        ("WEEKLY RENT", f("financials.weeklyRent", "$765"), "Appraised range $750–780"),
        ("CASH REQUIRED", f("financials.cashRequired", "$212,400"), "Incl. costs, 20% deposit"),
    ])
    C.gap(doc, theme)

    C.section_opener(doc, theme, "03", "Property overview", "The asset")
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Property particulars", fields=[
        ("Address", f("property.address", "12 Example Street, Northbridge NSW 2063")),
        ("Property type", f("property.type", "Freestanding house")),
        ("Land area", f("property.landArea", "512 m²")),
        ("Building area", f("property.buildingArea", "148 m²")),
        ("Bedrooms / bathrooms", f("property.bedBath", "3 / 1")),
        ("Car spaces", f("property.carSpaces", "2 (lock-up garage)")),
        ("Year built", f("property.yearBuilt", "1968")),
        ("Zoning", f("property.zoning", "R2 Low Density Residential")),
        ("Current tenancy", f("property.tenancy", "Fixed term to 14/11/2026 at $740/week")),
        ("Condition", f("property.condition", "Original, structurally sound")),
    ])
    C.gap(doc, theme)
    C.image_gallery(doc, theme, count=4, columns=2, captions=[
        f("property.images.0.caption", "Street elevation"),
        f("property.images.1.caption", "Living and dining"),
        f("property.images.2.caption", "Kitchen, original"),
        f("property.images.3.caption", "Rear yard and garage"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "04", "Location & amenity", "Why here")
    C.gap(doc, theme)
    C.map_frame(doc, theme, title="Subject and amenity",
                alt_text="Map showing the subject property, transport, schools and retail",
                legend=[("●", "Subject property"), ("▲", "Rail"), ("■", "Schools"),
                        ("◆", "Retail")])
    C.gap(doc, theme, 0.6)
    C.prose(doc, theme, f.text("property.locationNarrative", [
        "The property sits on the northern side of the street, three streets from the "
        "primary retail strip and 900 metres from the station. The catchment primary "
        "school is within 1.2km and is at capacity, which historically supports family "
        "demand in the immediate blocks.",
    ]))
    C.gap(doc, theme)

    C.section_opener(doc, theme, "05", "Financial analysis", "Acquisition and holding")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Item", "Basis", "Amount", "Notes"],
        f.rows("financials.acquisition", [
            ["Purchase price", "Recommended maximum", "$865,000", "—"],
            ["Stamp duty", "NSW, investor", "$34,290", "Estimate"],
            ["Legal and conveyancing", "Fixed fee", "$1,800", "Quoted"],
            ["Building and pest", "Fixed fee", "$650", "Completed"],
            ["Lender and valuation fees", "Estimate", "$1,100", "Lender dependent"],
            ["Buyer's agency fee", "Per engagement", "$14,200", "Incl. GST"],
        ], ["{{item}}", "{{basis}}", "{{amount}}", "{{notes}}"], count=5),
        widths=[52, 40, 32, 54], numeric_cols={2},
        total_row=["Total acquisition cost", "", f("financials.totalCost", "$917,040"), ""],
        caption="Acquisition costs",
        note="Stamp duty is an estimate only and must be confirmed with the client's "
             "conveyancer. Figures exclude GST unless stated.")
    C.gap(doc, theme, 0.7)
    C.data_table(
        doc, theme, ["Item", "Annual", "Weekly", "Basis"],
        f.rows("financials.holding", [
            ["Rental income", "$39,780", "$765", "Appraised"],
            ["Council rates", "-$2,140", "-$41", "Actual"],
            ["Water and sewer", "-$1,180", "-$23", "Actual"],
            ["Insurance", "-$1,650", "-$32", "Quoted"],
            ["Property management", "-$2,745", "-$53", "6.9% incl. GST"],
            ["Repairs allowance", "-$1,500", "-$29", "Assumption"],
            ["Loan interest", "-$41,472", "-$798", "6.4% on $648,000"],
        ], ["{{item}}", "{{annual}}", "{{weekly}}", "{{basis}}"], count=6),
        widths=[58, 34, 30, 56], numeric_cols={1, 2},
        total_row=["Pre-tax position", f("financials.preTax", "-$10,907"),
                   f("financials.preTaxWeekly", "-$210"), ""],
        caption="First-year holding position")
    page_break(doc)

    C.section_opener(doc, theme, "06", "Cash-flow projection", "Ten-year view")
    C.gap(doc, theme)
    C.chart_frame(doc, theme, title="Cumulative after-tax position",
                  kind="line chart", binding="{{cashflow.series}}",
                  caption="Ten years, nominal",
                  source=f("cashflow.source", "Aurixa cash-flow model"),
                  alt_text="Cumulative after-tax net position turns positive in year six")
    C.gap(doc, theme, 0.6)
    C.info_card(doc, theme, title="Projection assumptions", fields=[
        ("Capital growth", f("assumptions.growth", "4.5% p.a.")),
        ("Rental growth", f("assumptions.rentGrowth", "3.0% p.a.")),
        ("Interest rate", f("assumptions.rate", "6.40%, interest only 5 years")),
        ("Vacancy allowance", f("assumptions.vacancy", "2 weeks p.a.")),
        ("Marginal tax rate", f("assumptions.taxRate", "39% incl. Medicare")),
        ("Depreciation", f("assumptions.depreciation", "Quantity surveyor estimate")),
    ])
    C.gap(doc, theme)

    C.section_opener(doc, theme, "07", "Comparable sales", "Evidence for the price")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Address", "Sold", "Price", "Land", "Beds", "Adjustment"],
        f.rows("comparables", [
            ["8 Sample Avenue", "Jun 2026", "$872,000", "498 m²", "3", "−$10,000 (condition)"],
            ["21 Test Road", "May 2026", "$845,000", "521 m²", "3", "+$15,000 (position)"],
            ["4 Example Street", "Apr 2026", "$910,000", "540 m²", "4", "−$45,000 (size)"],
            ["17 Demo Close", "Mar 2026", "$838,000", "486 m²", "3", "+$22,000 (renovated)"],
        ], ["{{address}}", "{{soldDate}}", "{{soldPrice}}", "{{land}}", "{{beds}}",
            "{{adjustment}}"], count=4),
        widths=[54, 26, 30, 24, 18, 46], numeric_cols={2},
        caption="Recent comparable sales",
        note="Adjustments are the analyst's assessment relative to the subject property.")
    C.gap(doc, theme)

    C.section_opener(doc, theme, "08", "Risks & mitigations", "What could go wrong")
    C.gap(doc, theme)
    C.risk_box(doc, theme, risks=f.tuples("risks", [
        ("Rising damp to the rear wall requires remediation",
         "Medium", "Obtain a fixed-price rectification quote and negotiate a price "
                   "reduction of no less than the quoted amount before exchange."),
        ("Fixed tenancy expires in four months at below-market rent",
         "Low", "Rent is $25/week below appraisal; re-letting at market improves yield. "
                "Budget two weeks vacancy at changeover."),
        ("Interest rates rise beyond the assumed 6.40%",
         "Medium", "Position is stress-tested at +2%; holding cost rises to $214/week, "
                   "which exceeds the client's stated budget."),
    ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=3))
    C.gap(doc, theme)

    C.section_opener(doc, theme, "09", "Recommendation", "The decision")
    C.gap(doc, theme)
    C.recommendation_box(
        doc, theme,
        recommendation=f("report.recommendation",
                         "Proceed to offer at or below $865,000, subject to building and "
                         "pest, finance, and a price adjustment for damp remediation."),
        rationale=f.text("report.rationale", [
            "The property clears the yield and holding-cost thresholds set in the client "
            "brief, is supported by four adjusted comparable sales, and sits in a suburb "
            "with a ten-year growth record above the metropolitan average. The identified "
            "defects are quantifiable and are best dealt with as a price adjustment rather "
            "than a condition of the contract.",
        ]),
        actions=f.items("report.nextSteps", [
            "Obtain a fixed-price damp rectification quote.",
            "Issue an offer at $865,000 less the quoted rectification amount.",
            "Confirm finance approval covers the adjusted purchase price.",
            "Instruct the conveyancer to review the residential tenancy agreement.",
        ]),
        confidence=f("report.confidence", "High"))
    C.gap(doc, theme)
    C.adviser_profile(doc, theme,
                      bio=f("author.bio",
                            "Licensed buyer's agent specialising in established "
                            "residential stock across the lower north shore."),
                      credentials=f.items("author.credentialList", [
                          "Licensed real estate agent (NSW)",
                          "Member, Real Estate Buyers Agents Association",
                      ]))

    C.appendix_opener(doc, theme, "A", "Data sources & provenance",
                      "Every figure in this report and where it came from.")
    C.gap(doc, theme, 0.6)
    C.data_table(doc, theme, ["Data", "Source", "As at"],
                 f.rows("appendix.sources", [
                     ["Comparable sales", "State valuer-general records", "01/07/2026"],
                     ["Rental appraisal", "Independent managing agent", "18/07/2026"],
                     ["Suburb growth", "Aurixa market data", "30/06/2026"],
                     ["Building condition", "Licensed building inspector", "22/07/2026"],
                 ], ["{{data}}", "{{source}}", "{{asAt}}"], count=4),
                 widths=[60, 80, 38])
    C.disclaimer_page(doc, theme)
    C.back_cover(doc, theme)


# ==========================================================================
# Property Acquisition Recommendation — Premium Advisory
# ==========================================================================

def property_acquisition_recommendation(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Advisory recommendation",
        title=f("report.title", "Property Acquisition Recommendation"),
        subtitle=f("report.subtitle",
                   "Our recommendation on the property we believe you should acquire, "
                   "the reasoning behind it and the strategy to secure it."),
        chips=["ADVISORY", "DECISION-READY"])
    page_break(doc)

    C.recommendation_box(
        doc, theme,
        title="Our recommendation",
        recommendation=f("report.recommendation",
                         "Acquire 12 Example Street, Northbridge at or below $865,000 "
                         "on a 42-day settlement with a five-day building and pest "
                         "condition."),
        rationale=f.text("report.rationale", [
            "Of the eleven properties assessed against your brief this quarter, this is "
            "the only one that satisfies every stated requirement without compromise on "
            "land size, and it does so inside your budget.",
        ]),
        actions=f.items("report.nextSteps", [
            "Confirm your authority to offer at the recommended level.",
            "We issue the offer and manage negotiation.",
            "Building and pest inspections are booked within 48 hours of acceptance.",
        ]),
        confidence=f("report.confidence", "High"))
    C.gap(doc, theme)

    C.section_opener(doc, theme, "01", "Why this property", "The case")
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme, title="Summary",
        headline=f("report.headline",
                   "It meets every requirement in your brief, at a price supported by "
                   "four comparable sales."),
        paragraphs=f.text("report.summary", [
            "Your brief set a firm minimum of 500m² of land, a maximum of 12km from the "
            "CBD, and a gross yield above 4.2%. Nine of the eleven properties we assessed "
            "failed on land size alone. Of the two that qualified, this property is the "
            "better positioned and the more defensible on price.",
            "The seller's circumstances favour a shorter settlement, which gives us a "
            "genuine non-price lever in the negotiation. We believe that lever is worth "
            "between $15,000 and $25,000 against the guide.",
        ]))
    C.gap(doc, theme)

    C.section_opener(doc, theme, "02", "Alignment to your brief", "Requirement by requirement")
    C.gap(doc, theme)
    C.comparison_table(
        doc, theme,
        subject_labels=["Your requirement", "This property"],
        attributes=[
            ("Land size", [f("brief.land", "Minimum 500 m²"),
                           f("property.landArea", "512 m² ✔")]),
            ("Distance to CBD", [f("brief.distance", "Within 12 km"),
                                 f("property.distance", "11.2 km ✔")]),
            ("Gross yield", [f("brief.yield", "Above 4.2%"),
                             f("property.yield", "4.6% ✔")]),
            ("Budget", [f("brief.budget", "Up to $900,000"),
                        f("property.price", "$865,000 ✔")]),
            ("Bedrooms", [f("brief.beds", "3 or more"), f("property.beds", "3 ✔")]),
            ("Condition", [f("brief.condition", "No major structural work"),
                           f("property.condition", "Sound; cosmetic only ✔")]),
            ("Tenancy", [f("brief.tenancy", "Tenanted preferred"),
                         f("property.tenancy", "Fixed term to Nov 2026 ✔")]),
        ],
        caption="Your brief against this property", winner_index=1)
    C.gap(doc, theme)

    C.section_opener(doc, theme, "03", "Key numbers", "The financial position")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("RECOMMENDED OFFER", f("financials.offer", "$865,000"), "Maximum"),
        ("GROSS YIELD", f("financials.grossYield", "4.6%"), "On appraised rent"),
        ("CASH REQUIRED", f("financials.cashRequired", "$212,400"), "Incl. all costs"),
        ("HOLDING COST", f("financials.holdingCost", "$84/wk"), "After tax, year one"),
    ])
    C.gap(doc, theme)

    C.section_opener(doc, theme, "04", "Acquisition strategy", "How we secure it")
    C.gap(doc, theme)
    C.process_flow(doc, theme, f.tuples("strategy.steps", [
        ("Open", "Offer at $848,000 with a 42-day settlement and a five-day condition."),
        ("Hold", "Do not improve on price before the agent brings a counter."),
        ("Improve", "Move to $858,000 only against a written counter above $875,000."),
        ("Ceiling", "$865,000. We will not recommend exceeding this."),
        ("Secure", "Exchange within five business days of acceptance."),
    ], ("{{step.name}}", "{{step.detail}}"), count=4))
    C.gap(doc, theme)
    C.risk_box(doc, theme, title="What would change this recommendation",
               risks=f.tuples("risks", [
                   ("Building report identifies structural movement",
                    "High", "We withdraw the recommendation and resume the search."),
                   ("Competing offer pushes the price beyond $865,000",
                    "Medium", "We do not compete beyond the ceiling; two alternatives "
                              "remain under assessment."),
                   ("Finance approval does not cover the adjusted price",
                    "Medium", "Confirm approval before the offer is issued."),
               ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=3))
    C.gap(doc, theme)

    C.section_opener(doc, theme, "05", "Your authority", "What we need from you")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("authority.items", [
        "I authorise an opening offer of $848,000.",
        "I authorise a maximum offer of $865,000.",
        "I authorise a 42-day settlement.",
        "I confirm finance is in place to the recommended level.",
    ]), title="Authority to act")
    C.gap(doc, theme, 0.7)
    C.signature_block(doc, theme, [
        ("Client authority", ["Name:", "Signature:", "Date:  ____ / ____ / ______"]),
        ("For the agency", [f"Name: {f('author.name', 'A. Nguyen')}", "Signature:",
                            "Date:  ____ / ____ / ______"]),
    ])
    C.disclaimer_page(doc, theme)


# ==========================================================================
# Off-Market Opportunity Report — Luxury Presentation
# ==========================================================================

def off_market_opportunity_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Private & confidential",
        title=f("opportunity.title", "A Harbourside Residence, Off Market"),
        subtitle=f("opportunity.subtitle",
                   "An opportunity offered privately, ahead of any public campaign."),
        image_caption=f("opportunity.coverCaption",
                        "North-east aspect across the harbour"),
        prepared_for=False)
    page_break(doc)

    C.section_opener(doc, theme, "", "The opportunity", "")
    C.gap(doc, theme)
    C.prose(doc, theme, f.text("opportunity.narrative", [
        "The property has been held by one family since 1974. It has not been offered "
        "publicly, and the owners have asked that it not be. We have been given a "
        "four-week window to introduce it to a small number of qualified buyers before "
        "any decision is made about a campaign.",
        "It occupies 1,140 square metres on the high side of a cul-de-sac, with a "
        "north-east aspect and unimpeded water views from the principal living level. "
        "The house is substantial and original. It is habitable as it stands and will "
        "reward either a considered restoration or a replacement dwelling, subject to the "
        "usual approvals.",
        "Opportunities of this kind on this street reach the open market perhaps once in "
        "a decade. We are able to arrange an inspection at short notice.",
    ]), size=theme.type_scale.body + 0.5)
    C.gap(doc, theme)

    C.metric_panel(doc, theme, [
        ("GUIDE", f("opportunity.guide", "$6.4m – $6.9m"), "Private treaty"),
        ("LAND", f("property.landArea", "1,140 m²"), "High side, north-east"),
        ("ACCOMMODATION", f("property.accommodation", "5 · 3 · 4"), "Bed · bath · car"),
        ("AVAILABILITY", f("opportunity.availability", "4 weeks"), "Private window"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "", "The property", "")
    C.gap(doc, theme)
    C.image_gallery(doc, theme, count=4, columns=2, height_mm=52, captions=[
        f("property.images.0.caption", "Principal living level, north-east aspect"),
        f("property.images.1.caption", "Terrace and gardens"),
        f("property.images.2.caption", "Original kitchen and family room"),
        f("property.images.3.caption", "Street approach"),
    ])
    C.gap(doc, theme)
    C.map_frame(doc, theme, title="Position", height_mm=64,
                alt_text="Map showing the property's position within the precinct",
                legend=[("●", "The property"), ("▲", "Ferry"), ("■", "Village")])
    page_break(doc)

    C.section_opener(doc, theme, "", "Terms & process", "")
    C.gap(doc, theme)
    C.process_flow(doc, theme, f.tuples("opportunity.process", [
        ("Register", "Confirm interest and complete the confidentiality undertaking."),
        ("Inspect", "Private inspection by appointment, weekdays only."),
        ("Offer", "Written offer with evidence of funds and settlement terms."),
        ("Decide", "The owners will consider offers at the close of the window."),
    ], ("{{step.name}}", "{{step.detail}}"), count=4))
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="alert", title="Confidentiality",
        text=f("opportunity.confidentiality",
               "This document is provided in confidence to a named recipient. It may not "
               "be forwarded, reproduced, published or discussed with any third party, "
               "including other agents, without our written consent. The owners have not "
               "authorised a public campaign and the property is not currently for sale "
               "on the open market."))
    C.gap(doc, theme)
    C.adviser_profile(doc, theme,
                      bio=f("author.bio",
                            "Handles private and pre-market transactions across the "
                            "eastern harbour precincts."),
                      credentials=f.items("author.credentialList", [
                          "Licensed real estate agent",
                          "Twenty-two years in prestige transactions",
                      ]))
    C.back_cover(doc, theme)
