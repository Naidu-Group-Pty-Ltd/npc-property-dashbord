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

## How it is drawn

As a photograph **mounted on the leaf**, not an avatar dropped onto it: a
recessed well, a gold hairline, the paper's own ink for the legend, and a
**35:45 frame** — the ICAO passport-photograph ratio — so it reads as the
thing it is even before the image loads.

Every value is in leaf pixels. The leaf is authored at 470×648 and scaled by
transform, so a portrait sized in viewport units would be the one element on
the page that ignored the fit.

An absent or expired `src` draws the frame, a hatched field and *"Portrait not
available"*. **A missing photograph must never blank the page.**
