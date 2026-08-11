# Why the Issued PDF stopped being a fossil

Read this before changing anything that renders, stores or serves an Agreement
Centre PDF. It records a bug that looked like a rendering fault, was not one,
and could not have been fixed by any amount of work on the renderer.

## What was reported

> *"When I download the agreements, the Issued version is still reverting to the
> old version."*

The download menu offers three documents. Two of them — **Draft PDF (template
pack)** and **DOCX (template pack)** — came out correct. The third, **Issued PDF
— v1.0**, kept coming out with the cover that had already been fixed: the title
clipped at the trim, every line hard against the paper's left edge, the
particulars crushed into the foot, and the last band spilling onto a second
sheet.

## What it actually was

The PDFs say so themselves. Both carry a `renderedAt` in their metadata:

| Artefact | `npcrenderedat` | Pages | Cover |
|---|---|---|---|
| Issued PDF — v1.0 | `2026-08-09T19:22:42Z` | 14 | broken, spilling to page 2 |
| Draft PDF | `2026-08-11T05:54:24Z` | 15 | correct, one page |

Same agreement, same generator, two days apart. The draft is **rendered on every
request**; the issued PDF was **rendered once, at issue, and stored**. From then
on `agreement-centre-render` did nothing but sign a URL to those bytes:

```ts
let path = version.pdf_storage_path;
if (!path) { /* …render and store… */ }        // the ONLY re-render condition
const { data: signed } = await supabase.storage
  .from(AGREEMENTS_BUCKET).createSignedUrl(path!, …);
```

The only condition either download route ever re-rendered on was **total
absence**. An artefact written by a superseded build was indistinguishable from
a good one, so a fix to the document could never reach a document already
issued. Deploying the corrected renderer fixed every future issue and nothing
that already existed.

## The distinction the code was missing

An issued version freezes two different things, and the cache froze them
together:

1. **What the agreement says** — field values, parties, commercial schedule, the
   brand it was issued under. That is the bargain. It must never move, and it
   never did: it is frozen properly on the version row in `field_values` and
   `brand_snapshot`.
2. **How that content is typeset** — margins, bands, type scale, where the cover
   breaks. That is not part of the bargain. Two partners holding the same
   version should hold the same document, and improving the layout does not
   change a word of what was agreed.

Caching the rendered bytes froze (2) along with (1). So the remedy is not to
stop freezing — it is to freeze the right thing. **The stored bytes are a cache
of the frozen inputs, not the record.**

## The mechanism

Straight from [`partnerAgreementRevision.pure.ts`](../../supabase/functions/_shared/partnerAgreementRevision.pure.ts),
which solved this identical problem one subsystem over in August 2026, for the
same person, with the same symptom — *"a PDF that looked wrong, three portals
deep, to the person who had asked for it to look right."*

[`_shared/agreements/documentRevision.pure.ts`](../../supabase/functions/_shared/agreements/documentRevision.pure.ts)
holds one integer and the rules that read it:

- **The revision is part of the object's path** — `…/v1-0/issued-r2.pdf`.
  Revision 1 carries **no** suffix, so every artefact stored before revisions
  existed still resolves at the path already recorded against its row.
- **A refresh writes a new object and repoints the row.** `upsert: false`
  stands; no stored object is ever replaced. The superseded bytes stay where
  they are.
- **One decision, in one place.** `resolveVersionArtefact` in
  [`render.ts`](../../supabase/functions/_shared/agreements/render.ts) replaced
  the fifteen duplicated lines in each download route and answers four ways
  rather than two:

  | State | Condition | What happens |
  |---|---|---|
  | `absent` | nothing stored | render and store (the long-standing deferred path) |
  | `current` | stored revision ≥ this build's | serve it |
  | `stale` | older, and **nothing signed** | re-render from the version row's own frozen inputs, store, repoint, serve |
  | `frozen` | older, but signed or executed | serve the stored bytes and say why |

## What is never refreshed

**A signature ends it.** A person committed to a document they read;
re-typesetting under them would leave the thing signed and the thing on file two
different documents, which is the exact property a signed instrument exists to
deny. So:

- any signature row against the version freezes **both** its artefacts;
- a version whose `status` is `executed` is frozen even if the signature count
  reads zero — a count that failed to read must not look like consent;
- the executed artefact is never refreshed under any circumstances. It is the
  instrument.

`signatureCount` is a required argument to `resolveVersionArtefact` rather than
something it looks up itself, for the same reason: a caller that has not looked
must not be able to answer *nobody has signed* by omission.

## Bumping the revision

Bump `AGREEMENT_CENTRE_DOCUMENT_REVISION` when the document's visual
composition changes materially, and add the line to the list in that module's
header — a test asserts every revision from 1 to the current one is described
there. Every stored artefact below the new number then reports as `stale`, and
the next download of an unsigned one re-renders it. Nobody has to find them.

Revision **2** covers the cover rebuild: three bands that own their own
geometry, and the fix below.

## The contrast bug the same render found

The cover's organisation eyebrow measured **1.15:1** against the dark band —
the tenant's own name, at the head of its own agreement, invisible.

It was not the colour the cover set. The eyebrow is a substituted token, so it
renders inside `<span class="agc-bound">`, and that class paints `bodyInk` —
a role whose grounds are `paper`, `paperAlt`, `paperBright` and **not** `field`.
The span's paper ink won over whatever the band had set: graphite on near-black.

Two changes, because either alone leaves it broken:

- `.agc-cover-company` moved off `accentOnField`, whose contrast floor is the
  *display* floor and which is therefore only promised to be legible at display
  size — this line is 7.5pt. The hairline rule keeps the brand note, which is
  what that floor is for.
- `.agc-cover-canvas .agc-bound` / `.agc-unfilled` inherit rather than paint, so
  the ground wins for any token that lands on the dark band.

Measured after: **15.23:1**.

## Shipping it

The behaviour is in the Edge Functions, so
[`DEPLOYMENT.md`](./DEPLOYMENT.md) applies in full — merging is not deploying,
and that gap is the reason the revision number is also on the wire.
`agreement-centre-render` and `finance-portal-agreements` both report the
revision they are running; the Command Centre compares it with the one the
bundle expects and says *"downloaded in the previous document format — the
agreement render service has not been deployed yet"* rather than letting a
superseded cover leave in a partner's direction unremarked.

Nothing needs backfilling. The refresh happens on the next download of each
affected artefact, and there is no migration in this change.
