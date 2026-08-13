# Pinning a change request to the clause it is about

Read this before changing `annotations.pure.ts`, the annotation layer in
`DigitalAgreementView`, or the `anchor_*` columns.

## What this replaces

"Request changes" was a small modal: a dropdown of nine broad sections and a
free-text box. The partner is reading a fourteen-page agreement and has to look
away from it, translate "the second sentence of 3.2" into "Commercial
Schedule", and type enough context that somebody on the other side can find the
thing they meant. The issuer then reads a paragraph of prose and goes looking.

Both halves are the same missing idea: **the request had no address.**

## The address already existed

`contentOverrides.pure.ts` gives every text node of the template a stable path
(`s:commercial/b:3:lead`) so the issuer can amend that exact node.
`listAgreementContentSlots` enumerates them all, each with a human label and its
section.

An annotation anchors to **the same path**. That is not a convenience — it is
what closes the loop. The partner pins the clause; when the issuer amends the
wording they amend that same path. The request and the change that answers it
name the same address, in the same vocabulary, and neither side described a
location in prose.

It also means there is no second traversal to keep in step. `Amendable` already
wraps every text node with its path, so the pin reads a second context at the
point the document was already passing through.

## One document, one rail, two portals

Both portals render `DigitalAgreementView` and both render `AnnotationRail`.
Passing the same layer to each is what makes "the Command Centre sees the
partner's pins on its live preview" **structural** rather than a second
implementation that drifts. `useAgreementAnnotations` builds that layer;
the two sides differ in exactly two arguments — whether this reader may raise a
request, and what happens on submit.

Selection is lifted and shared, so clicking pin 4 highlights thread 4 and
clicking thread 4 highlights pin 4. A list that merely sits beside a document is
the modal again with extra steps.

Pin numbers are assigned in **document order**, so the pin labelled 3 is the
third one down the page. A number that shuffled as requests were resolved would
be useless for the thing numbers are for — two people on a call saying "pin 3"
and meaning the same clause.

## Anchors go stale, and must not vanish

A path is stable within a template revision, not across all of them. A clause
that has been renumbered, split or removed leaves an anchor pointing at nothing,
and the request is still a request somebody is waiting on.

Three rules follow, and they are the ones with teeth:

- **An unresolvable anchor degrades to a list entry.** It keeps its label, is
  shown with the others, is marked as "this clause has changed since the request
  was raised", and simply has no marker. It is never dropped.
- **`anchor_label` is stored, never re-derived.** Re-deriving on read would
  silently re-point the request at whatever now occupies that path. A comment
  about a commission rate appearing against a termination clause is worse than
  no pin at all.
- **The server refuses to create an anchor it cannot resolve.** A pin can only
  be dropped on a clause that exists in the wording the partner is reading —
  which is the agreement's own wording, template plus amendments, not the bare
  template.

## The migration is optional

`20260913000000` adds three nullable columns. Migrations here are applied out of
band and one has already sat unapplied for three weeks
([`SENDING.md`](./SENDING.md)), and an insert naming a column PostgREST does not
know about fails with `PGRST204` — which would mean a partner clicking a clause,
typing a request and losing it.

So `anchorColumns.ts` probes once per isolate, exactly like
`financeNotificationRouting.pure.ts`:

- columns present → the anchor is stored and the pin appears;
- columns absent → the request is still saved, with its location folded into the
  first line of the comment (`Re: Clause 11.2`), and the read does not ask for
  the columns at all.

The pin is lost; the request never is. Applying the migration turns pins on with
no code change.

The probe's failure direction is the opposite of the notification one, on
purpose: an inconclusive probe here **assumes support**, because the columns are
far more likely present than not, and a false negative would permanently degrade
a working feature while a false positive fails one insert loudly.

## Who may pin

The partner, while the agreement is `partner_review` or `sent_for_signature` —
the states where a change is still possible. Not after execution: a "+" on every
clause of a signed instrument invites a conversation that cannot go anywhere.

The issuer never pins. A change request is the counterparty's instrument for
asking; the issuer answers it in the thread or amends the clause. That asymmetry
is why `canAdd` is an argument rather than a permission check inside the layer.
