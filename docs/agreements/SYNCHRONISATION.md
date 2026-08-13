# Keeping the two portals in step

> Read this before changing anything that polls, invalidates or reports the
> state of an agreement across the Command Centre / Finance Portal boundary:
> `_shared/agreements/syncStamp.pure.ts`, `_shared/agreements/portalReceipt.pure.ts`,
> `src/hooks/useAgreementSync.ts`, or the `sync` operation on either edge
> function.

## The report, and what it actually was

> "The Finance Portal is not receiving agreements issued from the Command
> Centre."

It receives them. Every step of the pipeline was measured against production
before a line was changed, and every one of them was correct:

| Check | Result |
| --- | --- |
| Agreement issued 12 Aug 16:22:15 | `first_viewed_at` 16:22:26 — **11 seconds**, end to end |
| Agreement issued 13 Aug 13:30:52 | `first_viewed_at` null; the partner's last login was 12:11, **79 minutes before the issue** |
| `agreement_issued` notifications | 5 rows, all `target_portal='finance_portal'`, `notification_domain='finance'`, `command_centre_authorised=true` |
| Notification addressing | correct `portal_user_id`, correct `link_path` (`/finance/agreements/<id>`) |
| Partner mapping | every issued agreement's `finance_agent_contact_id` resolves to exactly one portal user |
| `issued_version_id` | set on every issued row |

So the delivery layer is not the defect. **The defect is that nothing on either
side ever asked again.**

Every agreement surface fetched exactly once, on mount:

- the partner's inbox (`FinancePortalAgreements`) — no interval, no focus refetch;
- the partner's agreement room (`FinancePortalAgreementDetail`) — the same;
- the Command Centre register and detail — the same;
- and the only thing in either portal that polled at all was the notification
  bell's unread **count**, which moves a badge and refreshes no agreement view.

Which produces exactly the reported experience: issue in the Command Centre,
switch to a Finance Portal tab that has been open since breakfast, and the
agreement is not there — because that tab last spoke to the server hours ago.
From the outside that is indistinguishable from an agreement that never
arrived. The same gap runs the other way: a partner accepts, and the register
keeps saying "Awaiting partner review" until somebody reloads.

## Why not Supabase Realtime

Because the Finance Portal cannot use it, and the reason is structural rather
than an oversight.

The partner authenticates with a bespoke session token
(`x-finance-session-token`), resolved server-side by
`_shared/finance-portal-session.ts`. It is **not** a Supabase JWT. Every
agreement table is service-role only — `partner_agreements`,
`partner_agreement_versions`, `partner_agreement_change_requests` and
`partner_agreement_signatures` all carry a `..._service_role_only` RLS policy.
So the partner's browser has no authenticated socket and no row-level read
path; `postgres_changes` is not available to it.

Making it available would mean handing the partner's browser a Supabase
credential and opening RLS on the agreement register. That is a materially
larger attack surface than a twenty-second poll, for a workflow measured in
minutes.

## What replaced it: a stamp

The expensive part of polling is the payload, not the request. So both portals
poll a **stamp** — four scalars describing what the viewer can see — and refetch
the real payloads only when the stamp moves.

```ts
interface AgreementSyncStamp {
  count: number;          // agreements visible to this viewer
  latest: string | null;  // max(updated_at) across them
  openRequests: number;   // open change requests
  attention: number;      // how many need THIS viewer to act
}
```

Four scalars rather than a hash, deliberately: this gets compared, logged and
read aloud during support, and knowing *which* one moved is worth more than an
opaque digest.

Each of the four exists because something real moves only it:

- **`count`** — an agreement arriving. Nothing else changes when a partner is
  sent their first document, and a `latest`-only cursor gets that case wrong
  because there is no previous timestamp to compare against.
- **`latest`** — any field or status edit. `partner_agreements` has a
  `BEFORE UPDATE` touch trigger, so this catches everything the row records,
  including `first_viewed_at`.
- **`openRequests`** — a partner raising a change request against an agreement
  already in `sent_for_signature` (which does **not** change the status), and an
  issuer resolving one.
- **`attention`** — drives the badge without fetching the list.

### Rules that keep biting

**A null previous stamp is not a change.** The first poll is a baseline;
treating it as a move would make every mount invalidate the queries it has just
fetched, doubling the cost of opening any agreement page. Same for a null
current stamp — a failed poll is not news.

**Attention is not symmetric.** `PARTNER_ATTENTION_STATUSES` and
`ISSUER_ATTENTION_STATUSES` are disjoint and a spec asserts it.
`changes_requested` belongs to the **issuer**: the partner asked us a question,
and putting an ACTION REQUIRED banner in front of somebody who is waiting on us
is the exact failure `AgreementActionCard` was written to avoid.

**The stamp must count what `list` returns.** The partner's `sync` applies both
halves of `isPartnerVisible` — `PARTNER_VISIBLE_STATUSES` **and**
`issued_at is not null` — because a cursor that moves on something the viewer
cannot see refetches for nothing, for ever.

## Where the polling happens

