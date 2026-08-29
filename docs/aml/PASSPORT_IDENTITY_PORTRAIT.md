# The photograph on the Compliance Passport

Read this before touching
`_shared/aml/passport/identityPortrait.pure.ts`, `storeIdentityPortrait` in
`standaloneVerification.ts`, `attachPortraitUrls` in `aml-reliance`, the
`portrait` block in `passportBooklet.pure.ts`, or the object list in
`aml-idv-retention`.

A Compliance Passport that proves an identity was verified and shows **no
face** is a certificate. The artefact this product is modelled on shows the
holder. So the booklet carries one image — and *which* one is the whole
question.

## Three images exist. One may travel.

A standalone verification produces three, and this deployment already holds
all three in its own private buckets (it runs `didit_standalone`, so the
customer's capture is uploaded by our portal rather than kept by the vendor):

| image | what it carries | where it goes |
|---|---|---|
| **`id_portrait`** | the face the provider **extracted from the document** | **the Passport** |
| `document_front` / `_back` | the bio page as photographed: number, MRZ, date of birth, place of birth, signature | staff evidence only, never published |
| `selfie` | the live capture taken during verification — biometric media of the person | never published |

The portrait is the right artefact for exactly the reason the other two are
not: **a face crop carries no document number, no MRZ, no date of birth, no
address and no signature.** It is the photograph *printed on* the passport or
licence — which is what the customer's own request asked for, and is not the
image taken of them during the verification session.

**The rule is an allow-list of exactly one key**, not a deny-list over the
other two. `identityPortraitObject` reads `id_portrait` and nothing else, and
there is no argument that widens it. A deny-list over a payload that gains a
field later is how the wrong image ships.

`WITHHELD_CAPTURE_KEYS` names the other two rather than leaving them absent,
so a reader of the module sees the decision instead of inferring it from a
gap.

## Where it comes from — nothing new is fetched

`resolveReferenceImage` already extracts the document portrait during
verification: it is the reference face for the Face Match step
(`face_match_reference: "id_portrait"`). Until now it existed in one local
variable and was deliberately discarded — *"never persisted, never logged and
never returned"*.

That decision was right for the vendor's *payload*, and the reasoning behind
it (data minimisation) is why `document_number`, `mrz`, `date_of_birth` and
the rest are still redacted at that boundary. It is the wrong decision for
this one crop, which is the one piece of the document a relying party can be
shown without being handed the credential.

So the change is small and additive: the bytes already in memory are written
to `aml-biometrics`, beside the selfie, under the attempt's own prefix.

## Two rules that make storing a face safe

**It is deleted on the same clock as everything else.**
`aml-idv-retention` enumerates the plan's objects by **fixed keys**, so a new
object is invisible to it until it is named — an image this product stores and
never deletes would be a worse defect than not storing it at all.
`id_portrait` is in that list, and the capture plan is re-persisted during
processing so the job (which reads `standalone_capture`, not the evidence
block) actually sees it.

**Storing it can never fail a verification.** `storeIdentityPortrait` returns
null on any error and throws nothing. Null means "no portrait", which is the
ordinary state for every verification recorded before this existed, every
hosted-provider verification, and any attempt whose upload failed. **Every
surface renders unchanged on null** — a Passport with no portrait is the
Passport this product has always produced.

## The URL is minted for one reader, at the moment of service

`passportView.pure.ts` is pure and does no I/O. More importantly, **a signed
storage URL is a bearer credential with a lifetime**: one inside a projection
can be persisted, cached, embedded in an attestation payload, or handed on
after it stops being the reader's to hold.

So the projection carries a **descriptor** — that a portrait exists, which
document the face was printed on, when — with `url: null`. The edge function
serving that view signs a **five-minute** URL for the request that asked.
`attachPortraitUrls` does it in `aml-reliance`; the Client Portal does the
same inline. Both fail soft.

The descriptor deliberately carries the document **kind** and not its
contents: *"verified against an Australian passport"* is the fact a relying
party needs; the passport number is the credential they do not. A test
asserts the descriptor contains no bucket, path, MRZ, number or date of birth.

## It cascades because there is one assembler

`buildCasePassportView(admin, caseId, audience)` builds the Command Centre's
document, the client's, the emailed one-time link's and the partner's. The
portrait is on the view, so it reaches all four — the partner's copy and the
Command Centre's cannot drift, because they are the same function with an
audience parameter.

Only a party whose verification **passed** gets one, and only the first: a
portrait extracted during a failed or superseded attempt is not the evidence
this party was verified on, and putting it on the document would say it was.

## The page still tells the truth

The Identity Verification leaf carried a standing note: *"Match scores,
liveness measurements and captured biometric media stay inside the
verification record."* An image above that sentence would have contradicted
it. It now reads:

> The portrait above is the photograph on the identity document. The document
> image itself, the live capture taken during verification, match scores and
> liveness measurements stay inside the verification record.

## It is on the CLIENT IDENTITY page, and the mount always draws

The portrait was first placed on the **Identity Verification** leaf, behind
`.filter((p) => p.portrait).slice(0, 1)`. Two things followed from that, and
both were reported as "there is no photo of the client anywhere in the
passport":

- **It was on the wrong page.** An identity document puts the holder's face
  beside the fields that name them. The Client Identity leaf is that page —
  it is the one a reader opens to find out *whose document this is* — and it
  was the only leaf in the booklet that did not show its own subject.
- **The block DISAPPEARED whenever there was no image.** `null` is the
  ordinary state, and the booklet's only way to render it was to omit the
  block, so the page said nothing at all: no frame, no caption, and no way to
  tell "we hold no photograph" from "this document does not carry one".

So the leaf carries a `bio` block — the photograph mounted at the left, the
four fields that name the holder set beside it — and **the mount is drawn
whether or not there is an image**. Where there is none it prints the frame,
the hatched field, the document ("Australian passport", which is known even
when the image is not) and one sentence saying which absence this is.

`identity.portrait` is therefore a **slot** rather than a descriptor, and it
is never null. Three absences, named rather than left as a gap:

| reason | what it means |
|---|---|
| `not_verified` | no verification has passed for this party yet |
| `predates_portrait_capture` | verified, NPC holds the document page, the portrait was never stored — **the one that can be repaired** |
| `provider_retains_media` | verified through a provider that keeps the media; there is nothing on our side to show or re-read |

The wording says nothing about the customer, only about the record, and a
test asserts it: nobody's identity is in question because a photograph was
not retained.

The Identity Verification leaf keeps its standing disclaimer and no longer
carries the face — printing it twice in one booklet is repetition. The
sentence now names the one image that travels and where it went, so it cannot
be read as saying the booklet carries no photograph at all.

## Recovering a portrait that was never stored

Every verification completed before portraits were stored has a Passport with
no face on it, permanently — even though the document page it was cropped
from is still in NPC's own bucket. A Passport is relied on for years, and the
ones already issued do not repair themselves.

`recoverIdentityPortrait` re-derives it: it reads the stored `document_front`,
makes one ID-verification call, takes `portrait_image` and writes
`standalone_capture.objects.id_portrait`. Four rules make that safe.

**It re-derives an IMAGE and never re-decides an identity.** No status, no
verdict, no score and no timing is written — the verification stands exactly
as it was recorded. Where the provider's re-read disagrees with the original
verdict, that is put on the case event for a human and acted on by nobody
here: silently adopting a second opinion nobody asked for would be far worse
than the missing photograph.

**It spends money, so a person asks for it.** One billed call, metered
through `runWithMetrics` at the same per-step price as the original. It is
never swept, never retried and never triggered by a page load — a test
asserts the sweep cannot reach it. That is why it does not bend
`aml-verification-processor`'s standing rule about paid calls: the rule is
about a call whose billing state is *unknown*, and this one is deliberate,
single and known.

**It is recorded.** A case event names the act, the check and the outcome. A
new image on a disclosure document that nothing accounts for is worse than no
image.

**It is only offered where it can work.** `recoverable` is set by the server,
for the Command Centre audience alone, and only where `portraitRecoverable`
is true — a stored document page and no portrait. The condition is expressed
over *what we hold*, never over which vendor was used: holding the source
image is what makes recovery possible, and a provider rule goes stale the
moment another one is added. `PortraitRecoveryNotice` renders nothing
otherwise, because a control that cannot work is worse than none, and it
states the cost before the click.

MLRO-only, enforced at the server: the Passport is the outward-facing
document and its contents are the MLRO's to change.

## How it is drawn

As a photograph **mounted on the leaf**, not an avatar dropped onto it: a
recessed well, a gold hairline, the paper's own ink for the legend, and a
**35:45 frame** — the ICAO passport-photograph ratio — so it reads as the
thing it is even before the image loads.

Every value is in leaf pixels. The leaf is authored at 470×648 and scaled by
transform, so a portrait sized in viewport units would be the one element on
the page that ignored the fit.

An absent or expired `src` draws the frame, a hatched field and the reason.
**A missing photograph must never blank the page.**

On the Client Identity leaf the mount is 96x123 rather than the marginal
84x108, because there the photograph is the subject of the page rather than
an ornament beside it.
