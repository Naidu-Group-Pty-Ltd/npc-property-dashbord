#!/usr/bin/env python3
"""Build the Finance Referral & Commission Agreement (buyer's agency -> finance partner).

Content is carried over from the source template; this script supplies the
structure, brand system and page layout. Run via ``build_all.py``.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from aurixa_brand import DEFAULT_BRAND, INSERT, LAYOUT, PALETTE, TYPE, BrandProfile, token
from docx_kit import (
    BULLET,
    CHECKBOX,
    Field,
    base_document,
    brand_slots_page,
    card,
    cell_borders,
    cell_margins,
    clause_block,
    clear,
    cover_panel,
    data_table,
    document_map,
    field_grid,
    guidance_card,
    new_table,
    note_card,
    page_break,
    para,
    responsibility_columns,
    section_band,
    set_core_properties,
    shade,
    signature_panel,
    spacer,
    write,
)

DOC_TITLE = "Finance Referral & Commission Agreement"

EXECUTION_LINES = [
    f"Legal entity: {INSERT}",
    f"Name of signatory: {INSERT}",
    f"Title / capacity: {INSERT}",
    "Signature:",
    "Date:  ____ / ____ / ______",
    "Witness (if required):",
]

COMPANY_EXECUTION = [
    ("Director / sole director", [f"Name and signature: {INSERT}", "Signature:",
                                  "Date:  ____ / ____ / ______"]),
    ("Director / company secretary", [f"Name and signature: {token('INSERT OR N/A')}",
                                      "Signature:", "Date:  ____ / ____ / ______"]),
]


def email_panel(doc, brand: BrandProfile) -> None:
    """Two-column partner email template: draft copy + activation checklist."""
    body_w = LAYOUT.content_width_mm * 0.63
    side_w = LAYOUT.content_width_mm - body_w
    table = new_table(doc, 1, 2, [body_w, side_w])

    body = clear(table.rows[0].cells[0])
    shade(body, PALETTE.paper_warm)
    cell_margins(body, 170, 200, 170, 200)
    cell_borders(body, top=(4, PALETTE.line), left=(18, brand.accent),
                 bottom=(4, PALETTE.line), right=(4, PALETTE.line))

    p = para(body, "SUBJECT   ", size=TYPE.micro, bold=True, caps=True, tracking=1.3,
             colour=PALETTE.gold_dark, before=0, after=7)
    write(p, f"Finance Referral Partnership — {token('FINANCE PARTNER NAME')} and "
             f"{token('BUYER’S AGENCY NAME')}",
          size=TYPE.body_small, bold=True, colour=PALETTE.ink)

    paragraphs = [
        f"Hi {token('FIRST NAME')},",
        f"Thank you for discussing a referral arrangement under which "
        f"{token('BUYER’S AGENCY NAME')} may introduce clients to "
        f"{token('FINANCE PARTNER NAME')} for potential credit services.",
        "Attached is the editable Finance Referral & Commission Agreement, together "
        "with the supporting Loan Writer Undertaking, Referrer Entity & Payment "
        "Details Form and Client Referral & Consent Form.",
        "The commercial schedule contains open fields for the agreed upfront commission "
        "share, trail commission share, payment cycle, GST process, clawback treatment "
        "and treatment of refinances or subsequent loans. No percentage or payment date "
        "is pre-set.",
        "Before execution, the agreement should be reviewed and approved by the finance "
        "partner's legal, compliance, ACL-holder and aggregator teams, together with "
        "the buyer's agency's own advisers.",
        "Kind regards,",
    ]
    for index, text in enumerate(paragraphs):
        para(body, text, size=TYPE.body_small, colour=PALETTE.ink,
             before=0 if index == 0 else 6, after=0, line=1.32)

    para(body, token("SENDER NAME"), size=TYPE.body_small, bold=True,
         colour=PALETTE.ink, before=8, after=0)
    para(body, token("TITLE"), size=TYPE.body_small, colour=PALETTE.ink_soft,
         before=1, after=0)
    para(body, brand.company_name, size=TYPE.body_small, bold=True,
         colour=PALETTE.gold_dark, before=1, after=0)
    para(body, f"{brand.phone}   |   {brand.email}   |   {brand.website}",
         size=TYPE.micro, colour=PALETTE.ink_soft, before=3, after=0)

    side = clear(table.rows[0].cells[1])
    shade(side, brand.primary)
    cell_margins(side, 170, 190, 170, 190)
    cell_borders(side, top=(4, brand.primary), left=(4, brand.primary),
                 bottom=(4, brand.primary), right=(4, brand.primary))
    para(side, "ACTIVATION CHECKLIST", size=TYPE.label, bold=True, caps=True,
         tracking=1.3, colour=brand.accent, before=0, after=6)
    for step in [
        "Replace every merge token",
        "Agree commission percentages",
        "Confirm clawback treatment",
        "Obtain ACL / aggregator approval",
        "Verify banking details by phone",
        "Issue for electronic execution",
    ]:
        p = para(side, "", before=0, after=4, line=1.2, left_indent=11, hanging=11)
        write(p, f"{CHECKBOX}  ", size=TYPE.body_small, colour=brand.accent)
        write(p, step, size=TYPE.body_small, colour="E4DBCC")

    para(side, "ATTACHMENTS", size=TYPE.label, bold=True, caps=True, tracking=1.3,
         colour=brand.accent, before=12, after=6)
    for item in [
        "Finance Referral & Commission Agreement",
        "Loan Writer Undertaking",
        "Referrer Entity & Payment Details Form",
        "Client Referral & Consent Form",
    ]:
        p = para(side, "", before=0, after=4, line=1.2, left_indent=11, hanging=11)
        write(p, f"{BULLET}  ", size=TYPE.body_small, bold=True, colour=brand.accent)
        write(p, item, size=TYPE.body_small, colour="E4DBCC")


def build(brand: BrandProfile, output: Path) -> Path:
    doc = base_document(brand, DOC_TITLE)

    # ---------------------------------------------------------------- cover
    cover_panel(
        doc, brand,
        eyebrow="Buyer's agency referral to finance partner",
        title_lines=["Finance Referral &", "Commission Agreement"],
        summary=(
            "A structured, editable agreement template for establishing a professional "
            "referral relationship while preserving clear service boundaries, client "
            "choice and transparent commercial terms."
        ),
        chips=["EDITABLE", "ACTIVATION-READY", "BRAND-READY"],
        reference="FRCA-" + token("REF"),
    )

    page_break(doc)

    # ---------------------------------------------------------- document map
    document_map(doc, brand, [
        ("E", "Partner email template", "Editable introductory correspondence to accompany the pack."),
        ("W", "Brand & customisation panel", "Every white-label field in one place."),
        ("1", "Agreement details", "Entity, licence and commission-administration information."),
        ("2", "Purpose & professional boundaries", "What the referrer may and must not do."),
        ("2A", "Purpose & finance partner services", "Operative clauses 1–2: referral authority and regulated services."),
        ("3", "Referral requirements", "Operative clauses 3–4: consent, permitted information, handling."),
        ("4", "Commission & payment schedule", "Negotiated percentages and payment mechanics."),
        ("5–7", "Administration, clawbacks & tax", "Statements, adjustments and GST controls."),
        ("8–11", "Compliance, privacy & protections", "Authorisations, information security, risk allocation."),
        ("12–13", "Term, termination & general", "Lifecycle, notices, disputes and governing law."),
        ("14", "Execution", "Signature blocks for electronic or wet execution."),
        ("A", "Client referral & consent form", "Client-authorised introduction record."),
        ("B", "Loan writer undertaking", "Supporting execution where an individual adviser services referrals."),
        ("C", "Referrer entity & payment details", "Restricted finance administration form."),
    ])

    spacer(doc, 8)
    brand_slots_page(doc, brand)

    page_break(doc)

    # ------------------------------------------------------- email template
    section_band(doc, brand, "E", "PARTNER EMAIL TEMPLATE",
                 "Editable introductory correspondence", "Customise, approve and issue")
    spacer(doc, 6)
    guidance_card(
        doc, brand, "How to use this page",
        "Replace all bracketed fields, attach the agreement and commercial schedule, "
        "obtain internal approval, and delete this guidance card before issue.",
        removable=True,
    )
    spacer(doc, 6)
    email_panel(doc, brand)

    page_break(doc)

    # ---------------------------------------------------- 1 agreement details
    section_band(doc, brand, "1", "AGREEMENT DETAILS", "Complete before issue",
                 "Entity, licence and administration")
    spacer(doc, 6)
    guidance_card(
        doc, brand, "Completion standard",
        "Use the exact legal entity names, authorisation details, service addresses and "
        "commission-administration contacts that will appear in the executed agreement.",
    )
    spacer(doc, 6)
    field_grid(doc, brand, [
        Field("Agreement date", token("DATE")),
        Field("Governing state / territory"),
    ])
    spacer(doc, 4)
    para(doc, "FINANCE PARTNER  —  REGULATED CREDIT SERVICES", size=TYPE.label,
         bold=True, caps=True, tracking=1.4, colour=PALETTE.gold_dark, before=2,
         after=4, keep_with_next=True)
    field_grid(doc, brand, [
        Field("Legal name"),
        Field("Trading name"),
        Field("ABN / ACN"),
        Field("ACL / credit representative number"),
        Field("Authorising licensee / aggregator", token("INSERT OR N/A")),
        Field("Registered address"),
        Field("Primary email"),
        Field("Commission administration email"),
    ])
    spacer(doc, 5)
    para(doc, "BUYER'S AGENCY  —  REFERRER", size=TYPE.label, bold=True, caps=True,
         tracking=1.4, colour=PALETTE.gold_dark, before=2, after=4, keep_with_next=True)
    field_grid(doc, brand, [
        Field("Legal name"),
        Field("Trading name"),
        Field("ABN / ACN"),
        Field("Property licence details", token("INSERT IF APPLICABLE")),
        Field("Registered address"),
        Field("Primary email"),
    ])
    spacer(doc, 6)
    note_card(
        doc, brand, "Parties",
        "The finance partner receives referrals and provides regulated credit services. "
        "The buyer's agency acts only as a referrer unless it separately holds the "
        "licences and authorisations required to provide credit assistance.",
        tone="brand",
    )

    page_break(doc)

    # ------------------------------------------------ 2 professional boundaries
    section_band(doc, brand, "2", "PURPOSE & PROFESSIONAL BOUNDARIES",
                 "Referral-only scope", "Introduction is not credit assistance")
    spacer(doc, 6)
    responsibility_columns(
        doc, brand,
        ("Buyer's agency / referrer MAY", [
            "Tell a client that the Finance Partner can provide credit services.",
            "With written client consent, provide the client's name, contact details "
            "and a brief description of the general credit purpose.",
            "Disclose the agreed referral benefit or commission-share arrangement to "
            "the client.",
            "Submit and track the referral through the agreed secure workflow.",
            "Continue to provide separate property consulting and buyer advocacy "
            "services within its own licensed scope.",
        ]),
        ("Buyer's agency / referrer MUST NOT", [
            "Recommend a particular loan, lender, rate, credit product or finance "
            "structure.",
            "Assess or represent the client's eligibility, borrowing capacity or "
            "prospects of approval.",
            "Prepare or submit a credit application or negotiate with a lender on the "
            "client's behalf unless separately authorised.",
            "Describe itself as acting for the Finance Partner, ACL holder, aggregator "
            "or lender.",
            "Charge the client a separate amount merely for making the referral, unless "
            "lawful and separately documented.",
        ]),
        tones=("success", "alert"),
    )
    spacer(doc, 6)
    note_card(
        doc, brand, "Referral boundary",
        "The buyer's agency introduces. The finance partner assesses, advises, applies, "
        "liaises and settles. Each organisation remains responsible for its own "
        "separate service relationship.",
        tone="alert",
    )

    spacer(doc, 9)

    # ------------------------------------------------- 2A operative clauses 1-2
    section_band(doc, brand, "2A", "PURPOSE & FINANCE PARTNER SERVICES",
                 "Operative clauses", "Referral authority and service responsibility")
    spacer(doc, 6)
    clause_block(doc, brand, "1.  Purpose of Agreement", [
        "1.1 This Agreement permits the Buyer's Agency to refer clients to the Finance "
        "Partner for potential credit services and sets out the associated "
        "commission-share arrangement.",
        "1.2 The parties intend that referrals remain incidental to the Buyer's "
        "Agency's property-services business and are conducted within the limits of "
        "applicable credit, privacy and consumer laws.",
        "1.3 This Agreement does not authorise the Buyer's Agency to provide credit "
        "assistance or represent the Finance Partner, any ACL holder, aggregator or "
        "lender.",
    ])
    spacer(doc, 5)
    clause_block(doc, brand, "2.  Finance Partner Services", [
        "2.1 The Finance Partner is solely responsible for all credit services, "
        "including fact finding, borrowing-capacity assessment, responsible lending "
        "inquiries, product comparison, loan structuring, application preparation, "
        "disclosure, submission, lender liaison and settlement.",
        "2.2 The Finance Partner must maintain all required licences, authorisations, "
        "memberships, lender accreditations and insurance.",
        "2.3 The Finance Partner may accept or decline a referral or credit application "
        "and does not guarantee approval, valuation, pricing or settlement.",
    ])

    page_break(doc)

    # ------------------------------------------------ 3 referral requirements
    section_band(doc, brand, "3", "REFERRAL REQUIREMENTS",
                 "Buyer's agency to finance partner", "Consent and secure handling")
    spacer(doc, 6)
    clause_block(doc, brand, "3.  Permitted Referral Activities", [
        "3.1 Before sharing information, the Buyer's Agency must tell the client that "
        "the Finance Partner may be able to provide credit services and obtain the "
        "client's written consent to the introduction.",
        "3.2 The Buyer's Agency may provide only the client's name, contact details and "
        "a brief description of the general credit purpose unless the client separately "
        "authorises further disclosure.",
        "3.3 The Buyer's Agency must disclose the nature of any commission share, "
        "referral fee or other material benefit in the manner required by law and the "
        "Finance Partner's compliance framework.",
        "3.4 The Buyer's Agency must not provide inaccurate, misleading or incomplete "
        "information and must promptly correct any material error it becomes aware of.",
        "3.5 The Buyer's Agency is not obliged to make referrals and the client remains "
        "free to choose another finance provider.",
    ])
    spacer(doc, 5)
    clause_block(doc, brand, "4.  Finance Partner Referral Handling", [
        "4.1 The Finance Partner must confirm receipt, acceptance and the assigned "
        "broker or loan writer through the agreed portal or secure channel.",
        f"4.2 The Finance Partner must contact the client within {token('TIMEFRAME')} "
        "or advise the Buyer's Agency that the referral cannot be serviced.",
        "4.3 Subject to client consent, the Finance Partner may provide high-level "
        "status updates such as contacted, assessment underway, application submitted, "
        "conditional approval, unconditional approval, settlement booked and settled.",
        "4.4 Detailed credit reports, lender comparisons, servicing calculations, "
        "liabilities, identity documents and financial records must not be disclosed to "
        "the Buyer's Agency unless specifically authorised and necessary.",
    ])
    spacer(doc, 6)
    note_card(
        doc, brand, "Secure workflow expectation",
        "Use the agreed portal or secure channel for referral submission, status "
        "tracking and authorised information exchange.",
        tone="info",
    )

    page_break(doc)

    # ------------------------------------------- 4 commission & payment schedule
    section_band(doc, brand, "4", "COMMISSION & PAYMENT SCHEDULE",
                 "Buyer's agency referral to finance partner",
                 "Flexible percentage-based schedule")
    spacer(doc, 6)
    note_card(
        doc, brand, "Nothing is pre-set",
        "Complete the negotiated percentages and payment mechanics. The template does "
        "not prescribe an upfront percentage, trail percentage, payment date or lender "
        "panel.",
        tone="alert",
    )
    spacer(doc, 6)
    para(doc, "COMMISSION SHARE", size=TYPE.label, bold=True, caps=True, tracking=1.4,
         colour=PALETTE.gold_dark, before=2, after=4, keep_with_next=True)
    field_grid(doc, brand, [
        Field("Upfront commission share",
              f"{token('INSERT %')} of net upfront commission actually received"),
        Field("Trail commission share",
              f"{token('INSERT % OR 0%')} of net trail commission actually received"),
    ])
    spacer(doc, 5)
    para(doc, "SELECT ONE OPTION IN EACH ROW", size=TYPE.label, bold=True, caps=True,
         tracking=1.4, colour=PALETTE.gold_dark, before=2, after=4, keep_with_next=True)
    field_grid(doc, brand, [
        Field("Commission basis",
              f"{CHECKBOX} Gross received        "
              f"{CHECKBOX} Net of aggregator / licensee deductions        {CHECKBOX} Other",
              choice=True),
        Field("Cleared funds condition",
              f"Payment occurs only after the finance partner receives cleared funds:"
              f"        {CHECKBOX} Yes        {CHECKBOX} No", choice=True),
        Field("GST / tax invoice process",
              f"{CHECKBOX} Tax invoice        {CHECKBOX} RCTI        "
              f"{CHECKBOX} Other: {INSERT}", choice=True),
    ], columns=1)
    spacer(doc, 5)
    para(doc, "COMPLETE EVERY APPLICABLE VALUE", size=TYPE.label, bold=True, caps=True,
         tracking=1.4, colour=PALETTE.gold_dark, before=2, after=4, keep_with_next=True)
    field_grid(doc, brand, [
        Field("Qualifying event",
              f"Settled loan and first drawdown, unless otherwise stated: {INSERT}"),
        Field("Payment cycle", token("INSERT MONTHLY / SPECIFIC BUSINESS DAYS / OTHER")),
        Field("Clawback treatment", token("INSERT PROPORTIONAL REPAYMENT / OFFSET / OTHER")),
        Field("Clawback repayment timeframe",
              f"{token('NUMBER')} business days after written notice and evidence"),
        Field("Refinances / top-ups / subsequent loans",
              token("INSERT WHETHER INCLUDED OR EXCLUDED")),
        Field("Duplicate referral rule",
              token("INSERT HOW EXISTING OR DUPLICATE CLIENTS ARE TREATED")),
        Field("Post-termination entitlement",
              token("INSERT AGREED TREATMENT OF PRE-TERMINATION REFERRALS")),
        Field("Payment dispute window",
              f"{token('NUMBER')} business days after the statement"),
    ])
    spacer(doc, 6)
    note_card(
        doc, brand, "Cleared funds principle",
        "The finance partner is not required to pay a commission share until it has "
        "actually received the relevant commission in cleared funds. Any lender, "
        "aggregator or licensee clawback is dealt with only in accordance with the "
        "completed clawback field above.",
        tone="brand",
    )

    page_break(doc)

    # -------------------------------------------- 5-7 administration & clawbacks
    section_band(doc, brand, "5–7", "COMMISSION ADMINISTRATION, CLAWBACKS & TAX",
                 "Statements, adjustments and GST controls")
    spacer(doc, 6)
    clause_block(doc, brand, "5.  Commission Statements and Payment", [
        "5.1 The Finance Partner must provide a payment statement identifying the "
        "referral, relevant settled loan, commission received, calculation basis, GST "
        "treatment, adjustments and amount payable.",
        "5.2 The Buyer's Agency must provide any valid tax invoice or entity "
        "information reasonably required under the completed schedule.",
        f"5.3 A payment dispute must be raised within {token('NUMBER')} business days "
        "after the statement. Undisputed amounts remain payable on time.",
    ])
    spacer(doc, 5)
    clause_block(doc, brand, "6.  Clawbacks and Adjustments", [
        "6.1 Where a lender, aggregator or ACL holder lawfully claws back commission "
        "relating to a referral, the parties will apply the completed clawback "
        "treatment in the Commission & Payment Schedule.",
        "6.2 The Finance Partner must provide reasonable evidence of the clawback and "
        "its calculation.",
        "6.3 The Buyer's Agency's repayment or offset obligation cannot exceed the "
        "commission-share amount actually paid to it for the affected loan, unless "
        "otherwise expressly agreed.",
    ])
    spacer(doc, 5)
    clause_block(doc, brand, "7.  GST and RCTIs (Recipient Created Tax Invoices)", [
        "7.1 Amounts are treated as inclusive or exclusive of GST as stated in the "
        "Commission & Payment Schedule.",
        "7.2 A party must remain registered for GST where required and notify the other "
        "if its status changes.",
        "7.3 If recipient-created tax invoices are used, the parties must satisfy the "
        "applicable requirements and the Buyer's Agency must not issue a duplicate tax "
        "invoice for the same supply.",
    ])

    page_break(doc)

    # ------------------------------------------ 8-11 compliance & protections
    section_band(doc, brand, "8–11", "COMPLIANCE, PRIVACY & RELATIONSHIP PROTECTIONS",
                 "Authorisations, security and risk allocation")
    spacer(doc, 6)
    clause_block(doc, brand, "8.  Compliance and Warranties", [
        "8.1 Each party warrants that it holds the licences, approvals and authority "
        "required for its own business and will comply with applicable laws and lawful "
        "compliance directions.",
        "8.2 The Buyer's Agency warrants that it will not engage in credit activity "
        "beyond the scope permitted by law and its authorisations.",
        "8.3 The Buyer's Agency must promptly notify the Finance Partner if it becomes "
        "banned, disqualified, subject to a material complaint or investigation, or "
        "otherwise unable to make referrals lawfully.",
    ])
    spacer(doc, 5)
    clause_block(doc, brand, "9.  Privacy, Confidentiality and Security", [
        "9.1 Each party must collect, use, store and disclose personal information only "
        "for the referral, credit-service, payment, compliance and lawful "
        "record-keeping purposes.",
        "9.2 Each party must protect non-public client, commercial and operational "
        "information and promptly notify the other of a material privacy or cyber "
        "incident affecting referred clients.",
        "9.3 Banking and payment changes must be independently verified using a known "
        "contact method before processing.",
    ])
    spacer(doc, 5)
    clause_block(doc, brand, "10.  Client Relationships and Non-Circumvention", [
        "10.1 The Finance Partner retains responsibility for the credit relationship "
        "and the Buyer's Agency retains responsibility for the property-services "
        "relationship.",
        "10.2 Neither party may intentionally avoid an accrued commission-share "
        "entitlement or misrepresent the other party's services.",
        "10.3 The client retains complete freedom to choose, change or cease using "
        "either service provider.",
    ])
    spacer(doc, 5)
    clause_block(doc, brand, "11.  Liability and Indemnity", [
        "11.1 Each party remains responsible for its own conduct, advice, "
        "representations, employees, contractors and legal obligations.",
        "11.2 To the extent permitted by law, each party indemnifies the other against "
        "third-party loss arising directly from its material breach, negligence, "
        "unlawful conduct or unauthorised representation.",
        "11.3 The Buyer's Agency is not liable for a lender or Finance Partner "
        "decision, and the Finance Partner is not liable for a property recommendation "
        "or acquisition decision, except to the extent caused by its own breach or "
        "negligence.",
    ])

    page_break(doc)

    # --------------------------------------------- 12-13 term & general
    section_band(doc, brand, "12–13", "TERM, TERMINATION & GENERAL PROVISIONS",
                 "Lifecycle, notices, disputes and governing law")
    spacer(doc, 6)
    clause_block(doc, brand, "12.  Term and Termination", [
        "12.1 This Agreement starts when signed by both parties and continues until "
        "terminated.",
        f"12.2 Either party may terminate without cause by giving {token('NUMBER')} "
        "days' written notice.",
        f"12.3 A party may terminate immediately for an unremedied material breach "
        f"after {token('NUMBER')} business days' notice, fraud, gross negligence, "
        "insolvency, loss of authorisation or material regulatory risk.",
        "12.4 Except where termination results from fraud, deliberate misconduct or an "
        "agreed exclusion, commission-share entitlements for qualifying referrals made "
        "before termination continue as specified in the Commission & Payment Schedule.",
    ])
    spacer(doc, 5)
    clause_block(doc, brand, "13.  Notices, Disputes and General", [
        "13.1 Notices must be in writing and sent to the contact details in the "
        "Agreement Details.",
        "13.2 Senior representatives must attempt to resolve disputes in good faith "
        "before mediation or court proceedings, except for urgent relief.",
        "13.3 This Agreement and its completed schedules form the entire agreement and "
        "may only be varied in writing signed by both parties.",
        "13.4 Neither party may assign this Agreement without written consent, except "
        "for an approved novation or genuine business restructure that preserves the "
        "other party's rights.",
        f"13.5 This Agreement is governed by the laws of {token('STATE OR TERRITORY')} "
        "and the parties submit to the courts of that jurisdiction.",
        "13.6 The Agreement may be signed electronically and in counterparts.",
    ])

    page_break(doc)

    # ---------------------------------------------------------- 14 execution
    section_band(doc, brand, "14", "EXECUTION", "Electronic or wet signature",
                 "Complete after schedules are final")
    spacer(doc, 6)
    guidance_card(
        doc, brand, "Execution note",
        "Select the execution block appropriate to each entity. The parties may execute "
        "counterparts and use an approved electronic signature platform.",
    )
    spacer(doc, 7)
    signature_panel(doc, brand, [
        ("Signed for the finance partner", EXECUTION_LINES),
        ("Signed for the buyer's agency / referrer", EXECUTION_LINES),
    ])
    spacer(doc, 8)
    note_card(
        doc, brand,
        "Optional company execution — section 127, Corporations Act 2001 (Cth)",
        "Use the block below only where it is appropriate for the executing entity and "
        "approved by the relevant advisers.",
    )
    spacer(doc, 6)
    signature_panel(doc, brand, COMPANY_EXECUTION)

    page_break(doc)

    # -------------------------------------- annexure A: client referral & consent
    section_band(doc, brand, "A", "CLIENT REFERRAL & CONSENT FORM",
                 "Buyer's agency to finance partner", "Client-authorised record")
    spacer(doc, 6)
    guidance_card(
        doc, brand, "One form per client",
        "Obtain the client's signature before any personal information is shared. Retain "
        "the signed form for the retention period set out in the parties' compliance "
        "frameworks.",
    )
    spacer(doc, 6)
    field_grid(doc, brand, [
        Field("Referral ID", token("AUTO-GENERATED OR INSERT")),
        Field("Referral date", token("DATE")),
        Field("Buyer's agency", token("LEGAL / TRADING NAME")),
        Field("Referring representative", token("NAME")),
        Field("Finance partner", token("LEGAL / TRADING NAME")),
        Field("Assigned broker / loan writer", token("NAME AND CRN")),
        Field("Client name", token("CLIENT NAME")),
        Field("Client contact details", token("PHONE AND EMAIL")),
        Field("General credit purpose", token("PURCHASE / REFINANCE / EQUITY / OTHER")),
        Field("Preferred contact time"),
    ])
    spacer(doc, 4)
    field_grid(doc, brand, [
        Field("Written consent obtained", f"{CHECKBOX} Yes        {CHECKBOX} No",
              choice=True),
        Field("Referral benefit disclosed",
              f"{CHECKBOX} Yes        {CHECKBOX} No        {CHECKBOX} No benefit",
              choice=True),
        Field("Information provided",
              f"{CHECKBOX} Name        {CHECKBOX} Contact details        "
              f"{CHECKBOX} General purpose only", choice=True),
        Field("Current status",
              f"{CHECKBOX} Submitted     {CHECKBOX} Accepted     {CHECKBOX} Contacted     "
              f"{CHECKBOX} Application     {CHECKBOX} Approved     {CHECKBOX} Settled",
              choice=True),
    ], columns=1)
    spacer(doc, 6)
    consent = card(doc, fill=PALETTE.gold_pale, border=(8, brand.accent), pad=(180, 210))
    para(consent, "CLIENT CONSENT", size=TYPE.label, bold=True, caps=True, tracking=1.4,
         colour=PALETTE.gold_dark, before=0, after=5, keep_with_next=True)
    para(consent,
         f"I consent to {token('BUYER’S AGENCY NAME')} providing my name, contact "
         f"details and general credit purpose to {token('FINANCE PARTNER NAME')} so "
         "that the finance partner may contact me about potential credit services. I "
         "understand that the buyer's agency may receive a referral payment or "
         "commission share if my loan settles, as disclosed to me. I remain free to "
         "choose another finance provider and no approval or lending outcome is "
         "guaranteed.",
         size=TYPE.body_small, colour=PALETTE.ink, before=0, after=0, line=1.3)
    spacer(doc, 6)
    signature_panel(doc, brand, [
        ("Client signature", ["Signature:", "Full name:", "Date:  ____ / ____ / ______"]),
        ("Witnessed / recorded by", ["Name:", "Role:", "Date:  ____ / ____ / ______"]),
    ])

    page_break(doc)

    # ------------------------------------------ annexure B: loan writer undertaking
    section_band(doc, brand, "B", "LOAN WRITER / AUTHORISED REPRESENTATIVE UNDERTAKING",
                 "Where an individual adviser services referrals")
    spacer(doc, 6)
    guidance_card(
        doc, brand, "When to use this annexure",
        "Complete only where a named loan writer or authorised representative will "
        "receive and service referrals under the main agreement. Link it to the main "
        "agreement by recording the agreement date below.",
    )
    spacer(doc, 6)
    field_grid(doc, brand, [
        Field("Finance partner legal entity"),
        Field("ACL / authorising licensee"),
        Field("Loan writer / representative entity"),
        Field("Credit representative number"),
        Field("Buyer's agency / referrer"),
        Field("Main agreement date"),
    ])
    spacer(doc, 6)
    clause_block(doc, brand, "B1.  Purpose", [
        "B1.1 The Loan Writer acknowledges that the Buyer's Agency and the Finance "
        "Partner have entered into the Referral & Commission Agreement identified above.",
        "B1.2 The Loan Writer may receive and service referrals only through the "
        "Finance Partner and subject to the main agreement, the Loan Writer's "
        "authorisation and all lawful directions of the Finance Partner, ACL holder and "
        "aggregator.",
    ])
    spacer(doc, 5)
    clause_block(doc, brand, "B2.  Undertakings", [
        "B2.1 The Loan Writer will comply with the referral, privacy, disclosure, "
        "record-keeping and professional-boundary provisions of the main agreement.",
        "B2.2 The Loan Writer will not represent that the Buyer's Agency provides "
        "credit assistance or guarantees finance approval.",
        "B2.3 The Loan Writer will promptly notify the Finance Partner of any "
        "complaint, privacy incident, regulatory issue or authorisation change relevant "
        "to a referred client.",
    ])
    spacer(doc, 5)
    clause_block(doc, brand, "B3.  No Separate Payment Obligation", [
        "B3.1 Unless separately agreed in writing, all commission-share payments are "
        "made by the Finance Partner to the Buyer's Agency. This undertaking does not "
        "create a separate payment obligation for the Loan Writer.",
    ])
    spacer(doc, 5)
    clause_block(doc, brand, "B4.  Termination", [
        "B4.1 This undertaking ends when the Loan Writer ceases to be authorised by or "
        "associated with the Finance Partner, or when the main agreement terminates, "
        "whichever occurs first. Accrued obligations survive to the extent stated in "
        "the main agreement.",
    ])
    spacer(doc, 8)
    section_band(doc, brand, "B5", "EXECUTION", "Electronic or wet signature",
                 "Loan writer undertaking")
    spacer(doc, 6)
    signature_panel(doc, brand, [
        ("Signed for the loan writer / authorised representative", EXECUTION_LINES),
        ("Signed for the buyer's agency / referrer", EXECUTION_LINES),
    ])
    spacer(doc, 7)
    note_card(
        doc, brand,
        "Optional company execution — section 127, Corporations Act 2001 (Cth)",
        "Use the block below only where it is appropriate for the executing entity and "
        "approved by the relevant advisers.",
    )
    spacer(doc, 6)
    signature_panel(doc, brand, COMPANY_EXECUTION)

    page_break(doc)

    # -------------------------------------- annexure C: entity & payment details
    section_band(doc, brand, "C", "REFERRER ENTITY & PAYMENT DETAILS",
                 "Restricted finance administration form", "Banking verification")
    spacer(doc, 6)
    note_card(
        doc, brand, "Security control",
        "Banking details should be collected in a restricted-access workflow and "
        "independently verified using a known telephone number before the first payment "
        "or any later change.",
        tone="alert",
    )
    spacer(doc, 6)
    para(doc, "ENTITY DETAILS", size=TYPE.label, bold=True, caps=True, tracking=1.4,
         colour=PALETTE.gold_dark, before=2, after=4, keep_with_next=True)
    field_grid(doc, brand, [
        Field("Registered entity name"),
        Field("Trading name"),
        Field("ABN / ACN"),
        Field("GST registered", f"{CHECKBOX} Yes        {CHECKBOX} No", choice=True),
        Field("Registered address"),
        Field("Business phone"),
        Field("Accounts email / RCTI email"),
        Field("Authorised accounts contact"),
    ])
    spacer(doc, 5)
    para(doc, "BANKING DETAILS  —  RESTRICTED", size=TYPE.label, bold=True, caps=True,
         tracking=1.4, colour=PALETTE.alert, before=2, after=4, keep_with_next=True)
    field_grid(doc, brand, [
        Field("Account name", token("MUST MATCH AGREEMENT ENTITY")),
        Field("Bank name"),
        Field("BSB"),
        Field("Account number"),
        Field("Independent verification date", token("DATE")),
        Field("Verified by", token("NAME AND ROLE")),
    ])
    spacer(doc, 6)
    note_card(
        doc, brand, "Declaration",
        "The signatory confirms that the entity and banking information is accurate, "
        "that they are authorised to provide it, and that the finance partner may use "
        "the information solely for administering payments, reconciliations and "
        "required tax documentation under the agreement.",
    )
    spacer(doc, 6)
    signature_panel(doc, brand, [
        ("Director / authorised signatory",
         [f"Name: {INSERT}", "Signature:", "Date:  ____ / ____ / ______"]),
        ("Received & verified by (finance partner)",
         [f"Name / role: {INSERT}", "Signature:", "Date:  ____ / ____ / ______"]),
    ])

    set_core_properties(
        doc, brand,
        title=DOC_TITLE,
        subject="Finance referral and commission agreement — white-label template",
        keywords="referral agreement, commission share, finance partner, buyer's agency, "
                 "white label, Aurixa",
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    doc.save(output)
    return output


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
        "public/templates/finance-portal/Aurixa_Finance_Referral_and_Commission_Agreement.docx"
    )
    print(build(DEFAULT_BRAND, target))