| Surface | Cursor | Scope |
| --- | --- | --- |
| `FinancePortalLayout` | `useFinanceAgreementSync()` | the partner's whole organisation |
| `FinancePortalAgreements` | same query key → **one** poll | " |
| `FinancePortalAgreementDetail` | same query key → **one** poll | " |
| `AgreementCentre` (register) | `useAgreementCentreSync()` | the working list |
| `AgreementCentreDetail` | `useAgreementCentreSync(id)` | that one agreement |

The Finance Portal cursor is deliberately **not** keyed on an agreement id: the
endpoint computes an organisation-wide stamp either way, so keying per agreement
would run a second identical poll on every detail page. One key means React
Query shares the fetch and the interval, while each hook instance still runs its
own `onChange` — which is where the per-page invalidation lives.

The Command Centre cursor **is** keyed on the id, because the server-side stamp
really is different: a partner accepting agreement A must not pull the page out
from under somebody reading agreement B.

### What makes it cheap

- **Hidden tabs do not poll.** `refetchIntervalInBackground` is left at its
  `false` default, so React Query pauses the interval whenever the document is
  hidden — which is most tabs, most of the time.
- **`refetchOnWindowFocus: true` and `staleTime: 0` are set explicitly**, both
  against the app's global defaults (`App.tsx` sets `refetchOnWindowFocus:
  false`, `staleTime: 30_000`). This is the half that actually fixes the
  reported scenario: switching to the tab syncs immediately. Without
  `staleTime: 0` the focus refetch is served from cache and the tab-switch case
  stays broken. **Do not "tidy" either of these away.**
- **One retry, fixed delay.** A backed-off retry storm behind a flaky network
  would poll harder than the interval it is meant to respect.

`AGREEMENT_SYNC_INTERVAL_MS` is 20s. The interval is deliberately uncritical —
the focus listener is what anybody actually looking gets.

### Deployment skew

Both wrappers notice a function deployed before the operation existed
(`unknown_action` / "Unknown operation"), stop polling, and leave the page with
the manual Refresh button it had. A cursor that 500s every twenty seconds for
ever is worse than no cursor: it buries the log that would explain a real
failure. Nothing is shown to the user, because nothing has broken for them.

## The other half: proving it arrived

Issuing does four things, and three are best-effort by design — freeze the
version (must succeed), render the PDF (deferred to first download), email the
partner (**reported**), raise an in-portal notification (**was silent**).

`notifyPartner` catches its own errors so a notification failure can never roll
back an issue. Correct — and it then returned `void`, so the Command Centre said
"issued to the partner portal" whether or not anything reached the portal. A
real failure and a healthy issue produced the same sentence.

It now returns a `PartnerNotifyOutcome` (`delivered` / `deferred` / `failed`),
`issue_to_partner` returns it as `portal_notify`, a `failed` outcome writes a
`portal_notification_failed` event, and the toast becomes a warning naming the
remedy. The `get` action returns a `portal_receipt`
(`portalReceipt.pure.ts`) computed from the notification count, the partner's
access and `first_viewed_at`:

| State | Meaning |
| --- | --- |
| `not_issued` | nothing to have received |
| `opened` | the partner's own browser has fetched it — the strongest evidence there is |
| `notified` | a notification is waiting in their feed, unopened |
| `awaiting_activation` | issued to a partner with no login yet; held, not lost |
| `unnotified` | **issued, they can sign in, and nothing ever told them** |

`unnotified` is the whole point of the five states. Separating it from
`awaiting_activation` is what turns "the agreement never arrived" from a
support conversation into a banner with a button.

Two rules here:

**Receipts are counted on `metadata->>agreement_id`, not `related_entity_id`.**
The column would be the tidier join and is **null on every agreement
notification in production**; the metadata key is set by all three writers (the
issue path, the send/resend path in `agreement-centre-render`, and the
activation sweep in `pendingDelivery.ts`). Switching to the column would report
zero for everything and light the `unnotified` banner on every healthy
agreement.

**An unknown receipt is not a failed one.** `countPortalNotifications` returns
`null` rather than throwing, the server sends `portal_receipt: null`, and the UI
renders nothing. A detail page that 500s because a receipt could not be counted
is a worse outcome than a receipt that says nothing, and an absent field on an
older deployment must never read as a fault.

## What this change did not touch

Nothing in the delivery path. No lifecycle transition, no notification write, no
email, no render, no storage path, no RLS policy, no migration. The `sync`
operations are additive; every existing operation on both functions behaves
exactly as before. The one behavioural change to an existing path is that
`notifyPartner` now returns its outcome instead of discarding it — the insert,
its error handling, and its refusal to break the lifecycle action are unchanged.

## See also

- [`SENDING.md`](./SENDING.md) — getting the document to the partner (email + the
  three-week notification-feed outage)
- [`PARTNER_ACTIVATION.md`](./PARTNER_ACTIVATION.md) — issuing to a partner who
  cannot sign in yet, and the activation sweep
- [`ANNOTATIONS.md`](./ANNOTATIONS.md) — pinned change requests, which the
  cursor now delivers to the issuer's live preview without a reload
- [`DOCUMENT_REVISIONS.md`](./DOCUMENT_REVISIONS.md) — what an issued version
  freezes, and what the stored PDF is
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — the migrations-and-functions gap that has
  bitten this area twice
