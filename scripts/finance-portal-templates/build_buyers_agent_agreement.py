#!/usr/bin/env python3
"""Build the Strategic Property Referral Agreement (buyer's agency -> finance partner).

Content is carried over verbatim from the source template; this script supplies
the structure, brand system and page layout. Run via ``build_all.py``.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Mm, Pt

from aurixa_brand import DEFAULT_BRAND, INSERT, LAYOUT, PALETTE, TYPE, BrandProfile, token
from docx_kit import (
    BULLET,
    CHECKBOX,
    Field,
    base_document,
    brand_slots_page,
    card,
    clause_block,
    clear,
    cell_borders,
    cell_margins,
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
    workflow_ladder,
    write,
)

DOC_TITLE = "Strategic Property Referral Agreement"

EXECUTION_LINES = [
    f"Legal entity: {INSERT}",
    f"Name of signatory: {INSERT}",
    f"Title / capacity: {INSERT}",
    "Signature:",
    "Date:  ____ / ____ / ______",
    "Witness (if required):",
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
    write(p, f"Strategic Referral Partnership — {token('BUYER’S AGENCY NAME')} and "
             f"{token('FINANCE PARTNER NAME')}",
          size=TYPE.body_small, bold=True, colour=PALETTE.ink)

    paragraphs = [
        f"Hi {token('FIRST NAME')},",
        f"Thank you for discussing a potential referral partnership between "
        f"{token('BUYER’S AGENCY NAME')} and {token('FINANCE PARTNER NAME')}.",
        "Attached is our editable Strategic Property Referral Agreement. It is designed "
        "for circumstances where your finance team identifies a client who may benefit "
        "from independent property strategy, buyer advocacy, property selection, due "
        "diligence or acquisition support.",
        "The commercial schedule has deliberately been left open so the parties can "
        "negotiate the referral model, qualifying event, payment timeframe, GST "
        "treatment and exclusions before execution.",
        "Please have the agreement reviewed by your legal, compliance, ACL-holder and "
        "aggregator teams where applicable. Once the commercial schedule is agreed, we "
        "can finalise the document for electronic execution and activate the referral "
        "workflow.",
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
        "Agree the commercial schedule",
        "Obtain legal & compliance sign-off",
        "Confirm aggregator / ACL position",
        "Issue for electronic execution",
        "Activate the referral workflow",
    ]:
        p = para(side, "", before=0, after=4, line=1.2, left_indent=11, hanging=11)
        write(p, f"{CHECKBOX}  ", size=TYPE.body_small, colour=brand.accent)
        write(p, step, size=TYPE.body_small, colour="E4DBCC")

    para(side, "ATTACHMENTS", size=TYPE.label, bold=True, caps=True, tracking=1.3,
         colour=brand.accent, before=12, after=6)
    for item in [
        "Strategic Property Referral Agreement",
        "Commercial Schedule",
        "Referral Registration Form",
    ]:
        p = para(side, "", before=0, after=4, line=1.2, left_indent=11, hanging=11)
        write(p, f"{BULLET}  ", size=TYPE.body_small, bold=True, colour=brand.accent)
        write(p, item, size=TYPE.body_small, colour="E4DBCC")


def build(brand: BrandProfile, output: Path) -> Path:
    doc = base_document(brand, DOC_TITLE)

    # ---------------------------------------------------------------- cover
    from docx_kit import cover_panel

    cover_panel(
        doc, brand,
        eyebrow="Issued by the buyer's agency to the finance partner",
        title_lines=["Strategic Property", "Referral Agreement"],
        summary=(
            "A structured, editable agreement template for establishing a professional "
            "referral relationship while preserving clear service boundaries, client "
            "choice and transparent commercial terms."
        ),
        chips=["EDITABLE", "ACTIVATION-READY", "BRAND-READY"],
        reference="SPRA-" + token("REF"),
    )

    page_break(doc)

    # ---------------------------------------------------------- document map
    document_map(doc, brand, [
        ("E", "Partner email template", "Editable introductory correspondence to accompany the pack."),
        ("W", "Brand & customisation panel", "Every white-label field in one place."),
        ("1", "Agreement details", "Entity, licensing and notice information for both parties."),
        ("2", "Purpose & scope", "Responsibility split between the two businesses."),
        ("2A", "Purpose & services", "Operative clauses 1–2: establishment and client engagement."),
        ("3", "Referral workflow", "The seven controlled handover stages."),
        ("4", "Commercial schedule", "Negotiated fee model, qualifying event and payment terms."),
        ("5–7", "Consent, privacy & communications", "Client choice and controlled information exchange."),
        ("8–10", "Protections & risk allocation", "Non-circumvention, confidentiality, liability."),
        ("11–13", "Term, termination & general", "Lifecycle, disputes and governing law."),
        ("14", "Execution", "Signature blocks for electronic or wet execution."),
        ("A", "Referral registration form", "Per-referral record and status tracker."),
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
                 "Core entity and authority information")
    spacer(doc, 6)
    guidance_card(
        doc, brand, "Completion standard",
        "Use the exact legal entity names, registration details, licence information "
        "and service addresses that will appear in the executed agreement.",
    )
    spacer(doc, 6)
    field_grid(doc, brand, [
        Field("Agreement date", token("DATE")),
        Field("Governing state / territory"),
    ])
    spacer(doc, 4)
    para(doc, "BUYER'S AGENCY  —  RECIPIENT OF REFERRALS", size=TYPE.label, bold=True,
         caps=True, tracking=1.4, colour=PALETTE.gold_dark, before=2, after=4,
         keep_with_next=True)
    field_grid(doc, brand, [
        Field("Legal name"),
        Field("Trading name"),
        Field("ABN / ACN"),
        Field("Real estate licence details", token("INSERT IF APPLICABLE")),
        Field("Registered address"),
        Field("Primary email"),
    ])
    spacer(doc, 5)
    para(doc, "FINANCE PARTNER  —  REFERRING PARTY", size=TYPE.label, bold=True,
         caps=True, tracking=1.4, colour=PALETTE.gold_dark, before=2, after=4,
         keep_with_next=True)
    field_grid(doc, brand, [
        Field("Legal name"),
        Field("Trading name"),
        Field("ABN / ACN"),
        Field("ACL / credit representative number"),
        Field("Registered address"),
        Field("Primary email"),
    ])
    spacer(doc, 6)
    note_card(
        doc, brand, "Parties",
        "The buyer's agency is the recipient of property-service referrals. The finance "
        "partner is the referring party. Each remains independent and responsible for "
        "its own services, staff, licensing, advice and client documentation.",
        tone="brand",
    )

    spacer(doc, 9)

    # -------------------------------------------------------- 2 purpose/scope
    section_band(doc, brand, "2", "PURPOSE & SCOPE", "Clear service boundaries",
                 "Independent, coordinated services")
    spacer(doc, 6)
    responsibility_columns(
        doc, brand,
        ("Buyer's agency responsibilities", [
            "Provide property strategy, research, property identification and buyer "
            "advocacy services under a separate client engagement.",
            "Undertake appropriate property due diligence, negotiation and acquisition "
            "coordination within its licensed scope.",
            "Explain its own fees, service limitations and conflicts directly to the client.",
            "Provide only agreed high-level milestone updates to the finance partner, "
            "subject to client consent.",
            "Not provide credit assistance, lender recommendations or financial product "
            "advice unless separately licensed and authorised.",
        ]),
        ("Finance partner responsibilities", [
            "Identify clients who may require property acquisition or buyer advocacy support.",
            "Obtain client consent before sharing personal information or making the "
            "introduction.",
            "Continue to manage all borrowing-capacity, credit, loan application and "
            "lender communications.",
            "Maintain all required ACL, credit representative, aggregator and lender "
            "authorisations.",
            "Avoid representing that the buyer's agency guarantees a property outcome, "
            "valuation, loan approval or investment return.",
        ]),
        tones=("brand", "gold"),
    )
    spacer(doc, 6)
    note_card(
        doc, brand, "Boundary principle",
        "The referral relationship coordinates handover and milestone visibility. It "
        "does not merge professional responsibilities, advice scopes or client contracts.",
        tone="alert",
    )

    spacer(doc, 8)

    # ------------------------------------------------------- 2A operative 1-2
    section_band(doc, brand, "2A", "PURPOSE & SERVICES", "Operative clauses",
                 "Establishment and client engagement")
    spacer(doc, 6)
    clause_block(doc, brand, "1.  Purpose of Agreement", [
        "1.1 This Agreement establishes a structured referral relationship under which "
        "the Finance Partner may introduce clients to the Buyer's Agency for property "
        "consulting and buyer advocacy services.",
        "1.2 The objective is to support a coordinated client journey while preserving "
        "the client's freedom of choice and the independent professional "
        "responsibilities of each party.",
        "1.3 Nothing in this Agreement creates a partnership, joint venture, agency, "
        "employment, fiduciary relationship or authority for either party to bind the "
        "other.",
    ])
    spacer(doc, 5)
    clause_block(doc, brand, "2.  Services and Client Engagement", [
        "2.1 The Buyer's Agency may offer property strategy, search, appraisal, due "
        "diligence, negotiation and acquisition coordination services, subject to its "
        "own client agreement.",
        "2.2 The Finance Partner remains solely responsible for credit services, "
        "lending advice, credit assistance, loan structuring, application management "
        "and lender liaison.",
        "2.3 Each party may accept or decline a referral or client engagement in its "
        "discretion and must promptly communicate any material inability to proceed.",
    ])
    spacer(doc, 6)
    note_card(
        doc, brand, "Operational outcome",
        "Each referral moves into a separate property-services engagement only after "
        "the buyer's agency explains its services and the client chooses to proceed.",
        tone="success",
    )

    page_break(doc)

    # ------------------------------------------------------------ 3 workflow
    section_band(doc, brand, "3", "REFERRAL WORKFLOW",
                 "Finance partner to buyer's agency", "Seven controlled handover stages")
    spacer(doc, 6)
    workflow_ladder(doc, brand, [
        ("1", "Identify", "Finance partner identifies a client who may require property services."),
        ("2", "Consent", "Client provides consent to the introduction and any permitted information sharing."),
        ("3", "Submit", "Referral is lodged through the agreed portal or secure channel."),
        ("4", "Accept", "Buyer's agency confirms receipt and whether it will contact the client."),
        ("5", "Engage", "Buyer's agency explains its services and enters a separate client agreement if accepted."),
        ("6", "Update", "Only agreed high-level milestones are shared, subject to consent."),
        ("7", "Complete", "Commercial eligibility is assessed after the agreed qualifying event."),
    ])
    spacer(doc, 6)
    note_card(
        doc, brand, "Information boundary",
        "Referral information should ordinarily be limited to the client's name, contact "
        "details and a general description of the requested property service. Sensitive "
        "finance information should only be disclosed where necessary, lawful and "
        "specifically authorised by the client.",
        tone="info",
    )

    spacer(doc, 9)

    # -------------------------------------------------- 4 commercial schedule
    section_band(doc, brand, "4", "COMMERCIAL SCHEDULE",
                 "Finance partner referral to buyer's agency",
                 "Complete every applicable field")
    spacer(doc, 6)
    note_card(
        doc, brand, "No pre-set commercial terms",
        "This schedule intentionally contains no fixed fee, percentage or payment "
        "timeframe. The parties must complete every applicable field before execution.",
        tone="alert",
    )
    spacer(doc, 6)
    para(doc, "SELECT ONE OPTION IN EACH ROW", size=TYPE.label, bold=True, caps=True,
         tracking=1.4, colour=PALETTE.gold_dark, before=2, after=4, keep_with_next=True)
    field_grid(doc, brand, [
        Field("Remuneration model",
              f"{CHECKBOX} Fixed fee        {CHECKBOX} Percentage of buyer's agency fee"
              f"        {CHECKBOX} Other", choice=True),
        Field("GST treatment",
              f"{CHECKBOX} Plus GST        {CHECKBOX} GST inclusive        "
              f"{CHECKBOX} Not applicable", choice=True),
        Field("Qualifying event",
              f"{CHECKBOX} Engagement signed        {CHECKBOX} Unconditional contract        "
              f"{CHECKBOX} Settlement        {CHECKBOX} Other", choice=True),
        Field("Invoice process",
              f"{CHECKBOX} Tax invoice        {CHECKBOX} RCTI        "
              f"{CHECKBOX} Other: {INSERT}", choice=True),
    ], columns=1)
    spacer(doc, 5)
    para(doc, "COMPLETE EVERY APPLICABLE VALUE", size=TYPE.label, bold=True, caps=True,
         tracking=1.4, colour=PALETTE.gold_dark, before=2, after=4, keep_with_next=True)
    field_grid(doc, brand, [
        Field("Agreed amount / percentage", token("INSERT AMOUNT OR PERCENTAGE")),
        Field("Fee cap / minimum", token('INSERT OR "NOT APPLICABLE"')),
        Field("Payment timeframe",
              f"{token('NUMBER')} business days after the qualifying event and valid invoice"),
        Field("Excluded matters", token('INSERT EXCLUSIONS OR "NONE"')),
        Field("Duplicate referral rule", token("INSERT HOW PRIOR OR DUPLICATE CLIENTS ARE TREATED")),
        Field("Post-termination entitlement", token("INSERT AGREED TREATMENT OF PRE-TERMINATION REFERRALS")),
    ])
    spacer(doc, 6)
    note_card(
        doc, brand, "Commercial control",
        "Commercial terms may only be changed by a written variation signed by both "
        "parties. No amount is payable unless the agreed qualifying event occurs and "
        "all disclosure, consent and invoicing requirements have been satisfied.",
        tone="brand",
    )

    spacer(doc, 9)

    # ------------------------------------------------- 5-7 consent & privacy
    section_band(doc, brand, "5–7", "CLIENT CONSENT, PRIVACY & COMMUNICATIONS",
                 "Client choice and controlled information exchange")
    spacer(doc, 6)
    clause_block(doc, brand, "5.  Client Consent and Disclosure", [
        "5.1 The Finance Partner must obtain the client's consent before disclosing "
        "personal information to the Buyer's Agency.",
        "5.2 Each party must clearly disclose any referral payment or other material "
        "benefit where disclosure is required by law, professional standards, licence "
        "conditions, aggregator policy or the party's internal compliance framework.",
        "5.3 The client remains free to decline the referral, choose another provider "
        "or cease dealing with either party.",
    ])
    spacer(doc, 5)
    clause_block(doc, brand, "6.  Privacy and Data Security", [
        "6.1 Each party must handle personal information in accordance with applicable "
        "privacy laws, its privacy policy and reasonable security controls.",
        "6.2 Personal information may only be used for the referral, service delivery, "
        "payment administration, compliance and lawful record-keeping purposes.",
        "6.3 A party must promptly notify the other of any suspected privacy incident "
        "materially affecting referred clients and cooperate with lawful response "
        "obligations.",
    ])
    spacer(doc, 5)
    clause_block(doc, brand, "7.  Client Communications", [
        "7.1 Neither party may communicate on behalf of the other without written "
        "authority.",
        "7.2 Status updates must be factual, proportionate and limited to the "
        "milestones approved by the client and the parties.",
        "7.3 Neither party may guarantee finance approval, property performance, "
        "valuation, settlement timing or any financial outcome.",
    ])

    spacer(doc, 9)

    # ------------------------------------------------ 8-10 protections & risk
    section_band(doc, brand, "8–10", "RELATIONSHIP PROTECTIONS & RISK ALLOCATION",
                 "Independent responsibility and fair dealing")
    spacer(doc, 6)
    clause_block(doc, brand, "8.  Client Relationships and Non-Circumvention", [
        "8.1 The Finance Partner retains responsibility for its lending relationship "
        "and the Buyer's Agency retains responsibility for its property-services "
        "relationship.",
        "8.2 Neither party may intentionally bypass the agreed referral process to "
        "avoid an accrued payment or knowingly solicit the other party's client for "
        "directly competing services outside its normal professional scope.",
        "8.3 Nothing prevents a client from independently choosing, changing or "
        "engaging service providers.",
    ])
    spacer(doc, 5)
    clause_block(doc, brand, "9.  Confidentiality, Insurance and Records", [
        "9.1 Each party must keep confidential non-public client, commercial and "
        "operational information and disclose it only as authorised or required by law.",
        "9.2 Each party must maintain insurance reasonably appropriate to its services "
        "and legal obligations.",
        "9.3 Each party must retain referral, consent, disclosure, invoice and payment "
        "records for the period required by applicable law and its compliance framework.",
    ])
    spacer(doc, 5)
    clause_block(doc, brand, "10.  Liability and Indemnity", [
        "10.1 Each party remains responsible for its own acts, omissions, advice, "
        "representations, staff, contractors and regulatory obligations.",
        "10.2 To the extent permitted by law, each party indemnifies the other against "
        "third-party loss arising directly from its material breach, negligence, "
        "unlawful conduct or unauthorised representation.",
        "10.3 Neither party is liable for the independent decision of a client, lender, "
        "vendor, valuer, insurer or other third party, except to the extent caused by "
        "that party's own breach or negligence.",
    ])

    spacer(doc, 9)

    # ------------------------------------------------- 11-13 term & general
    section_band(doc, brand, "11–13", "TERM, TERMINATION & GENERAL PROVISIONS",
                 "Lifecycle, disputes and governing law")
    spacer(doc, 6)
    clause_block(doc, brand, "11.  Term and Termination", [
        "11.1 This Agreement starts when signed by both parties and continues until "
        "terminated.",
        f"11.2 Either party may terminate without cause by giving {token('NUMBER')} "
        "days' written notice.",
        f"11.3 A party may terminate immediately for an unremedied material breach "
        f"after {token('NUMBER')} business days' written notice, fraud, gross "
        "misconduct, insolvency, loss of required licence or material regulatory risk.",
        "11.4 Termination does not affect rights and obligations accrued before "
        "termination, including any payment entitlement preserved in the Commercial "
        "Schedule.",
    ])
    spacer(doc, 5)
    clause_block(doc, brand, "12.  Dispute Resolution", [
        "12.1 A party must first give written details of a dispute and allow senior "
        "representatives to attempt resolution in good faith.",
        f"12.2 If unresolved within {token('NUMBER')} business days, the parties may "
        "refer the dispute to mediation before commencing court proceedings, except "
        "for urgent relief.",
    ])
    spacer(doc, 5)
    clause_block(doc, brand, "13.  Notices and General", [
        "13.1 Notices must be in writing and sent to the addresses or emails stated in "
        "the Agreement Details, as updated by notice.",
        "13.2 This Agreement, including completed schedules, is the entire agreement on "
        "its subject matter and may only be varied in writing signed by both parties.",
        "13.3 Neither party may assign this Agreement without the other party's written "
        "consent, not to be unreasonably withheld, except as part of a genuine business "
        "restructure that does not reduce the other party's rights.",
        "13.4 If a provision is invalid, it is severed to the minimum extent required. "
        "The remaining provisions continue.",
        f"13.5 This Agreement is governed by the laws of {token('STATE OR TERRITORY')} "
        "and the parties submit to the courts of that jurisdiction.",
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
        ("Signed for the buyer's agency", EXECUTION_LINES),
        ("Signed for the finance partner", EXECUTION_LINES),
    ])
    spacer(doc, 8)
    note_card(
        doc, brand, "Optional company execution — section 127, Corporations Act 2001 (Cth)",
        "Use the block below only where it is appropriate for the executing entity and "
        "approved by the relevant advisers.",
    )
    spacer(doc, 6)
    signature_panel(doc, brand, [
        ("Director / sole director", [f"Name and signature: {INSERT}", "Signature:",
                                      "Date:  ____ / ____ / ______"]),
        ("Director / company secretary", [f"Name and signature: {token('INSERT OR N/A')}",
                                          "Signature:", "Date:  ____ / ____ / ______"]),
    ])

    page_break(doc)

    # ------------------------------------------------ annexure A: referral form
    section_band(doc, brand, "A", "REFERRAL REGISTRATION FORM",
                 "Finance partner to buyer's agency", "Secure activation record")
    spacer(doc, 6)
    guidance_card(
        doc, brand, "One form per referral",
        "Complete a new registration form for every client introduction. Retain the "
        "completed form with the consent record for the retention period set out in "
        "clause 9.3.",
    )
    spacer(doc, 6)
    field_grid(doc, brand, [
        Field("Referral ID", token("AUTO-GENERATED OR INSERT")),
        Field("Referral date", token("DATE")),
        Field("Finance partner", token("LEGAL / TRADING NAME")),
        Field("Referring adviser", token("NAME AND CRN IF APPLICABLE")),
        Field("Client name", token("CLIENT NAME")),
        Field("Client contact details", token("PHONE AND EMAIL")),
        Field("General property requirement", token("OWNER-OCCUPIED / INVESTMENT / OTHER")),
        Field("Estimated timing"),
        Field("Assigned consultant"),
        Field("Assessed by / date"),
    ])
    spacer(doc, 4)
    field_grid(doc, brand, [
        Field("Consent obtained", f"{CHECKBOX} Yes        {CHECKBOX} No", choice=True),
        Field("Benefit disclosed",
              f"{CHECKBOX} Yes        {CHECKBOX} No        {CHECKBOX} Not applicable",
              choice=True),
        Field("Prior client check",
              f"{CHECKBOX} New        {CHECKBOX} Existing        {CHECKBOX} Duplicate",
              choice=True),
        Field("Current status",
              f"{CHECKBOX} Submitted     {CHECKBOX} Accepted     {CHECKBOX} Contacted     "
              f"{CHECKBOX} Engaged     {CHECKBOX} Contracted     {CHECKBOX} Settled",
              choice=True),
        Field("Commercial eligibility",
              f"{CHECKBOX} Pending        {CHECKBOX} Eligible        {CHECKBOX} Not eligible",
              choice=True),
    ], columns=1)
    spacer(doc, 6)
    note_card(
        doc, brand, "Permitted update fields",
        "Subject to client consent, status updates should be limited to high-level "
        "milestones such as contacted, engaged, searching, contract signed, finance "
        "milestone and settled. Detailed financial or personal information should not "
        "be disclosed unless specifically authorised.",
        tone="info",
    )

    set_core_properties(
        doc, brand,
        title=DOC_TITLE,
        subject="Buyer's agency to finance partner referral agreement — white-label template",
        keywords="referral agreement, buyer's agency, finance partner, white label, Aurixa",
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    doc.save(output)
    return output


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
        "public/templates/finance-portal/Aurixa_Strategic_Property_Referral_Agreement.docx"
    )
    print(build(DEFAULT_BRAND, target))
