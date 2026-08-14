# An agreement is never nowhere

> Read this before changing the register's stage counters, the empty states in
> `AgreementCentre.tsx`, `dashboardGroupForStatus` / `stageToFollow` /
> `isIssued` in `lifecycle.pure.ts`, or anything that decides which agreements
> a surface lists.

## The report

> An agreement is issued and deployed to the Finance Partner Portal, and once
> that happens it disappears from the originating portal.

## What was measured before anything was changed

A disappearance has several very different causes and only one of them is a
display fault, so the data layer was checked first.

| Check | Result |
| --- | --- |
| The row itself | present; `archived_at` null, `voided_at` null, status `partner_review` |
| `manage-partner-agreements` `list` | returns **4 rows** for the register, including **both** issued agreements |
| Event timeline | created → pending_review → approved → **issued** → **partner_viewed** → emailed, unbroken |
| Partner side | the partner (`Arweeeeen`) opened it the next morning at 06:09:28 |
| Every Command Centre API call in the window | **200**, no 4xx, no 5xx |
| `PARTNER_VISIBLE_STATUSES` | covers every post-issue status, including `withdrawn`/`void` |
| Partner inbox JSX | renders **both** the attention section and the history section |

So nothing is deleted, nothing is hidden by the API, nothing is lost between
the portals, and the partner-side list does not drop it either. **The
disappearance is real, and it is in the register's own filtering.**

## What actually happens

The Command Centre register partitions itself **by status** — nine counters
above the table, each a status bucket — and issuing an agreement changes its
status.

1. You stand on **Ready to Issue**. It is the natural place to be: it is the
   only stage whose primary action is *"Send to Finance Partner"*.
2. You issue. The row moves `approved_for_issue → partner_review`.
3. The stage filter is React state. It does **not** move with the row.
4. The stage you are standing in empties, and renders:

   > **Nothing in this stage**
   > Create an agreement to take it through internal review, issuance to the
   > partner portal, and execution…
   > **[ Create Agreement ]  [ Templates ]**

To somebody who has just issued an agreement, that heading and that button are
indistinguishable from the agreement having been destroyed. One empty state
served both "a filter is hiding everything" and "you have no agreements", and
those are opposite facts.

Two things made it sharper recently. The cross-portal **sync cursor**
([`SYNCHRONISATION.md`](./SYNCHRONISATION.md)) polls every 20 seconds, so the
stage can now empty with nobody touching anything. And **nothing in the product
ever said the word "Issued"** — `AGREEMENT_STATUS_LABELS` goes straight from
"Ready to Issue" to "Partner Review", so after issuing there was no
confirmation anywhere in the register that the thing had been sent.

## The fix

**The filter now consults the lifecycle module.** `AGREEMENT_DASHBOARD_GROUPS`
was a presentation array the register searched by hand, so nothing could answer
"which stage is this row in now" and nothing could notice a status belonging to
no stage at all. `dashboardGroupForStatus` is that mapping, derived from the
groups rather than restated, and `agreementStagesCoverEveryStatus` is asserted
in a spec — a status added to the lifecycle can no longer become invisible
under every filter but "All".

**A row that changes stage says where it went.** `stageToFollow` names the
destination; the register watches the stage you are standing in and, when
something leaves it, shows *"<partner> moved on to Partner Review. It is still
in the register — this stage no longer holds it."* with **Open agreement** and
**Show all**. Suppressing the movement was the alternative and it is worse: it
would show an agreement filed under a stage it is not in.

**An empty stage can no longer claim the register is empty.** When
`filtered.length === 0` but `agreements.length > 0`, the empty state says how
many agreements are at other stages and offers only a way out of the filter.
The Create Agreement prompt is reserved for a register that genuinely holds
nothing.

**Issuance is legible, and it is a fact about the row.** `isIssued` reads
`issued_at`, never a status — a withdrawn or voided agreement *was* issued, the
partner saw it, and the register has to keep saying so. The row now carries
`Issued <date>` alongside the lifecycle badge.

**The register can show which portal account it went to.**
`partner_legal_name` is typed into the wizard; `finance_agent_contact_id` is
what the partner-portal query *and* the notification resolve against. They are
allowed to differ — a trading name is not a portal login — and in production
they differ on **half the register** (`"ABC 123 pty Ltf"` and `"NPC Services"`
are both addressed to the `Rugesh Naidu` account). Without the account on the
row, "issued to ABC Finance Team" is unfalsifiable from the register: there is
no way to see the document went to a different partner's portal, which is the
failure mode that genuinely does read as an agreement going missing. `list` now
resolves the linked contact and the row shows it **only when it disagrees**
with the typed name.

## Rules that keep biting

- **A stage is a statement about the filter, never about the register.** Any
  empty state that can be reached with rows in the register must say so and
  must not offer to create more.
- **`isIssued` is `issued_at`, not a status.** Every surface that wants to say
  "this has been sent" asks that. Testing for `partner_review` is how issuance
  became invisible the moment the agreement moved on.
- **Departures are only recorded for rows still in the register.** A row that
  left the working list entirely was *archived* — a deliberate act with its own
  button and its own count. Telling somebody it "moved to a stage" would send
  them to a stage it is not in.
- **Never follow the view out of "All" or the executed vault.** Those are not
  stages an agreement passes through; yanking the view there is its own bug.

## What this did not change

No migration, no lifecycle transition, no status value, no RLS policy, no
notification, no email, no render, no storage path. The partner portal is
untouched — it was already correct, and the specs here pin that: an issued
agreement is `isPartnerVisible` at every post-issue state **and** after it is
withdrawn, voided, terminated or superseded, while a never-issued agreement is
still invisible to the partner.

## See also

- [`SYNCHRONISATION.md`](./SYNCHRONISATION.md) — the polled cursor that keeps
  both portals current, and why the stage can now empty unattended
- [`PARTNER_ACTIVATION.md`](./PARTNER_ACTIVATION.md) — issuing to a partner who
  cannot sign in yet
- [`SENDING.md`](./SENDING.md) — getting the document to the partner
