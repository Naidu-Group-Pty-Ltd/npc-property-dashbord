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


# ==========================================================================
# Client Onboarding Form — Minimal Professional
# ==========================================================================

def client_onboarding_form(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Engagement",
        title=f("form.title", "Client Onboarding"),
        subtitle=f("form.subtitle",
                   "The scope of our engagement, what it costs, what you authorise us to "
                   "do, and the consents we need."),
        prepared_for=False)
    C.gap(doc, theme, 0.6)
    C.definition_grid(doc, theme, [
        ("Engagement reference", f("engagement.reference", "{{engagement.reference}}")),
        ("Date", f("document.issueDate", "{{document.issueDate}}")),
        ("Adviser", f("author.name", "{{author.name}}")),
        ("Start date", f("engagement.startDate", "{{engagement.startDate}}")),
    ])
    C.gap(doc, theme, 0.7)
    C.prose(doc, theme, f.text("engagement.welcome", [
        "Thank you for engaging us. This form records what we have agreed: the work we "
        "will do, the work we will not do, what it costs, and what you are authorising. "
        "Please read it, complete the fields, and sign at the end. Ask us about anything "
        "that is unclear before you sign — that is a better use of your time than "
        "discovering it later.",
    ]))
    page_break(doc)

    C.section_opener(doc, theme, "1", "Your details", "Who we are acting for")
    C.gap(doc, theme)
    C.definition_grid(doc, theme, [
        ("Client name(s)", BLANK), ("Preferred name", BLANK),
        ("Entity name (if applicable)", BLANK), ("ABN / ACN", BLANK),
        ("Postal address", BLANK), ("Email", BLANK),
        ("Mobile", BLANK), ("Best contact time", BLANK),
    ], columns=2, input_style=True)
    C.gap(doc, theme)

    C.section_opener(doc, theme, "2", "Engagement scope", "What is and is not included")
    C.gap(doc, theme)
    C.responsibility_columns(
        doc, theme,
        ("Included in this engagement", f.items("engagement.included", [
            "Property strategy and brief development.",
            "Search, shortlisting and inspection across the agreed area.",
            "Comparable sales research and price assessment.",
            "Due diligence coordination and reporting.",
            "Negotiation and offer management to exchange.",
            "Settlement coordination with your conveyancer.",
        ], count=5)),
        ("Not included", f.items("engagement.excluded", [
            "Credit assistance, loan advice or lender recommendations.",
            "Legal advice on the contract of sale.",
            "Structural engineering, survey or valuation services.",
            "Tax or financial product advice.",
            "Property management after settlement.",
        ], count=5)),
        tones=("success", "alert"))
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="info", title="Where you will need another professional",
        text=f("engagement.referrals",
               "We will tell you when something falls outside our scope and, where you "
               "ask us to, introduce you to a suitably qualified professional. Any "
               "referral benefit we receive will be disclosed to you before the "
               "introduction is made."))
    page_break(doc)

    C.section_opener(doc, theme, "3", "Fees", "What this costs and when")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Fee", "Basis", "Amount", "When payable"],
        f.rows("fees", [
            ["Engagement fee", "Fixed", BLANK, "On signing this form"],
            ["Success fee", "Percentage of purchase price", BLANK, "On exchange"],
            ["Disbursements", "At cost", BLANK, "As incurred, with receipts"],
        ], ["{{fee}}", "{{basis}}", "{{amount}}", "{{when}}"], count=3),
        widths=[46, 52, 34, 46], caption="Fee schedule",
        note="All amounts are inclusive of GST unless stated otherwise. We will not "
             "incur a disbursement above $250 without your prior approval.")
    C.gap(doc, theme, 0.7)
    C.definition_grid(doc, theme, [
        ("Refund position", f("fees.refund",
                              "Engagement fee is non-refundable after 14 days")),
        ("Payment method", BLANK),
        ("Invoice email", BLANK),
        ("Purchase-order reference", BLANK),
    ], columns=2, input_style=True)
    C.gap(doc, theme)

    C.section_opener(doc, theme, "4", "Authorities", "What you authorise us to do")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("authorities", [
        "Make enquiries of selling agents on my behalf.",
        "Inspect properties on my behalf and report to me.",
        "Request contracts of sale and supporting documents.",
        "Negotiate on my behalf within limits I set in writing.",
        "Submit offers on my behalf within limits I set in writing.",
        "Liaise with my conveyancer, broker and other advisers.",
    ], count=6), title="I authorise you to", columns=1)
    C.gap(doc, theme, 0.6)
    C.highlight_box(
        doc, theme, tone="warning", title="Limits on authority",
        text=f("authorities.limits",
               "We will not sign anything on your behalf, will not exceed a price limit "
               "you have not confirmed in writing, and will not commit you to any "
               "contract. Every offer requires your written authority for that specific "
               "property at that specific price."))
    page_break(doc)

    C.section_opener(doc, theme, "5", "Communication preferences", "How and how often")
    C.gap(doc, theme)
    C.definition_grid(doc, theme, [
        ("Preferred channel", BLANK), ("Update frequency", BLANK),
        ("Secondary contact name", BLANK), ("Secondary contact details", BLANK),
        ("May we contact your broker?", BLANK), ("May we contact your conveyancer?", BLANK),
    ], columns=2, input_style=True)
    C.gap(doc, theme)

    C.section_opener(doc, theme, "6", "Consents", "Each one separately")
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("consents", [
        "I consent to the collection and use of my personal information as described in "
        "the privacy notice at the end of this form.",
        "I consent to my information being shared with the third parties I have "
        "authorised above, for the purposes of this engagement only.",
        "I consent to receiving service-related communications by email and SMS.",
        "I consent to receiving marketing communications. (Optional — you may decline "
        "this and still engage us.)",
    ], count=4), title="Consents", columns=1)
    C.gap(doc, theme, 0.6)
    C.highlight_box(
        doc, theme, tone="info", title="These are separate on purpose",
        text="Each consent above is a separate decision and each is separately "
             "revocable. Declining the marketing consent has no effect on the engagement "
             "or on the service you receive.")
    C.gap(doc, theme)

    C.section_opener(doc, theme, "7", "What happens next", "The first three steps")
    C.gap(doc, theme)
    C.process_flow(doc, theme, f.tuples("engagement.nextSteps", [
        ("Brief", "We meet to develop your property brief and agree the search mandate."),
        ("Search", "We begin searching and report on shortlisted properties."),
        ("Act", "We inspect, assess, negotiate and manage the acquisition to settlement."),
    ], ("{{step.name}}", "{{step.detail}}"), count=3))
    C.gap(doc, theme)
    C.signature_block(doc, theme, [
        ("Client", ["Full name:", "Signature:", "Date:  ____ / ____ / ______"]),
        ("For the organisation", [f"Name: {f('author.name', '{{author.name}}')}",
                                  "Signature:", "Date:  ____ / ____ / ______"]),
    ])
    C.disclaimer_page(doc, theme, extra_sections=[
        ("Terms of engagement",
         "This engagement continues until the agreed work is complete or either party "
         "ends it by written notice. Fees accrued before the end date remain payable. "
         "Nothing in this form limits any right you have under the Australian Consumer "
         "Law."),
    ])


