# Agreement Centre

The partner-agreement register (`partner_agreements`) grown into a full
lifecycle engine: configure → internal review → approve → issue into the
Finance Partner Portal → partner review → accept / request changes → typed
electronic execution → counter-signature → executed master stored
automatically. The downloadable path (PDF / DOCX with the partner email pack)
coexists with the digital path throughout — neither replaces the other.

## The one rule everything else serves

**The legal wording of the two agreement templates is LOCKED.** It lives in
code — `supabase/functions/_shared/agreements/contentStrategicReferral.pure.ts`
and `contentFinanceReferral.pure.ts` — transcribed verbatim from the supplied
documents, typos included (clause 7 of Agreement 02 spells "Reciept" because
the source does). The only transformation is the one the templates invite:
their `<<INSERT>>` brackets are `{{field_key}}` binding tokens, and every
field keeps the ORIGINAL bracket text as its placeholder, so an unfilled
document prints exactly what the template printed.

Consequences that are enforced, not documented:

- The 64-bit FNV content hash of each template is frozen onto every issued
  version row (`partner_agreement_versions.template_content_hash`). An edit to
  the locked content is visible as a hash change on the next issue.
- `src/lib/agreements/__tests__/agreements.spec.ts` fails if any `{{token}}`
  in the content does not resolve to a registered field or derived value — a
  typo cannot silently print a generic placeholder into a legal document.
- The browser imports the SAME modules through the
  `src/lib/agreements/index.ts` bridge (the `partnerAgreementRevision`
  pattern), so the wizard, the preview, the partner room and the server
  cannot drift.

## The templates

| Key | Document | Direction | Issued by |
|---|---|---|---|
| `strategic_property_referral` | Strategic Property Referral Agreement | `inbound_property_referral` — the finance partner refers clients IN | The buyer's agency |
| `finance_referral_commission` | Finance Referral & Commission Agreement | `outbound_finance_referral` — the agency refers clients OUT | The finance partner |

`direction` IS the template selector (`templateKeyForDirection`); a row can
never carry a template that contradicts its direction.

## Lifecycle

`_shared/agreements/lifecycle.pure.ts` is the single authority — the server
enforces `AGREEMENT_TRANSITIONS`, both UIs render labels and primary actions
from the same maps.

```
draft → pending_review → approved_for_issue → partner_review
      ↘ (legacy manual: sent_for_signature)     ↓ accept        ↓ request changes
                                    sent_for_signature      changes_requested → draft (revise)
                                          ↓ partner signs
                                    partially_signed
                                          ↓ counter-sign
                                    active (fully executed)
partner_review / changes_requested / sent_for_signature → withdrawn → draft
active → terminated | superseded
```

- "Partner viewed" is a timestamp + event (`first_viewed_at`), not a status.
- Once a version is in front of the partner the working row is locked
  (`EDITABLE_STATUSES`); changes go revise → re-approve → reissue. Reissue
  writes a NEW version row with a field-level diff (`changed_fields`) — the
  "Updated in Version 1.1" summary is UI metadata, never a rewording.
- Duplicate detection warns (never blocks) when an in-flight agreement
  already exists for the partner + direction.

## Data

Migration `20260901001000_agreement_centre.sql`:

- enum values `approved_for_issue`, `partner_review`, `changes_requested`,
  `withdrawn` on `partner_agreement_status`; `other` on
  `partner_invoice_process` and `partner_commission_basis` (the templates
  offer it).
- `partner_agreement_versions` — frozen issued snapshots: field values, brand
  snapshot, template content hash, changed-fields diff, as-issued and
  executed PDF paths. Never mutated after issue except its `status` and the
  write-once artefact paths.
- `partner_agreement_reviews`, `partner_agreement_change_requests`,
  `partner_agreement_signatures` (unique per version × party role — the
  double-sign guard).
- New lifecycle columns on `partner_agreements` (`issued_version_id`,
  `issued_at`, `first_viewed_at`, `accepted_at`, `executed_at`,
  `withdrawn_at`, `executed_pdf_storage_path`, `agreement_owner_*`).

