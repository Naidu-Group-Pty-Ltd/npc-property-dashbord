## What the two documents actually are

Both are **Version 2.0 partner agreement templates** for the buyer's-agency ↔ finance-partner relationship. They are mirror images of each other — same structure, opposite direction of referral and opposite direction of money.

**Doc 1 — Strategic Property Referral Agreement** (issued *by* the Buyer's Agency *to* the Finance Partner)
- Finance partner refers a client **to** NPC for property strategy / buyer advocacy.
- Money flows **NPC → finance partner** (a referral fee off the buyer's-agency fee).
- 7-stage referral workflow: Identify → Consent → Submit → Accept → Engage → Update → Complete.
- Commercial Schedule is deliberately **blank**: remuneration model (fixed fee / % of BA fee / other), amount, GST treatment, qualifying event (engagement signed / unconditional / settlement / other), payment timeframe in business days, invoice process (tax invoice / RCTI), exclusions, duplicate-referral rule, fee cap/minimum, post-termination entitlement.
- Clauses 1–13 + execution block (incl. optional s127 Corporations Act) + **Annexure A: Referral Registration Form** (referral ID, dates, parties, client, consent obtained Y/N, benefit disclosed, prior-client check new/existing/duplicate, assigned consultant, status, commercial eligibility).

**Doc 2 — Finance Referral & Commission Agreement** (issued *by* the Finance Partner *to* the Buyer's Agency)
- NPC refers a client **to** the finance partner for credit services.
- Money flows **finance partner → NPC** (upfront + trail commission share).
- Commission & Payment Schedule: upfront share %, trail share %, commission basis (gross / net of aggregator deductions), qualifying event (settled loan + first drawdown), payment cycle, **cleared-funds condition**, GST/RCTI, clawback treatment, clawback repayment window, refinance/top-up inclusion, duplicate rule, post-termination entitlement.
- Clauses 1–13 plus three annexures:
  - **A — Client Referral & Consent Form** (with a verbatim client consent statement + client signature).
  - **B — Loan Writer / Authorised Representative Undertaking** (separate signature block, ACL/CRN, no separate payment obligation, auto-terminates with authorisation).
  - **C — Referrer Entity & Payment Details** (ABN, GST registered, accounts/RCTI email, account name/BSB/account number, **independent verification date + verified by** — explicitly a restricted-access form).

Hard compliance constraints running through both: strict information boundary (name + contact + general purpose only), consent before disclosure, benefit disclosure, no credit assistance by the referrer, no guaranteed outcomes, status updates limited to approved high-level milestones, records retention, privacy-incident notification, banking-change callback verification.

## What already exists in the codebase

- `agency_agreements` + `gamma_agreement_templates` + `manage-agency-agreements` edge function + DocuSign envelope flow (`send_docusign`, `check_status`, `void`, `retry_pdf`) — but scoped to **client** agreements only (`client_id`, `buyer_names`, `initial_commitment_fee`).
- `finance_agent_contacts` already carries `abn`, `gst_registered`, `bank_bsb`, `bank_account_number`, `bank_account_name`, `default_commission_rate_pct`, `default_commission_basis`.
- `finance_partner_commissions` + `finance_partner_statements` + `finance-portal-commissions` / `generate-commission-payout` / `manage-commission-ledger`.
- Finance Portal: partners, per-client assignments, permission matrix, purchase files, clawback radar, forecasting.
- **Missing entirely:** any concept of a *partner agreement*, a *referral* (inbound or outbound), a commercial schedule that parameterises commission, consent capture, or a loan-writer undertaking.

## Gap analysis — what needs to be added

**1. Partner agreements as a first-class object**
New `partner_agreements` table (direction: `inbound_property_referral` | `outbound_finance_referral`, version, status, governing state, effective/termination dates, both parties' legal/trading names, ABN/ACN, ACL/CRN, aggregator/licensee, addresses, emails, notice terms, termination notice days, dispute window). Reuse the existing DocuSign envelope pattern rather than building a second signing stack — extend `manage-agency-agreements` or fork a `manage-partner-agreements` function with the same envelope/status/void/retry surface.

**2. Commercial schedule as structured data, not prose**
Two schedule shapes stored against the agreement:
- *Property referral schedule*: model, amount/percentage, GST treatment, qualifying event, payment days, invoice process, exclusions, duplicate rule, cap/minimum, post-termination treatment.
- *Commission schedule*: upfront %, trail %, basis (gross/net), qualifying event, payment cycle, cleared-funds flag, GST/RCTI, clawback treatment + repayment days, refinance inclusion, duplicate rule, post-termination treatment.
These must become the **inputs to the commission engine** — today `finance_partner_commissions.rate_pct` comes from a partner default, not from a signed schedule. Agreement-derived rates should override partner defaults, with the agreement version snapshotted onto every commission row.

**3. Referral register (both directions)**
New `partner_referrals` table matching Annexure A of both docs: referral ID, direction, agreement FK, referring entity + individual (with CRN), client details, general purpose, timing/preferred contact, consent obtained + consent artefact, benefit disclosed, prior-client check (new/existing/duplicate), assigned consultant or assigned broker/loan writer, status lifecycle, commercial eligibility (pending/eligible/not eligible), and links to `clients` / `purchase_files` / `client_deals` once converted. Status vocabularies differ per direction — submitted/accepted/contacted/engaged/contracted/settled vs submitted/accepted/contacted/application/approved/settled.

**4. Consent capture + information boundary enforcement**
The client-signature consent block in Doc 2 Annexure A needs a real capture path (client portal signature or DocuSign) and an immutable stored artefact. Server-side, referral payloads must be whitelisted to name/contact/general purpose — the same projection discipline already used in the finance↔solicitor collaboration read models. Status updates exposed cross-party must be clamped to the approved milestone list; detailed credit/servicing/liability data must never appear on a referral surface.

**5. Loan writer undertaking**
Child record of an outbound agreement: loan writer entity, ACL/authorising licensee, CRN, main-agreement FK, own signature/envelope, auto-expiry when authorisation ends or main agreement terminates. Referrals can then be assigned to a specific loan writer only if a live undertaking exists.

**6. Restricted banking / payment details workflow**
Annexure C is explicitly restricted-access. Needs its own permission key, masked display, an `independent_verification_date` + `verified_by` requirement before first payout, and a re-verification gate on any bank detail change (matching clause 9.3's callback rule). Bank fields on `finance_agent_contacts` today have neither masking nor a verification gate.

**7. Commission administration gaps against Doc 2 clauses 5–7**
- Payment statements must show referral, settled loan, commission received, calculation basis, GST treatment, adjustments (§5.1) — the current statement generator does not carry referral or basis provenance.
- Dispute window (§5.3) — no dispute-raising state exists on statements.
- Clawback (§6) — clawback radar predicts risk but there is no *executed* clawback record with evidence attachment, and no enforcement of §6.3's cap (repayment can never exceed commission actually paid for that loan).
- RCTI (§7.3) — no RCTI-vs-tax-invoice mode, and no duplicate-invoice guard.
- Cleared-funds condition — no gate preventing payout before funds received.

**8. Template rendering + partner email**
Both docs open with an editable partner email template and a 4-step activation checklist (Customise → Review → Execute → Activate). This maps onto a template-driven generation flow with `<<TOKEN>>` merge fields — the existing `gamma_agreement_templates.placeholder_mappings` pattern fits, extended with a partner-agreement scope and the ~40 tokens each document uses.

**9. Surfaces**
- Command Centre: Partner Agreements register (list, generate, send, track envelope, void, version history), commercial schedule editor, banking verification queue.
- Finance Portal: "My Agreement" read-only view of the executed terms + schedule, inbound/outbound referral inbox, per-referral status updates constrained to permitted milestones.
- Client Portal: consent form signing surface for outbound referrals.
- New permission keys on the finance permission matrix: `partner_agreements`, `referrals`, `banking_details` (restricted).

## Suggested phasing

1. **Schema + agreement engine** — `partner_agreements`, schedules, template tokens, DocuSign reuse, Command Centre register.
2. **Referral register** — `partner_referrals` both directions, boundary-enforced projections, portal inboxes, conversion into `clients` / `purchase_files`.
3. **Consent + loan writer undertaking** — client consent capture, undertaking records, assignment gating.
4. **Commercial wiring** — schedule-driven commission rates, cleared-funds gate, statements with provenance, disputes.
5. **Clawbacks, RCTI, banking verification** — executed clawback records with §6.3 cap, RCTI mode + duplicate guard, restricted banking workflow with callback verification.
6. **Compliance hardening** — records retention, privacy-incident notification, audit chain over agreements/referrals/consent, termination handling of accrued entitlements.

## Technical notes

- Direction is the primary discriminator; nearly every table needs it, and status vocabularies, money direction and permission scope all branch on it.
- Reuse `invokeSecureFunction` + `service_role`-only RLS, add every new table to `ALLOWED_TABLES` and to `supabase_realtime` where live updates are needed.
- Money and rate handling must follow the existing financial-math standards (exact multipliers, 2-dp rate rounding).
- No commercial defaults may be hardcoded — both documents deliberately ship with empty schedules, so the UI must require explicit completion before an agreement can be sent for execution.
- Everything above is legal-template scaffolding: the app should never present generated agreements as legally approved, mirroring the "template only — obtain legal, licensing, privacy and aggregator approval before use" banner.
