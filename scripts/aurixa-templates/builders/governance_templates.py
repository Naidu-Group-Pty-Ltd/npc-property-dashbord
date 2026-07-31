"""Builders for the client-form, compliance and business templates."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import components as C  # noqa: E402
from content import Fill  # noqa: E402
from oxml import page_break  # noqa: E402
from theme import Theme  # noqa: E402

BLANK = ""


# ==========================================================================
# Client Fact-Find Form — Minimal Professional
# ==========================================================================

def client_fact_find_form(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Client intake",
        title=f("form.title", "Client Fact-Find"),
        subtitle=f("form.subtitle",
                   "Your personal, employment and financial position. Complete every "
                   "section that applies — leave the rest blank."),
        prepared_for=False)
    C.gap(doc, theme, 0.6)
    C.definition_grid(doc, theme, [
        ("Client reference", f("client.reference", "{{client.reference}}")),
        ("Date", f("document.issueDate", "{{document.issueDate}}")),
        ("Adviser", f("author.name", "{{author.name}}")),
        ("Form version", f("document.version", "{{document.version}}")),
    ])
    C.gap(doc, theme, 0.7)
    C.highlight_box(
        doc, theme, tone="info", title="Before you start",
        text="Shaded fields are for you to complete. You can type directly into this "
             "document and use Tab to move between fields, or print it and complete it by "
             "hand. Nothing in this form commits you to anything.",
        items=[
            "Have your last two payslips and most recent tax return to hand.",
            "You will need balances and limits for every loan and credit card.",
            "If a section does not apply to you, leave it blank rather than writing N/A.",
        ])
    page_break(doc)

    C.section_opener(doc, theme, "1", "Applicant details", "Both applicants where relevant")
    C.gap(doc, theme)
    for index, label in enumerate(("Applicant 1", "Applicant 2")):
        C.subsection(doc, theme, label, before=0 if index == 0 else 10)
        C.definition_grid(doc, theme, [
            ("Title", BLANK), ("First name", BLANK), ("Middle name", BLANK),
            ("Surname", BLANK), ("Date of birth", BLANK), ("Gender", BLANK),
            ("Marital status", BLANK), ("Residency status", BLANK),
            ("Number of dependants", BLANK), ("Ages of dependants", BLANK),
            ("Mobile", BLANK), ("Email", BLANK),
        ], columns=2, input_style=True)
    C.gap(doc, theme)

    C.section_opener(doc, theme, "2", "Address history", "Three years where available")
    C.gap(doc, theme)
    C.definition_grid(doc, theme, [
        ("Current address", BLANK), ("Living situation", BLANK),
        ("Date moved in", BLANK), ("Monthly rent or board", BLANK),
        ("Previous address", BLANK), ("Previous living situation", BLANK),
        ("Previous date moved in", BLANK), ("Reason for moving", BLANK),
    ], columns=2, input_style=True)
    page_break(doc)

    C.section_opener(doc, theme, "3", "Employment & income", "Gross annual amounts")
    C.gap(doc, theme)
    for index, label in enumerate(("Applicant 1", "Applicant 2")):
        C.subsection(doc, theme, label, before=0 if index == 0 else 10)
        C.definition_grid(doc, theme, [
            ("Employment type", BLANK), ("Employer or business", BLANK),
            ("Role or position", BLANK), ("Employer address", BLANK),
            ("Start date", BLANK), ("Base salary (annual)", BLANK),
            ("Bonus (annual)", BLANK), ("Commission (annual)", BLANK),
            ("Overtime (annual)", BLANK), ("Other taxable income", BLANK),
        ], columns=2, input_style=True)
    C.gap(doc, theme)

    C.section_opener(doc, theme, "4", "Assets", "Everything you own")
    C.gap(doc, theme)
    C.data_table(
        doc, theme,
        ["Asset type", "Description or address", "Owner", "Value", "Income",
         "Lender", "Loan balance", "Repayment"],
        [[BLANK] * 8 for _ in range(10)],
        widths=[30, 46, 20, 24, 22, 24, 26, 24], numeric_cols={3, 4, 6, 7},
        total_row=["Total", "", "", BLANK, BLANK, "", BLANK, BLANK],
        caption="Assets and any loans secured against them",
        note="Record a loan on the same row as the asset it is secured against, so it is "
             "not counted twice.")
    C.gap(doc, theme)

    C.section_opener(doc, theme, "5", "Liabilities", "Debts not secured above")
    C.gap(doc, theme)
    C.data_table(
        doc, theme,
        ["Liability type", "Lender", "Account", "Owner", "Limit", "Balance", "Repayment"],
        [[BLANK] * 7 for _ in range(8)],
        widths=[32, 28, 32, 20, 24, 24, 26], numeric_cols={4, 5, 6},
        total_row=["Total", "", "", "", BLANK, BLANK, BLANK])
    page_break(doc)

    C.section_opener(doc, theme, "6", "Living expenses", "Average monthly amounts")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Category", "Monthly", "Category", "Monthly"],
        [["Groceries", BLANK, "Insurance", BLANK],
         ["Utilities", BLANK, "Medical & health", BLANK],
         ["Council rates & water", BLANK, "Personal care & clothing", BLANK],
         ["Childcare & education", BLANK, "Recreation & dining", BLANK],
         ["Transport & fuel", BLANK, "Communications & streaming", BLANK],
         ["Rent or board", BLANK, "Other regular expenses", BLANK]],
        widths=[54, 30, 54, 30], numeric_cols={1, 3},
        total_row=["Total monthly living expenses", BLANK, "", ""])
    C.gap(doc, theme)

    C.section_opener(doc, theme, "7", "Declaration", "What you are confirming")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="warning", title="Declaration",
        text=f("form.declaration",
               "I confirm that the information I have provided is true and complete to "
               "the best of my knowledge, that I have not omitted anything that would "
               "affect an assessment of my financial position, and that I will notify my "
               "adviser promptly if my circumstances change materially before any "
               "application is submitted."))
    C.gap(doc, theme, 0.7)
    C.signature_block(doc, theme, [
        ("Applicant 1", ["Full name:", "Signature:", "Date:  ____ / ____ / ______"]),
        ("Applicant 2", ["Full name:", "Signature:", "Date:  ____ / ____ / ______"]),
    ])
    C.disclaimer_page(doc, theme, extra_sections=[
        ("Consent to collect",
         "By signing this form you consent to the collection, use and storage of the "
         "personal and financial information it contains for the purpose of assessing "
         "your position and, where you separately authorise it, arranging services on "
         "your behalf."),
    ])


# ==========================================================================
# AML & KYC Assessment — Compliance Structured
# ==========================================================================

def aml_kyc_assessment(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Customer due diligence — restricted",
        title=f("report.title", "AML & KYC Assessment"),
        subtitle=f("report.subtitle",
                   "Identity, beneficial ownership, screening, source of funds, risk "
                   "rating and the onboarding decision."),
        chips=["RESTRICTED", "RETAINED", "AUDITABLE"])
    page_break(doc)

    C.recommendation_box(
        doc, theme, title="Assessment outcome",
        recommendation=f("assessment.outcome",
                         "Accept with enhanced controls. Customer risk rating: MEDIUM."),
        rationale=f.text("assessment.rationale", [
            "Identity and beneficial ownership are fully verified against primary "
            "documents. Screening returned no sanctions or adverse media matches. One "
            "beneficial owner is a domestic politically exposed person, which triggers "
            "enhanced due diligence and senior approval under the programme.",
        ]),
        actions=f.items("assessment.conditions", [
            "Senior compliance approval obtained before onboarding (recorded below).",
            "Source of wealth evidence obtained and retained.",
            "Review frequency set to 12 months rather than 36.",
        ]),
        confidence=f("assessment.rating", "Medium risk"))
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Customer", columns=2, fields=[
        ("Legal name", f("customer.legalName", "Example Holdings Pty Ltd")),
        ("Customer type", f("customer.type", "Australian proprietary company")),
        ("ACN", f("customer.acn", "600 123 456")),
        ("ABN", f("customer.abn", "12 600 123 456")),
        ("Registered address", f("customer.address", "Level 4, 100 Sample Street, Sydney NSW 2000")),
        ("Principal activity", f("customer.activity", "Property investment")),
        ("Relationship type", f("customer.relationship", "Investor client")),
        ("Case reference", f("case.reference", "AML-2026-0418")),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "1", "Identity verification", "Primary documents")
    C.gap(doc, theme)
    C.status_table(
        doc, theme,
        headers=["Ref", "Subject", "Document", "Number", "Expiry", "Method", "Status"],
        rows=f.tuples("identity.documents", [
            (["1.1", "J. Nguyen", "Australian passport", "PA1234567", "04/2031",
              "Electronic + visual", "Pass"], "pass"),
            (["1.2", "J. Nguyen", "Driver licence (NSW)", "12345678", "09/2029",
              "Electronic", "Pass"], "pass"),
            (["1.3", "S. Nguyen", "Australian passport", "PB7654321", "11/2028",
              "Electronic + visual", "Pass"], "pass"),
            (["1.4", "Example Holdings", "ASIC company extract", "600123456", "n/a",
              "Registry search", "Pass"], "pass"),
        ], (["{{ref}}", "{{subject}}", "{{document}}", "{{number}}", "{{expiry}}",
             "{{method}}", "Pending"], "pending"), count=4),
        widths=[16, 32, 44, 30, 22, 40, 26],
        caption="Documents verified")
    C.gap(doc, theme)

    C.section_opener(doc, theme, "2", "Beneficial ownership", "25% threshold")
    C.gap(doc, theme)
    C.status_table(
        doc, theme,
        headers=["Ref", "Beneficial owner", "Interest", "Basis", "Verified", "Status"],
        rows=f.tuples("beneficialOwners", [
            (["2.1", "J. Nguyen", "60%", "Direct shareholding", "1.1, 1.2", "Pass"], "pass"),
            (["2.2", "S. Nguyen", "40%", "Direct shareholding", "1.3", "Pass"], "pass"),
            (["2.3", "J. Nguyen", "Control", "Sole director", "1.4", "Pass"], "pass"),
        ], (["{{ref}}", "{{name}}", "{{interest}}", "{{basis}}", "{{evidence}}", "Pending"],
            "pending"), count=3),
        widths=[16, 46, 24, 46, 28, 26],
        caption="Owners and controllers at or above 25%")
    C.gap(doc, theme)

    C.section_opener(doc, theme, "3", "Screening", "PEP, sanctions, adverse media")
    C.gap(doc, theme)
    C.status_table(
        doc, theme,
        headers=["Ref", "Subject", "Check", "Provider", "Date", "Result", "Status"],
        rows=f.tuples("screening", [
            (["3.1", "J. Nguyen", "Sanctions", "Screening provider", "29/07/2026",
              "No match", "Clear"], "clear"),
            (["3.2", "J. Nguyen", "PEP", "Screening provider", "29/07/2026",
              "Domestic PEP — local council", "Review"], "review"),
            (["3.3", "J. Nguyen", "Adverse media", "Screening provider", "29/07/2026",
              "No match", "Clear"], "clear"),
            (["3.4", "S. Nguyen", "Sanctions / PEP / media", "Screening provider",
              "29/07/2026", "No match", "Clear"], "clear"),
        ], (["{{ref}}", "{{subject}}", "{{check}}", "{{provider}}", "{{date}}",
             "{{result}}", "Pending"], "pending"), count=4),
        widths=[16, 32, 32, 34, 30, 48, 26],
        caption="Screening performed")
    C.gap(doc, theme, 0.7)
    C.data_table(
        doc, theme, ["Element", "Declared", "Evidence obtained", "Assessment"],
        f.rows("sourceOfFunds", [
            ["Source of funds", "Sale of prior investment property, Mar 2026",
             "Settlement statement, bank statement", "Consistent and corroborated"],
            ["Source of wealth", "Salaried employment and property investment since 2009",
             "Two years tax returns, ASIC extract", "Consistent with profile"],
        ], ["{{element}}", "{{declared}}", "{{evidence}}", "{{assessment}}"], count=2),
        widths=[32, 56, 50, 42], caption="Source of funds and wealth")
    page_break(doc)

    C.section_opener(doc, theme, "4", "Risk rating", "Rating and its basis")
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("CUSTOMER", f("riskRating.customer", "MEDIUM"), "PEP association"),
        ("PRODUCT", f("riskRating.product", "LOW"), "Standard advisory"),
        ("CHANNEL", f("riskRating.channel", "LOW"), "Face to face"),
        ("OVERALL", f("riskRating.overall", "MEDIUM"), "Highest applies"),
    ])
    C.gap(doc, theme, 0.7)
    C.status_table(
        doc, theme, headers=["Ref", "Risk factor", "Assessment", "Weighting", "Rating"],
        rows=f.tuples("riskFactors", [
            (["4.1", "Customer type — proprietary company", "Standard structure, two owners",
              "Standard", "Low"], "low"),
            (["4.2", "Politically exposed person", "Domestic PEP, local government",
              "Elevated", "Medium"], "medium"),
            (["4.3", "Geography", "Australian resident, Australian assets", "Standard",
              "Low"], "low"),
            (["4.4", "Product and channel", "Advisory service, face to face", "Standard",
              "Low"], "low"),
            (["4.5", "Transaction pattern", "Consistent with declared profile", "Standard",
              "Low"], "low"),
        ], (["{{ref}}", "{{factor}}", "{{assessment}}", "{{weighting}}", "Medium"],
            "medium"), count=5),
        widths=[16, 56, 60, 28, 26], caption="Risk factors")
    C.gap(doc, theme, 0.7)
    C.status_table(
        doc, theme, headers=["Ref", "Enhanced measure", "Applied", "Evidence", "Status"],
        rows=f.tuples("edd", [
            (["5.1", "Senior management approval before onboarding", "Yes",
              "Approval recorded below", "Complete"], "complete"),
            (["5.2", "Source of wealth established and evidenced", "Yes",
              "Tax returns, ASIC extract", "Complete"], "complete"),
            (["5.3", "Enhanced ongoing monitoring — 12-month review", "Yes",
              "Review scheduled 29/07/2027", "Complete"], "complete"),
        ], (["{{ref}}", "{{measure}}", "{{applied}}", "{{evidence}}", "Pending"],
            "pending"), count=3),
        widths=[16, 66, 22, 56, 26],
        caption="Enhanced due diligence (applied because the rating is medium or above)")
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Ongoing monitoring", columns=2, fields=[
        ("Review frequency", f("monitoring.frequency", "12 months (enhanced)")),
        ("Next review", f("monitoring.nextReview", "29/07/2027")),
        ("Trigger events", f("monitoring.triggers",
                             "Change of ownership, adverse media, unusual transaction")),
        ("Monitoring owner", f("monitoring.owner", "Compliance officer")),
    ])
    page_break(doc)

    C.approval_block(doc, theme, f.tuples("approvals", [
        ("Assessor", f("approvals.assessor", "A. Nguyen, Client Services"), "Complete"),
        ("Compliance officer", f("approvals.compliance", "R. Patel, Compliance"), "Complete"),
        ("Senior management (PEP)", f("approvals.senior", "M. Osei, Director"), "Complete"),
    ], ("{{role}}", "{{name}}", "Pending"), count=3))
    C.appendix_opener(doc, theme, "A", "Evidence index",
                      "Every document held for this assessment, with its storage reference "
                      "and retention date.")
    C.gap(doc, theme, 0.6)
    C.data_table(
        doc, theme, ["Ref", "Document", "Obtained", "Storage reference", "Retain until"],
        f.rows("appendix.evidence", [
            ["1.1", "Australian passport — J. Nguyen", "29/07/2026", "DOC-88412", "29/07/2033"],
            ["1.3", "Australian passport — S. Nguyen", "29/07/2026", "DOC-88413", "29/07/2033"],
            ["1.4", "ASIC company extract", "29/07/2026", "DOC-88414", "29/07/2033"],
            ["3.1", "Screening report", "29/07/2026", "DOC-88415", "29/07/2033"],
            ["4.2", "Source of wealth pack", "30/07/2026", "DOC-88416", "29/07/2033"],
        ], ["{{ref}}", "{{document}}", "{{obtained}}", "{{storageRef}}", "{{retainUntil}}"],
            count=5),
        widths=[16, 68, 28, 40, 30])
    C.disclaimer_page(doc, theme, extra_sections=[
        ("Retention",
         "This assessment and its supporting evidence are retained for seven years from "
         "the end of the customer relationship, in accordance with the organisation's "
         "AML/CTF programme."),
        ("Tipping off",
         "This document may contain information the disclosure of which to the customer "
         "or a third party could constitute an offence. Do not disclose the contents "
         "outside the authorised recipients without compliance approval."),
    ])


# ==========================================================================
# Executive Business Report — Executive Corporate
# ==========================================================================

def executive_business_report(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="For decision",
        title=f("report.title", "Executive Business Report"),
        subtitle=f("report.subtitle",
                   "Performance for the period, the options considered and the "
                   "recommended course of action."),
        chips=["FOR DECISION", "CONFIDENTIAL"])
    page_break(doc)

    C.table_of_contents(doc, theme, [
        ("01", "Executive summary"), ("02", "Performance"), ("03", "Key findings"),
        ("04", "Options considered"), ("05", "Recommendation"),
        ("06", "Risks"), ("07", "Decisions required"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "01", "Executive summary", "For readers of one page only")
    C.gap(doc, theme)
    C.executive_summary(
        doc, theme,
        headline=f("report.headline",
                   "Revenue is 8% ahead of plan on 12% fewer engagements — the mix has "
                   "shifted and the operating model has not."),
        paragraphs=f.text("report.executiveSummary", [
            "The period closed at $4.28m against a plan of $3.96m, a favourable variance "
            "of 8.1%. That result was produced by 214 engagements against a plan of 243, "
            "so average engagement value rose from $16,300 to $20,000.",
            "The shift is concentrated in two service lines. Advisory and compliance work "
            "grew 34% and 41% respectively, while transactional work fell 19%. The "
            "operating model, resourcing plan and pricing structure were all built for "
            "the previous mix.",
            "Three options are set out in section four. The recommendation is to "
            "re-weight delivery capacity toward advisory and compliance over two "
            "quarters, funded from the transactional team's existing headcount rather "
            "than net new hiring.",
        ]),
        takeaways=f.items("report.takeaways", [
            "Revenue ahead of plan; engagement volume behind it.",
            "Average engagement value up 23% — this is a mix shift, not a pricing win.",
            "Advisory and compliance capacity is the binding constraint by Q3.",
            "Recommended option requires no net new headcount.",
        ]))
    C.gap(doc, theme)
    C.metric_panel(doc, theme, [
        ("REVENUE", f("performance.revenue", "$4.28m"), "▲ 8.1% vs plan"),
        ("ENGAGEMENTS", f("performance.engagements", "214"), "▼ 11.9% vs plan"),
        ("AVERAGE VALUE", f("performance.averageValue", "$20,000"), "▲ 22.7%"),
        ("UTILISATION", f("performance.utilisation", "81%"), "▲ 6 pts"),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "02", "Performance", "Against plan and prior period")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Measure", "Plan", "Actual", "Variance", "Prior period", "Movement"],
        f.rows("performance.detail", [
            ["Revenue", "$3,960,000", "$4,280,000", "+8.1%", "$3,742,000", "+14.4%"],
            ["Engagements", "243", "214", "−11.9%", "229", "−6.6%"],
            ["Average engagement value", "$16,300", "$20,000", "+22.7%", "$16,340", "+22.4%"],
            ["Advisory revenue", "$1,180,000", "$1,581,000", "+34.0%", "$1,180,000", "+34.0%"],
            ["Compliance revenue", "$742,000", "$1,046,000", "+41.0%", "$742,000", "+41.0%"],
            ["Transactional revenue", "$2,038,000", "$1,653,000", "−18.9%", "$1,820,000", "−9.2%"],
            ["Utilisation", "75%", "81%", "+6 pts", "76%", "+5 pts"],
        ], ["{{measure}}", "{{plan}}", "{{actual}}", "{{variance}}", "{{prior}}",
            "{{movement}}"], count=6),
        widths=[52, 30, 30, 26, 30, 28], numeric_cols={1, 2, 3, 4, 5},
        emphasis_rows={3, 4, 5}, caption="Results against plan")
    C.gap(doc, theme, 0.7)
    C.chart_frame(doc, theme, title="Revenue by service line, four periods",
                  kind="stacked column chart", binding="{{performance.series}}",
                  height_mm=56, caption="Mix shift is visible from period two",
                  source="Finance system", alt_text="Advisory and compliance grow while "
                                                    "transactional revenue declines")
    page_break(doc)

    C.section_opener(doc, theme, "03", "Key findings", "What the numbers show")
    C.gap(doc, theme)
    for title, text in f.tuples("findings", [
        ("Finding 1 — The mix shift is structural, not seasonal",
         "Advisory and compliance growth has been positive in each of the last four "
         "periods, and the transactional decline tracks a market-wide fall in volumes "
         "rather than a loss of share. Share in transactional work is unchanged at 4.1%."),
        ("Finding 2 — Delivery capacity is the binding constraint",
         "Advisory utilisation reached 94% in the final month of the period, against a "
         "sustainable ceiling of 85%. Four engagements were declined for capacity reasons. "
         "On current trajectory the constraint binds in Q3."),
        ("Finding 3 — Pricing has not moved",
         "The rise in average engagement value is entirely mix. Like-for-like advisory "
         "pricing is unchanged for seven quarters against 11% cumulative cost inflation."),
    ], ("{{finding.title}}", "{{finding.text}}"), count=3):
        C.highlight_box(doc, theme, tone="info", title=title, text=text)
        C.gap(doc, theme, 0.5)
    page_break(doc)

    C.section_opener(doc, theme, "04", "Options considered", "Three, assessed equally")
    C.gap(doc, theme)
    C.comparison_table(
        doc, theme,
        subject_labels=["A — Hold", "B — Re-weight", "C — Expand"],
        attributes=[
            ("Description", ["Change nothing this year",
                             "Move capacity from transactional to advisory",
                             "Hire into advisory and compliance"]),
            ("Net new headcount", ["0", "0", "6"]),
            ("Cost in period", ["$0", "$84,000", "$690,000"]),
            ("Revenue impact, 12 months", ["−$310,000", "+$540,000", "+$980,000"]),
            ("Time to effect", ["—", "2 quarters", "3 quarters"]),
            ("Key risk", ["Declines engagements at capacity",
                          "Retraining lag in Q1",
                          "Fixed cost added ahead of demand"]),
            ("Reversibility", ["n/a", "High", "Low"]),
        ],
        caption="Options assessed", winner_index=1)
    C.gap(doc, theme)
    C.recommendation_box(
        doc, theme,
        recommendation=f("report.recommendation",
                         "Adopt Option B — re-weight delivery capacity toward advisory and "
                         "compliance over two quarters, funded from existing transactional "
                         "headcount."),
        rationale=f.text("report.rationale", [
            "Option B captures most of the available upside at a twelfth of the cost of "
            "Option C, requires no net new headcount, and is reversible within a quarter "
            "if the mix shift proves temporary. Option A forgoes $310,000 and continues to "
            "decline work we are capable of delivering.",
        ]),
        actions=f.items("report.nextSteps", [
            "Approve the $84,000 retraining and accreditation budget.",
            "Approve the transfer of four delivery staff from transactional to advisory.",
            "Approve a like-for-like pricing review for advisory, reporting in Q2.",
        ]),
        confidence=f("report.confidence", "High"))
    page_break(doc)

    C.section_opener(doc, theme, "05", "Risks", "And how they are managed")
    C.gap(doc, theme)
    C.risk_box(doc, theme, risks=f.tuples("risks", [
        ("Retraining lag reduces delivery capacity in Q1",
         "Medium", "Stagger the transfer across two cohorts so no more than two staff are "
                   "out of production at once."),
        ("Transactional volumes recover and capacity is in the wrong place",
         "Medium", "Option B is reversible within a quarter; monitor transactional "
                   "enquiry volume monthly and set a re-weight trigger at +15%."),
        ("Advisory demand is concentrated in two clients",
         "High", "Both clients represent 31% of advisory revenue. Business development "
                 "target of four new advisory clients by Q3 is added to the plan."),
    ], ("{{risk.description}}", "Medium", "{{risk.mitigation}}"), count=3))
    C.gap(doc, theme)
    C.timeline(doc, theme, f.tuples("implementation", [
        ("Q1 W1–4", "Approve budget and transfers", "Board approval, staff consultation"),
        ("Q1 W5–12", "Cohort 1 retraining", "Two staff, accreditation complete"),
        ("Q2 W1–8", "Cohort 2 retraining", "Two staff, accreditation complete"),
        ("Q2 W9", "Pricing review reported", "Like-for-like advisory pricing"),
        ("Q3 W1", "Capacity re-weighted", "Advisory utilisation target 85%"),
    ], ("{{when}}", "{{what}}", "{{detail}}"), count=4), caption="Implementation")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("decisions", [
        "Approve Option B as the recommended course of action.",
        "Approve the $84,000 retraining and accreditation budget.",
        "Approve the transfer of four delivery staff.",
        "Note the advisory client concentration risk and the mitigation target.",
    ]), title="Decisions required", columns=1)