Field storage: real columns where the register has them, `schedule_extras`
for the rest. The registry (`_shared/agreements/fields.pure.ts`) owns the
mapping both ways — including mirroring Agreement 01's single "agreed amount
or percentage" entry into `fee_amount` / `fee_percentage` so the commission
engine and the activation gate keep working, and defaulting Agreement 02's
qualifying event in the template's own words.

## Functions

- `manage-partner-agreements` — all original actions unchanged, plus
  `record_review`, `issue_to_partner`, `withdraw`, `counter_sign`,
  `resolve_change_request`, `set_owner`, `duplicate_check`,
  `issuer_defaults`, `validate_issue`. Now gated deny-by-default on the
  `agreements` module (view for reads, edit for mutations).
- `finance-portal-agreements` — the partner side, on the finance portal
  session: `list`, `get` (records first view), `download`, `accept`,
  `request_changes`, `sign`. Rows are scoped to the session's
  `finance_contact_id`; the partner sees a whitelisted projection and a
  filtered event stream, never the internal register row.
- `agreement-centre-render` — staff document delivery: live preview PDF
  (base64, never stored), draft export (with the template pack), signed URLs
  for the frozen issued/executed artefacts. Executed downloads land in
  `security_audit_log`, like `partner-agreement-records`.

Rendering: `_shared/agreements/documentHtml.pure.ts` composes through
`reportDesign/` (no colour literals — the tenant's palette roles), WeasyPrint
`pdf/ua-1` via the shared client. **Draft previews float; issued documents
freeze**: version renders use the version row's `field_values` +
`brand_snapshot`, so a rebrand never changes an issued document. Storage is
the private `partner-agreements` bucket under
`agreement-centre/<id>/v<label>/{issued,executed}.pdf`, written once
(`upsert: false`). A renderer outage never blocks issue or execution — the
artefact is generated on first download from the frozen row.

The Section E email page and its "How to use this page" card carry
`audience: 'template_pack'`: included in template previews and manual
DOCX/PDF exports (the path they were written for), excluded from digitally
issued documents — the template's own "delete this guidance card before
issue" applied, not an edit.

DOCX is built in the browser (`src/lib/agreements/docx.ts`, the `docx`
package already in the bundle) from the same content module and values.

## Execution

Typed electronic signature (the `partner_consent_requests` mechanism):
signatory name, capacity, a typed signature that must match the name, hashed
IP/user-agent telemetry, one row per version per party. Partner signs first
(`partially_signed`), the Command Centre counter-signs (`counter_sign`),
which finalises: version row → `executed`, agreement → `active`, executed
master generated and stored, both sides notified. `signature_method` leaves
room for a dedicated e-signature provider later without a schema change; the
DocuSign columns and the legacy manual path are untouched.

## Notifications

- Staff: `insertTargetedNotification` fan-out to `agreements`-module viewers
  (`partner_agreement_activity` with a `link` to the agreement) on viewed /
  changes requested / accepted / signed / executed.
- Partner: rows in `finance_portal_notifications` (issued, reissued,
  withdrawn, executed) linking to `/finance/agreements/<id>`.

Every lifecycle event lands in `partner_agreement_events` and is mirrored
into the hash-chained `partner_compliance_audit_events` via
`recordPartnerAudit`.

## Surfaces

- Command Centre (`moduleKey: agreements`): `/partner-agreements` (hub:
  counters, table, template library), `/partner-agreements/new` + `/:id/edit`
  (the 8-step wizard with live preview), `/partner-agreements/:id` (document
  + action rail + activity/versions/requests/execution tabs). The previous
  register page remains at `/partner-agreements/register`.
- Finance Portal: `/finance/agreements` (Requires Your Attention + history),
  `/finance/agreements/:id` (the agreement room — digital document, accept,
  structured change request, sign, downloads). Single-column on mobile.

## Deploy order (matters)

Migrations are applied by hand and the functions deploy workflow is inert
without `SUPABASE_ACCESS_TOKEN` — only the frontend ships on merge. Safe
order: **migration → edge functions (`manage-partner-agreements`,
`finance-portal-agreements`, `agreement-centre-render`) → frontend.** The
frontend degrades safely against the old function (new actions error with
`unknown_action`), but the new function REQUIRES the migration (new enum
values and tables).
