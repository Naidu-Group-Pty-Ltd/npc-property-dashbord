# Templates, not agreements

> Read this before adding anything to `_shared/agreements/`, before restoring
> a deleted module from history, and before wiring an agreement into referrals,
> commissions or compliance. `agreementTemplatesOnly.spec.ts` enforces it.

## The decision

The platform used to run the whole formation of a partner referral/commission
agreement between two independent businesses:

| Stage | What the platform did |
| --- | --- |
| Draft | a guided wizard over a locked template |
| Internal review | approve / return, recorded |
| Issue | froze a version, stored a PDF, put it in the partner's portal |
| Review | partner accepted, or pinned change requests to clauses |
| Amend | issuer answered in place and reissued |
| Execute | typed signature from both sides, IP and user-agent hashed |
| After | executed master stored, status tracked, both portals synchronised |

**That has been retired.** Facilitating, recording and stepping through the
formation of a contract between two other parties made the platform look like a
participant in — and arguably a party to, or a service provider warranting — a
commercial relationship it has no part in. The instruments are real ones under
Australian credit law: licence and credit representative numbers, aggregator
terms, AML/CTF obligations. The platform is not in a position to stand behind
any of it.

What replaces it is narrow and deliberate: **the two templates remain as
optional resources either party may download, adapt and use — or ignore.**

## The rule

> Downloading a template is the end of the platform's involvement.

Nothing is issued, accepted, executed or tracked. Nothing is stored about
whether two parties reached an agreement. The wording that says so lives in
`_shared/agreements/templateResource.pure.ts` and is rendered from there by
every surface, so the Command Centre and the Finance Portal cannot come to say
different things about what a download means.

## What that looks like in the architecture

**One component, both portals.** `AgreementTemplateResources` is rendered by
the Command Centre page and by the Finance Portal dashboard. Two
implementations would drift, and the first thing to drift would be how firmly
each side is told the platform is not involved.

**The Word file is built in the browser.** `templateDownloads.ts` calls
`buildAgreementDocx` directly — no request is made, so there is no server-side
record that a template was taken, by whom, or for which partner. The platform
cannot report on something it never observed. That is also what lets the
partner have exactly the same downloads as the issuer without a partner-facing
render endpoint.

**No brand on the partner's copy.** The Command Centre applies the tenant's
colour and mark; the Finance Portal applies none. A blank template stamped with
one side's identity reads as that side's prepared offer rather than a neutral
starting point.

**The document no longer claims the platform.** `documentHtml.pure.ts` used to
print *"Generated securely through Aurixa Systems"* behind a
`showPlatformAttribution` flag. The flag is now inert.

## What was removed

Three Edge Functions — `manage-partner-agreements`, `finance-portal-agreements`
and `agreement-centre-render` — with their `config.toml` declarations and
registry entries. Eleven shared modules: the lifecycle state machine, partner
access, recipients, annotations, the sync cursor, the portal receipt, document
revisions, the renderer, the issue email, the activation delivery sweep and the
anchor probe. On the client: the register, the wizard, the detail workspace,
the legacy register, the partner inbox, the agreement room, the action card and
their hooks.

Nine template modules remain, and the spec asserts that list exactly.

## What was deliberately NOT removed

**The data.** `partner_agreements` and its five companion tables still hold 6
rows, 5 of which were issued and 1 of which a partner opened. **Nothing was
ever executed** — 0 signatures, 0 executed versions, 0 active agreements — so
no contract was formed here that needs preserving for enforceability. The rows
are kept anyway, because destroying the record of what the platform did is
irreversible and is its own decision to take advice on, and because keeping
them costs nothing now that no code path writes to them.

**Portal Access / AML-CTF Compliance Passport agreements.**
`partner-agreement-records` covers the terms partners accept to *use the
portal*. Those are Aurixa's own agreements with its own users — not a contract
between two independent parties — and they are untouched.

**Agency agreements.** `manage-agency-agreements` and the `agency_agreements`
table are a different feature (agency ↔ client) and are untouched.

**`referrals.agreement_id`.** The column survives on historical rows; nothing
resolves it any more.

## Dependencies that were severed, and how

`manage-partner-referrals` stopped reading `partner_agreements` in all four
places: the governing-agreement join on `get`, the version snapshot on
`create`, the fee summary in the consent statement, and
`list_active_agreements` — which now returns `{ agreements: [] }` **without a
query**. The action is kept rather than deleted so a browser running an older
bundle gets an empty picker instead of `unknown_action`, which would surface as
an error toast on a page that is otherwise working. This coupling was already
inert in production: it filtered on `status = 'active'`, of which there were
zero.

`finance-portal-login` and `finance-portal-accept-invite` no longer sweep for
undelivered agreement notifications.

`PartnerCompliance` holds an empty agreement list rather than losing its
termination panel and incident linkage, which are compliance features in their
own right.

## Old links

Every retired route redirects instead of 404-ing, because the links are in
bookmarks, emails and activity trails, and a 404 reads as a fault:

| Was | Now |
| --- | --- |
| `/partner-agreements` | the template desk (kept, repurposed) |
| `/partner-agreements/new`, `/register`, `/:id`, `/:id/edit` | → `/partner-agreements` |
| `/finance/agreements`, `/finance/agreements/:id` | → `/finance` (dashboard) |

"Agreements" is gone from the partner's navigation: templates are a resource on
the dashboard, not a destination that still looks like an inbox.

## If this is ever reversed

Everything is in git. But note what the removal actually bought: the neutral
position is now **structural** rather than a setting. Hiding the workflow
behind a flag would have left `issue_to_partner` live and the tables still
recording — the platform still doing the thing, just undiscoverably, which is
worse in a due-diligence conversation than doing it in the open.
