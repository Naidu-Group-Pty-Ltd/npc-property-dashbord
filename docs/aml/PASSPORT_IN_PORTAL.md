# The Compliance Passport, inside a partner's own portal

**Read this before touching `_shared/aml/partnerSurface.pure.ts`,
`PartnerPassportPanel`, the `enrol_partner_portal_access` operation, or the
`passport` field on `get_partner_compliance_workspace`.**

An emailed link is a delivery. A portal is a place you go back to. A partner
who already holds a portal account should not have to keep an email to re-read
a record they are entitled to rely on — so the Passport is now on their own
AML/CTF Compliance page, in all three portals, signed in.

## Why it had never worked

The machinery for this existed: the routes, the shared workspace, a
session → membership → organisation resolver, and a flag-gated nav entry in
every portal. It had never served a single partner, for **four independent
reasons — each fatal on its own** — plus a fifth that would have failed the
standard even if the first four were fixed.

| # | The fact | What the partner met |
| --- | --- | --- |
| 1 | `aml_partner_compliance_workspace` and all three `aml_partner_workspace_*` were `false` | no nav entry; *"The compliance workspace is not available."* |
| 2 | `aml.partner_portal_memberships` held **zero rows** | 403 `membership_missing`. `upsert_partner_membership` existed as an MLRO op with **no caller anywhere in the UI** |
| 3 | `builder_organisation_id` / `solicitor_firm_id` / `finance_agent_contact_id` were **null on every row** | 403 `partner_org_unmapped`. Declared by the Phase 1 migration and written by **nothing, ever** |
| 4 | `aml_partner_identity` was `false` | nothing ever forced those joins to be correct, so nobody found out |
| 5 | The workspace drew `PartnerPassportStrip` — a one-line identity strip | not the booklet, and the standing rule is that the partner's copy is *identical* |

Fault 2 and fault 3 are the interesting pair. They are the two ends of one
walk, and fixing either alone changes one refusal into a different refusal.
That is why they are now **one operation**.

## The four rules

**The in-portal document is the SAME document.** `get_partner_compliance_workspace`
returns `buildCasePassportView(admin, link.case_id, "partner")` — the same
assembler, the same composer, the same `assertPartnerSafe` boundary that
`redeem_attestation` serves to the emailed link. One record is a property of
having one implementation, not of two implementations agreeing. A
portal-specific projection must never be added: it is how "identical" quietly
stops being true.

**Turning the Passport on NARROWS the page.** The shared workspace carries
eight panels chosen by a static per-portal adapter rather than by a flag, and
several would render and then refuse because their own write flags are off. So
`aml_partner_passport_view` resolves the surface to `passport_only` unless
`aml_partner_workspace_full` is also on:

| passport | full | the page is |
| --- | --- | --- |
| off | off | **full** — today, byte for byte |
| ON | off | the Passport, and only that |
| ON | ON | full, Passport included |
| off | ON | full — today |

The `off/off` row is the safety property: `passport_only` is not reachable by
omission, so a deployment already running the workspace cannot lose panels by
installing this. And the mode is a **mask over the adapter, never a
replacement for it** — every panel resolves as `full && adapter`, so a portal
that never permitted a panel can never acquire one.

**Enrolment maps a REAL portal identity and never re-points a binding.**
`enrol_partner_portal_access` reads the portal organisation from the portal's
own records — the builder membership table the session resolver itself walks,
`solicitor_portal_users.firm_id`, `finance_portal_users.finance_contact_id` —
rather than taking it from the request body, because a body that could name
the organisation could bind a partner to one they do not belong to. If the
canonical organisation already names a *different* portal organisation it
refuses with `portal_org_conflict`: re-pointing would change which partner
every existing portal account speaks for, retroactively, across every matter
they hold. The membership is written `active` immediately — the MLRO has
already decided this partner may rely, and an `invited` state that nothing
promotes is one more silent lock-out.

**Whether the document may be shown is never the page's decision.**
`passportDisclosure` answers it from the grant and the attestation — revoked,
lapsed, superseded, flagged for refresh — in the one module both paths use.
And a withheld Passport **renders its reason**: a partner can be correctly
enrolled, correctly linked and still have nothing to read, and an unexplained
blank area reads as a broken page.

## The access token is gone from the Command Centre

The raw bearer token and the `/passport/<token>` link are the **same
credential** — the link is that token with a URL around it — and the only
consumer in this platform is the public page, which reads it back out of the
URL. Showing it a second time doubled the places a live credential was copied
and invited an operator to send "the code" instead of the link, which is a
defect this product has already had.

If machine access is ever wanted, minting an API credential belongs on the
partner organisation record as a deliberate act with its own audit trail, not
as a by-product of every human hand-over.

## Repairing a partner enrolled before this existed

Nothing back-fills the binding, and nothing should: deriving which builder
organisation a canonical partner means, from a name, is exactly the guess the
session resolver refuses to make. The path is to **re-run the onboarding** for
that partner with the existing organisation and the existing portal contact
selected. Every step is idempotent — the organisation is reused, the
arrangement is reused, an existing case link is accepted — and
`enrol_partner_portal_access` binds whatever is missing and reports it on the
final screen.

## Tests

- `src/lib/aml/partnerSurface.test.ts` — the narrowing, the adapter ceiling,
  the disclosure vocabulary, and that the flags migration is additive.
- `src/components/partner-compliance/__tests__/partnerPassportInPortal.test.tsx`
  — **rendered**, under all three portal adapters: the booklet draws, every
  unreviewed panel is suppressed, full mode is unchanged, and a withheld
  Passport states its reason.
- `src/components/aml/__tests__/partnerOnboardingDelivery.test.tsx` — the
  wizard maps a real portal id, `active`, and a failed enrolment never blocks
  the grant.
