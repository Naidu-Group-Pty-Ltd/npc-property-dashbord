# Getting the agreement to the partner

Read this before changing how an agreement is issued, sent or notified.

## Two faults, one symptom

Reported as: *the partner never got the notification, and there is no way to
resend.* They turned out to be independent.

### 1. The notification feed was returning 500 for everybody

`finance-portal-notifications` filters **every** read and mutation on three
routing columns:

```ts
.eq('target_portal', 'finance_portal')
.eq('notification_domain', 'finance')
.eq('command_centre_authorised', true)
```

Those columns come from
`20260717000000_restrict_finance_portal_notification_routing.sql`. It was
merged. It was never applied — migrations here go out of band
([`DEPLOYMENT.md`](./DEPLOYMENT.md)) and this one did not.

PostgREST answers a filter on a missing column with `42703` **for the whole
statement**. Not an empty set: an error. So `list`, `unread_count`, `mark_read`
and `mark_all_read` all returned 500, for every partner, for every notification
type, from the day the function deployed.

Measured against production before the fix:

| | |
|---|---|
| notifications in the table | **238** |
| unread | **236** |
| readable through the portal | **0** |

The agreement notification was among them, addressed to the right partner, with
the right link, written the moment the agreement was issued. Nobody could ever
have seen it.

### 2. Issuing sent no email at all

`issue_to_partner` wrote one in-app notification and stopped. For a partner
already working in the portal that is a reasonable signal. For a broker who was
added ten minutes ago, has never logged in, and is not expecting anything, it is
no signal whatsoever — and the Command Centre reported "issued".

Combined with the first fault, an issued agreement reached the partner through
no channel at all.

## The routing fix, and why it is not just "apply the migration"

The migration should be applied, and it is verified to apply cleanly (0 rows
quarantined, 0 constraint violations against current data). But a boundary that
exists **only** in columns is one a deploy can silently switch off, and this one
did, for three weeks, with no error surfaced to anybody.

The same policy is derivable from the notification's own type, which the table
has always had. So it is stated once in
[`financeNotificationRouting.pure.ts`](../../supabase/functions/_shared/financeNotificationRouting.pure.ts)
and enforced whichever shape the table is in:

- the function probes once per cold start for `target_portal`;
- columns present → the **column filter**, because it is stricter (it catches a
  row whose type looks fine but whose routing was set wrong);
- columns absent → the **equivalent type filter**, the migration's own
  quarantine list;
- either way, `portal_user_id` is filtered unconditionally. That is the boundary
  that keeps one partner's notifications away from another and it was never in
  question.

Two rules in that module worth keeping:

- **An inconclusive probe keeps the strict path.** Only `42703` downgrades. A
  permissions error or a network blip must never be read as "the migration is
  missing", because that would quietly loosen a boundary on a database that has
  it.
- **The quarantine list must match the migration's.** A test asserts both
  directions. Two expressions of one policy only work while they say the same
  thing.

It self-heals: the moment the migration lands, the probe sees the column and the
strict filter takes over with no code change.

## Sending

`issue_to_partner` now emails the partner as well as notifying the portal —
best-effort, and reported back as `email_sent` / `email_error`. An email that
did not send must never roll back an issue that did, so the failure is surfaced
rather than thrown.

**Send / Resend** is a new `send` operation on `agreement-centre-render`, not on
`manage-partner-agreements`. Same reason as every other document operation:
it attaches a PDF, which is seconds, and lifecycle actions stay milliseconds.

It takes additional recipients, an optional covering note, and a flag for
whether to re-raise the portal notification. What it does:

1. resolves recipients (below);
2. resolves the issued artefact through `resolveVersionArtefact`, so the
   attachment is the **current-revision render of the frozen version** — the
   same bytes the Issued PDF download hands over, never a re-render of the live
   row (see [`DOCUMENT_REVISIONS.md`](./DOCUMENT_REVISIONS.md));
3. emails it;
4. optionally re-raises the notification;
5. writes an `agreement_sent` event carrying the recipients, whether the PDF
   attached, and whether the email left.

A renderer outage does not stop the send — the email still carries the portal
link, which is the actionable half.

### Why the PDF is attached rather than linked

A portal link is useless to a partner who has not activated yet, and a signed
storage URL expires in five minutes — long enough for a click, not for an email
read tomorrow morning. The attachment is also what a broker's compliance team
files. The link still travels with it, because review, change requests and
execution all live in the portal and an attachment cannot do any of them.

### Recipients

[`recipients.pure.ts`](../../supabase/functions/_shared/agreements/recipients.pure.ts),
shared by the dialog and the server so what the UI promises and what the send
does cannot disagree.

The distinction it exists to hold: the partner contact is a **party** and is not
the operator's to remove; everyone else is a **copy** and is entirely theirs. A
copy going to the practice manager does not change who the agreement is
addressed to.

- Parsing is forgiving — commas, semicolons, newlines, tabs, and `Name <addr>`
  unwrapped, because that is what pasting out of Outlook produces.
- Validation is not. A malformed address **blocks the send** and is named. A
  compliance copy that silently never went is worse than a send that refused.
- De-duplication is case-insensitive against the primary and the other extras.
  Technically the local part is case-sensitive; no provider in use treats it
  that way, and sending a partner two copies is the worse error.
- Ten extras, capped, with the overflow named rather than dropped silently.

## Shipping

Edge Functions, so [`DEPLOYMENT.md`](./DEPLOYMENT.md) applies. Three deploy
together: `finance-portal-notifications` (the feed fix),
`agreement-centre-render` (the send operation) and `manage-partner-agreements`
(the issue email).

**Also outstanding:** migration `20260717000000` has never been applied. Nothing
here needs it — the code works either way — but until it is applied the strict
routing boundary is not enforced at the database level and the columns the
function prefers do not exist. It is verified to apply cleanly against current
data.

`RESEND_API_KEY` must be set for any email to leave; without it the send reports
`RESEND_API_KEY not configured` rather than claiming success.
