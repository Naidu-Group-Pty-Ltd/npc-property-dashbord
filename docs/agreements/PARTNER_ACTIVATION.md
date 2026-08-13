# Issuing to a partner who cannot sign in yet

Read this before changing anything that decides whether an agreement may be
issued, or that notifies a finance partner.

## The dead end

Step 2 of the agreement wizard showed, under a partner with no portal login:

> This partner has no active Finance Portal login — digital issue will be
> unavailable until they are invited, but the download options always work.

Step 8 then disabled **Approve & send now** and repeated it in four words:
*"Digital issue needs a partner portal login."* The server agreed, with a 422
(`partner_portal_not_connected`).

So onboarding a new partner was: create the contact → build the agreement →
discover at the last step that it cannot be sent → leave it in
`approved_for_issue` → go to the Finance Portal admin section → invite them →
wait, possibly days, for them to accept → come back and find the agreement.
Seven steps, and the sentence that started it offered no way to do the one thing
that would unblock it.

## Why nothing needed to be invented

An agreement is addressed to `finance_agent_contact_id` — the partner
**organisation**. The portal resolves what a partner may see by that same id:

```ts
// finance-portal-agreements
.eq('finance_agent_contact_id', financeContactId)
.in('status', PARTNER_VISIBLE_STATUSES)
.not('issued_at', 'is', null)
```

A login is a separate thing: a **person** who can sign in. So an agreement
issued before anybody has a login is *already addressed correctly*. It is
unread, not misfiled. The moment a portal user exists for that contact and signs
in, the existing query finds it with no migration, no backfill and no new state.

That is why "dormant" is **derived, never stored**. The lifecycle status already
says what stage the agreement is at; whether the counterparty can currently
reach it is an independent fact that changes when the partner activates rather
than when the agreement moves. A column would go stale the moment somebody
accepted an invitation.

## `is_active` never meant what everyone read it as

`finance-portal-invite` sets `is_active: true` **when the invitation is sent** —
before the partner has done anything, with `password_hash` still null. So
`is_active` means "not revoked", and every caller that read it as "can sign in"
was wrong in both directions:

- the wizard's badge said **Portal connected** for somebody who had never opened
  the email;
- `notifyPartner` filtered on it, and therefore *would* have written to an
  invited user — but the issue route refused to get that far.

Signing in needs a credential. [`partnerAccess.pure.ts`](../../supabase/functions/_shared/agreements/partnerAccess.pure.ts)
is the one place that says so, and it has four answers rather than a boolean:

| State | Means | Digital issue |
|---|---|---|
| `none` | no portal user row | **proceeds** — waits for them |
| `invited` | row exists, no credential | **proceeds** — waits for them |
| `active` | credential, not revoked | proceeds |
| `revoked` | access affirmatively withdrawn | **refused** |

Only `revoked` blocks, and it is the one state somebody *chose*. Issuing into it
would quietly contradict that decision instead of surfacing it, so the refusal
names reinstatement rather than suggesting the download path as though the
partner were merely un-onboarded.

## The notification could not survive, and had to

A portal notification is a row keyed to `portal_user_id`. Issued to a partner
with no portal user, `notifyPartner` found nothing to address and returned —
silently and deliberately, so notification delivery could never break a
lifecycle action. Correct as far as it went, and it meant the announcement was
gone for ever: the partner activated days later and arrived at an empty inbox
with a live agreement in their list.

Letting the document go first turns that from an edge case into the normal path.
Two changes:

- **`invited` is addressable.** The row exists, so the notification has
  somewhere to live and the partner meets it on first sign-in.
- **Activation looks back.**
  [`pendingDelivery.ts`](../../supabase/functions/_shared/agreements/pendingDelivery.ts)
  runs on invite-acceptance *and* on login — the second covers the
  temp-password path, which never visits `accept-invite`, and any agreement
  issued between an invitation and the first sign-in.

It is a **sweep, not a queue**. The agreements already are the queue: contact
id, `issued_at` and a partner-visible status completely describe what is
waiting, and that stays true if an insert fails or a row is voided before anyone
sees it. An outbox table would be a second copy of the same truth, free to
disagree with it. The sweep asks what is waiting, subtracts what this user has
already been told, and inserts the difference — so running it on every login
costs one indexed read and inserts nothing twice.

It writes its own notification type, `agreement_awaiting_you`, rather than
reusing `agreement_issued`: this is not the moment of issue, it is the moment
the partner became able to receive it, and a timeline that says "issued" today
about a document issued last week is a small lie with compliance consequences.

## AML/CTF is already the gate, and stays the gate

Nothing here weakens it. `FinancePortalProtectedRoute` routes a partner through
password rotation → the **Portal Access, Confidentiality, Privacy and AML/CTF
Compliance Passport Agreement** → onboarding, before the portal layout mounts at
all. Acceptance is version-aware, so a partner who accepted a superseded version
is sent back through it.

A partner who activates against a waiting agreement therefore reads and accepts
the AML/CTF agreement *before* they can open it — including the
`binding_amlctf_arrangement` acknowledgment, which is the s37A / rule 6-29
reliance arrangement. The destination travels with them through the gates
(`state.from`), so the deep link they arrived on is where they land afterwards.

## What each surface now says

- **Wizard step 2** — the state, what it means, and the invitation itself.
  `none` and `invited` are deliberately not presented as problems.
- **Wizard step 8** — *"Approve & send — waits for them"*, above a sentence
  saying the agreement is held in their portal and announced on activation.
  Only `revoked` disables it.
- **The register** — an issued agreement reads "Partner Review" whether the
  partner is reading it or cannot sign in to reach it. `Awaiting activation`
  under the badge is the difference between a partner who is slow and one who
  was never able to open the document.
- **The agreement page** — the same, with the invitation attached.

## Shipping

Edge Functions, so [`DEPLOYMENT.md`](./DEPLOYMENT.md) applies. Four deploy
together: `manage-partner-agreements` (the gate and the reported state),
`finance-portal-accept-invite` and `finance-portal-login` (the sweep), and
`finance-portal-agreements` shares the module. No migration; nothing to
backfill — the sweep picks up anything already issued the next time each partner
signs in.

Deploy order matters in one direction only: a bundle newer than the functions
offers the send and gets the old 422, which
[`apiErrors.pure.ts`](../../src/lib/agreements/apiErrors.pure.ts) already
translates into "the Edge Functions have not been deployed".