# ==========================================================================
# Client Verification Summary — Compliance Structured
# ==========================================================================

def client_verification_summary(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Verification record — internal",
        title=f("report.title", "Client Verification Summary"),
        subtitle=f("report.subtitle",
                   "Confirmation that identity verification was completed, by what "
                   "method, on what date, with what result."),
        chips=["INTERNAL", "RETAINED"],
        prepared_for=False)
    C.gap(doc, theme, 0.7)
    C.definition_grid(doc, theme, [
        ("Customer", f("customer.legalName", "{{customer.legalName}}")),
        ("Case reference", f("case.reference", "{{case.reference}}")),
        ("Verified on", f("verification.date", "{{verification.date}}")),
        ("Verified by", f("verification.verifier", "{{verification.verifier}}")),
    ])
    C.gap(doc, theme, 0.8)

    C.metric_panel(doc, theme, [
        ("STATUS", f("verification.status", "VERIFIED"), "All checks complete"),
        ("METHOD", f("verification.method", "Electronic + visual"), "Primary documents"),
        ("COMPLETED", f("verification.date", "29/07/2026"), "Assessment date"),
        ("RE-VERIFY BY", f("verification.expiry", "29/07/2029"), "Or on trigger event"),
    ])
    C.gap(doc, theme)

    C.section_opener(doc, theme, "1", "Customer", "Verified particulars")
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Verified identity", columns=2, fields=[
        ("Full legal name", f("customer.legalName", "Jordan Lee Nguyen")),
        ("Date of birth", f("customer.dob", "12/04/1988")),
        ("Residential address", f("customer.address",
                                  "12 Example Street, Northbridge NSW 2063")),
        ("Customer type", f("customer.type", "Individual")),
        ("Relationship", f("customer.relationship", "Investor client")),
        ("Onboarded", f("customer.onboardedAt", "29/07/2026")),
    ])
    C.gap(doc, theme)

    C.section_opener(doc, theme, "2", "Documents verified", "Primary evidence")
    C.gap(doc, theme)
    C.status_table(
        doc, theme,
        headers=["Ref", "Document", "Number", "Issuer", "Expiry", "Method", "Status"],
        rows=f.tuples("identity.documents", [
            (["2.1", "Australian passport", "PA1234567", "DFAT", "04/2031",
              "Electronic + visual", "Pass"], "pass"),
            (["2.2", "Driver licence (NSW)", "12345678", "TfNSW", "09/2029",
              "Electronic", "Pass"], "pass"),
            (["2.3", "Medicare card", "2345 67890 1", "Services Australia", "08/2028",
              "Visual", "Pass"], "pass"),
        ], (["{{ref}}", "{{document}}", "{{number}}", "{{issuer}}", "{{expiry}}",
             "{{method}}", "Pending"], "pending"), count=3),
        widths=[16, 44, 32, 38, 24, 40, 26], caption="Documents sighted and verified")
    C.gap(doc, theme)

    C.section_opener(doc, theme, "3", "Screening", "PEP, sanctions and adverse media")
    C.gap(doc, theme)
    C.status_table(
        doc, theme, headers=["Ref", "Check", "Provider", "Date", "Result", "Status"],
        rows=f.tuples("screening", [
            (["3.1", "Sanctions", "Screening provider", "29/07/2026", "No match",
              "Clear"], "clear"),
            (["3.2", "PEP", "Screening provider", "29/07/2026", "No match", "Clear"], "clear"),
            (["3.3", "Adverse media", "Screening provider", "29/07/2026", "No match",
              "Clear"], "clear"),
        ], (["{{ref}}", "{{check}}", "{{provider}}", "{{date}}", "{{result}}", "Pending"],
            "pending"), count=3),
        widths=[16, 42, 44, 28, 50, 26], caption="Screening result")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="warning", title="Verifier declaration",
        text=f("verification.declaration",
               "I confirm that I sighted the documents listed above in the manner "
               "recorded, that the person presenting them appeared to be the person to "
               "whom they relate, that the screening checks were performed on the dates "
               "shown, and that copies of all documents and screening reports have been "
               "retained in the customer file."))
    C.gap(doc, theme, 0.7)
    C.approval_block(doc, theme, f.tuples("approvals", [
        ("Verifier", f("verification.verifier", "A. Nguyen, Client Services"), "Complete"),
        ("Reviewer", f("verification.reviewer", "R. Patel, Compliance"), "Complete"),
    ], ("{{role}}", "{{name}}", "Pending"), count=2))
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="alert", title="Circulation",
        text="This summary is an internal record. It may be provided to a third party "
             "only where the organisation's policy permits and the customer has "
             "consented. The full due-diligence file is not to be circulated.")


