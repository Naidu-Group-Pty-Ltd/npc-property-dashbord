# The Partner Portal Agreement

One agreement, three portals: Solicitor, Builder/Developer and Finance.

The **Portal Access, Confidentiality, Privacy and AML/CTF Compliance Passport
Agreement** binds "the Partner Organisation" — a solicitor's practice, a builder,
a finance partner alike. Read this before touching anything that presents terms,
records an acceptance, or adds a portal.

## The rule

**The document is data, not code.** It lives in `portal_terms_versions`, one row
per portal, and is rendered from `content_markdown`. No page restates it. A page
carrying its own copy of the words would eventually disagree with the version the
acceptance is recorded against, and the acceptance record would then name a
document nobody read. That is exactly what the Finance Portal did until
2026-08-07 — `buildTermsBody(brand)`, compiled into the bundle, with no version
and no hash.

**One row per portal, not one row shared.** Acceptance is an act by a named
person in a named portal; the audit trail has to say which. Each portal
therefore carries its own version, its own `document_hash` and its own
acceptance history — but the text is generated from the solicitor version rather
than retyped, and `20260901000700` asserts all three are byte-identical after it
runs.

## Where each piece lives

| Concern | File |
| --- | --- |
| The four mandatory acknowledgments (client) | `src/lib/portalAgreement.ts` |
| The four mandatory acknowledgments (server) | `supabase/functions/_shared/portalAgreement.ts` |
| The consent wall every portal renders | `src/components/portal/PortalAgreementConsent.tsx` |
| Solicitor page / Builder page / Finance gate | `src/pages/solicitor/SolicitorTerms.tsx`, `src/pages/builder/BuilderTerms.tsx`, `src/components/finance-portal/FinancePortalOnboardingGate.tsx` |
| Acceptance endpoints | `solicitor-portal-verify`, `builder-portal-verify` (via `builder_accept_current_terms`), `finance-portal-verify` |
| The published document | `supabase/migrations/20260901000600` (solicitor) and `20260901000700` (cascade) |

The two acknowledgment lists must agree. Changing a key in one without the other
locks every partner out of every portal — both files carry that note, and
`tests/cross-portal-contracts/partner-agreement-cascade.test.mjs` fails if they
diverge.

## Changing the agreement

Section 16 of the agreement sets the procedure, and the schema enforces it:

1. **A new version, never an edit.** Acceptances are keyed to a version id;
   rewriting a row restates what its signatories agreed to. Retire the old row.
2. **A new document hash.** `document_hash` is derived by trigger from
   `content_markdown` on every write — never supplied by the writer — so a
   published version cannot carry the hash of a different document.
3. **A fresh acceptance.** `has_accepted_current_terms` is derived per request by
   looking for an acceptance against the *current* version, in all three portals.
   Publishing re-gates everyone; that is the intent, not a side effect.
4. **Generate the new text, don't retype it.** Both existing amendments were
   produced by transforming the previous migration's `$md$` body with a script.

Removing a required acknowledgment is safe to ship in any order — an older bundle
sends more keys than are required and only the required ones are looked for.
Adding one is not: the pages must ship first.

## Acceptance is refused without the acknowledgments

Every `*-portal-verify` refuses an acceptance missing any required key
(`ACKNOWLEDGEMENTS_INCOMPLETE`, 400) and stores the asserted keys in
`portal_terms_acceptances.acknowledgements`. The tick boxes are not an interface
gate: each is a contractual statement — authority to bind, the section 37A
arrangement — and an acceptance recorded without them would claim assent nobody
gave.

A fifth acknowledgment, "Independent AML/CTF responsibility", was withdrawn by
the operator in version 2026-08-07. Only the tick box went: section 9 still puts
assessing, approving, recording and re-checking reliance on the Partner
Organisation, and section 7 still makes statutory reliance conditional.

## Deploying a change here

Three parts ship separately, and **merging is not deploying**:

- **Migrations** — nothing in this repo applies them. `supabase db push`, or ask.
- **Edge functions** — `deploy-supabase-functions.yml`, which is opt-in by the
  `SUPABASE_ACCESS_TOKEN` secret. Without it the workflow reports what it *would*
  deploy and goes green, which is how the acknowledgment gate sat unshipped for a
  day while the page in front of it was live.
- **The frontend** — the site build.

The safe order is migration → functions → frontend. A published version with no
way to store an acceptance gates a portal on an agreement nobody can accept.
