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
| 6 | `create_agreement` never accepted a `partner_org_id`, so every wizard-written arrangement had **NULL** there — and `grant_access` stamps a grant only `if (agreement.partner_org_id)` | the portal looks a grant up **by organisation**, so it reported a Passport the partner held as *never shared* |
| 7 | Nothing offered a route from the emailed link to the portal, and two of the three logins **discarded the destination** | *"I cannot see anywhere the AML/CTF Compliance page is located"* |

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

## From the emailed link to the portal

A link is a delivery; a portal is a place you go back to. `redeem_attestation`
now returns a `portal_handoff` and the page renders **View in your portal**,
and the grant email carries the same offer — which is where a recipient
decides whether to keep the message at all.

Three rules carry that half.

**A door that refuses is worse than no door.** The offer appears only when the
surface is enabled *and* the organisation has an active membership somebody
could sign in with. Sending a partner to a page that answers *"your account is
not enrolled"* is worse than the link they already have: it reads as a broken
product rather than an unconfigured one. All three "unavailable" reasons —
`no_portal`, `surface_disabled`, `not_enrolled` — render nothing at all,
because each of them describes *our* configuration, not the partner's business.

**A deep link is a destination, never a credential.** The path carries
`?matter=<partner_case_link_id>`, which identifies a matter and grants
nothing: the portal session re-derives the organisation and a matter belonging
to somebody else is simply absent from the directory. The Passport token must
never appear in a portal URL — a bearer token in an address bar survives in
history, referrers and screenshots. A matter the partner no longer holds falls
through to their compliance page rather than to an error.

**A destination survives the login, and only an internal one.** The Builder
guard recorded `location.pathname` and dropped the query string, then its
login ignored the record entirely and always landed on the dashboard; the
Solicitor guard recorded nothing at all. Finance was already correct and is
the reference implementation. `returnToPath` and `safeReturnTo` are now one
rule for all three — and `safeReturnTo` refuses anything absolute,
protocol-relative or carrying a control character, because an open redirect on
a login page is a phishing primitive and the person who has just typed their
password is exactly the one you can send anywhere.

## The pointer that made every grant unreachable

`grant_access` stamps `partner_org_id` on a grant only when the **arrangement**
carries one, and `create_agreement` only ever recorded a free-text
`partner_org_name`. So the written arrangement and the canonical organisation
were two records that never pointed at each other, every grant the onboarding
wizard produced carried NULL, and `loadOrgGrantAndAttestation` — which looks a
grant up **by organisation** — answered "no grant" for a partner who plainly
held one.

Three parts fix it, and none of them guesses:

- `create_agreement` accepts a `partner_org_id`, validated for existence,
  status and a **matching organisation type** — an arrangement that names one
  kind of partner and points at another is a mapping error that would surface
  as a disclosure.
- `bind_agreement_organisation` repairs an existing arrangement. It is an
  explicit MLRO act on two named ids, never a name match (two organisations
  may lawfully share a name — that is what the mapping review is for), and it
  **binds once and refuses to re-point**: re-pointing silently moves every
  grant that arrangement has ever issued.
- The **read** path accepts either explicit route — the grant's own column, or
  its arrangement's. Two queries rather than one interpolated `.or()`, which
  is the defect class this codebase has a contract test for.

## Turning it on

`20260828140000_aml_enable_partner_passport_surface.sql` enables the master
switch, all three surface flags and `aml_partner_passport_view`, and
**deliberately leaves `aml_partner_workspace_full` off** — asserted with a
`RAISE EXCEPTION` rather than assumed, because enabling it there would be a
silent rollout of seven unreviewed panels. It touches no write flag: a partner
reads, and records nothing. Reversible by setting the five keys back to false.

The nav entry is now called **AML/CTF Compliance** in all three portals — the
same words the email and the Command Centre use, so a partner following an
instruction finds what they were told to look for.