# ==========================================================================
# Client Proposal — Luxury Presentation
# ==========================================================================

def client_proposal(doc, theme: Theme, f: Fill) -> None:
    C.cover(
        doc, theme,
        eyebrow_text="Proposal",
        title=f("proposal.title", "A Proposal to Acquire"),
        subtitle=f("proposal.subtitle",
                   f"Prepared for {theme.brand.client_name} — our understanding of your "
                   "position, what we propose to do, and what it will cost."),
        image_caption=f("proposal.coverCaption", ""),
        prepared_for=False)
    C.gap(doc, theme, 0.8)
    C.definition_grid(doc, theme, [
        ("Prepared for", f("client.name", "{{client.name}}")),
        ("Prepared by", f("author.name", "{{author.name}}")),
        ("Date", f("document.issueDate", "{{document.issueDate}}")),
        ("Valid until", f("proposal.validity", "{{proposal.validity}}")),
    ])
    page_break(doc)

    C.section_opener(doc, theme, "", "Your situation", "")
    C.gap(doc, theme)
    C.prose(doc, theme, f.text("proposal.situation", [
        "You are looking to add a third investment property to a portfolio you have "
        "built over eleven years, and you have told us the last acquisition took "
        "fourteen months and did not, in the end, meet the brief you set for it.",
        "The constraint is not capital and it is not appetite. It is time, and access. "
        "You have neither the hours to inspect forty properties nor the standing "
        "relationships that surface the ones that never reach a portal.",
        "That is a specific problem, and it is the one we are proposing to solve.",
    ]), size=theme.type_scale.body + 0.5)
    C.gap(doc, theme)
    C.recommendation_box(
        doc, theme, title="What we propose",
        recommendation=f("proposal.approach",
                         "A six-month retained search across three target corridors, "
                         "with a written brief agreed up front and a weekly report, "
                         "concluding at unconditional exchange."),
        rationale=f.text("proposal.approachRationale", [
            "Retained rather than success-only, because a success-only mandate rewards "
            "transacting rather than transacting well, and you have already had one "
            "acquisition that met the deadline and missed the brief.",
        ]),
        confidence="")
    page_break(doc)

    C.section_opener(doc, theme, "", "Scope of work", "")
    C.gap(doc, theme)
    C.process_flow(doc, theme, f.tuples("scope.phases", [
        ("Brief", "Two sessions to agree the mandate, the scoring criteria and the "
                  "walk-away conditions, in writing."),
        ("Search", "Weekly search across three corridors, on and off market, with a "
                   "written shortlist report every Friday."),
        ("Assess", "Full investment analysis and due-diligence coordination on every "
                   "property that reaches the shortlist."),
        ("Negotiate", "Offer strategy, negotiation and management to exchange."),
        ("Settle", "Coordination with your conveyancer and broker to settlement, and a "
                   "post-purchase plan."),
    ], ("{{phase.name}}", "{{phase.detail}}"), count=5))
    C.gap(doc, theme)
    C.checklist(doc, theme, f.items("deliverables", [
        "A written property brief, agreed and signed.",
        "A weekly shortlist report for the duration of the search.",
        "A full investment report on every shortlisted property.",
        "A due-diligence report before any offer is made.",
        "A written negotiation strategy for each offer.",
        "A post-purchase plan within 14 days of settlement.",
    ], count=6), title="What you receive", columns=1)
    page_break(doc)

    C.section_opener(doc, theme, "", "Your team", "")
    C.gap(doc, theme)
    C.adviser_profile(doc, theme,
                      bio=f("team.0.bio",
                            "Leads the engagement. Eighteen years in buyer advocacy "
                            "across the lower north shore, with a particular focus on "
                            "established stock and off-market acquisition."),
                      credentials=f.items("team.0.credentials", [
                          "Licensed real estate agent (NSW)",
                          "Member, Real Estate Buyers Agents Association",
                          "310 acquisitions completed",
                      ], count=3))
    C.gap(doc, theme, 0.6)
    C.adviser_profile(doc, theme,
                      bio=f("team.1.bio",
                            "Runs research and due diligence. Prepares the analysis "
                            "behind every shortlist and coordinates the investigation "
                            "on every property that reaches an offer."),
                      credentials=f.items("team.1.credentials", [
                          "Certified Practising Valuer",
                          "Nine years in property research",
                      ], count=2))
    C.gap(doc, theme)
    C.timeline(doc, theme, f.tuples("timeline", [
        ("Week 1", "Engagement and brief", "Two sessions; written brief agreed"),
        ("Weeks 2–24", "Search and shortlist", "Weekly reporting"),
        ("On shortlist", "Analysis and due diligence", "Per property"),
        ("On agreement", "Negotiate and exchange", "Offer strategy agreed in writing"),
        ("Post exchange", "Settlement and plan", "To settlement plus 14 days"),
    ], ("{{when}}", "{{what}}", "{{detail}}"), count=5), caption="Indicative timeline")
    page_break(doc)

    C.section_opener(doc, theme, "", "Investment", "")
    C.gap(doc, theme)
    C.data_table(
        doc, theme, ["Item", "Basis", "Amount", "When payable"],
        f.rows("fees", [
            ["Retainer", "Fixed, six months", "$8,800", "On engagement"],
            ["Success fee", "1.65% of purchase price", "Est. $14,270", "On exchange"],
            ["Disbursements", "At cost, pre-approved above $250", "Est. $1,400",
             "As incurred"],
        ], ["{{item}}", "{{basis}}", "{{amount}}", "{{when}}"], count=3),
        widths=[44, 62, 34, 38], numeric_cols={2},
        total_row=["Estimated total", "On an $865,000 acquisition", "$24,470", ""],
        caption="Fees",
        note="All amounts include GST. The retainer is credited against the success fee, "
             "so the total does not change if we find the property in week three.")
    C.gap(doc, theme)
    C.highlight_box(
        doc, theme, tone="info", title="Why us",
        text=f("proposal.whyUs", ""),
        items=f.items("proposal.evidence", [
            "310 acquisitions completed; 41% sourced off market.",
            "Median time from brief to exchange, last 24 months: 11 weeks.",
            "Average purchase price against our own pre-offer assessment: 2.1% below.",
            "Client references available on request, including three in your corridor.",
        ], count=4))
    C.gap(doc, theme)
    C.info_card(doc, theme, title="Case study", columns=1, fields=[
        ("Brief", f("caseStudy.brief",
                    "Investment house, 500m²+, within 12km, yield above 4.2%")),
        ("Constraint", f("caseStudy.constraint",
                         "Client had searched for nine months without success")),
        ("What we did", f("caseStudy.action",
                          "Narrowed to two corridors; sourced off market in week seven")),
        ("Outcome", f("caseStudy.outcome",
                      "Exchanged 3.4% below the vendor's guide; 4.7% gross yield")),
    ])
    C.gap(doc, theme)
    C.process_flow(doc, theme, f.tuples("nextSteps", [
        ("Accept", "Sign below and return, or tell us what you would like changed."),
        ("Brief", "We book the two briefing sessions within five business days."),
        ("Begin", "The search starts the week the brief is signed."),
    ], ("{{step.name}}", "{{step.detail}}"), count=3))
    C.gap(doc, theme)
    C.signature_block(doc, theme, [
        ("Accepted by the client", ["Full name:", "Signature:",
                                    "Date:  ____ / ____ / ______"]),
        ("For the organisation", [f"Name: {f('author.name', '{{author.name}}')}",
                                  "Signature:", "Date:  ____ / ____ / ______"]),
    ])
    C.disclaimer_page(doc, theme, extra_sections=[
        ("Validity",
         "This proposal is valid for 30 days from the date on the cover. Fees quoted are "
         "estimates where they depend on a purchase price that is not yet known; the "
         "basis of calculation is fixed and is stated in the fee table."),
    ])
    C.back_cover(doc, theme)
