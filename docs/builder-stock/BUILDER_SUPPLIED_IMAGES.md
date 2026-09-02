# The picture a builder hands over

Read this before touching `builderSuppliedImage.pure.ts`, `attachBuilderImage.ts`,
`roleFromBuilderProperty` / `roleFromBuilderDesign`, the four
`*_builder_image` / `*_design*` operations, or `BuilderDesignRenders.tsx`.

## Why it exists

Every image this product serves is **read** out of something: a column naming a
URL, a brochure page naming a lot, a page cover, a design brochure. That works
until there is nothing to read.

On the one live source, **13 of 26 published properties attach no document at
all**. The image pipeline's own fallbacks then offered, for those rows:

| lot | what the fallback found |
|---|---|
| 731 | `simonds.com.au/.../woodlands-26/tarneit-bluestone/…` — a **Simonds Homes** display home |
| 921 | `abchomes.com.au/.../tarneit-display-home-heyfield-28.jpg` — an **ABC Homes** display home |
| 921 | `satterley.com.au/.../Bluestone-Estate-Brochure-01.jpg` — the **land developer's** estate marketing |
| 17 | `369homebroker.com.au/uploads/estate/13/…` — a **broker's** estate photos |

Every one of them is another company's house. The pipeline refused all of them,
correctly — and those cards stayed blank, because there was nothing to read and
no reader fixes that.

**The one party who certainly has the picture is the builder, and the product
gave them no way to hand it over.** That is what this closes.

## Two routes, one act

**A render FOR A DESIGN.** Those 13 properties are **three designs** — `DK 22B`
on eleven of them, `DK 22A` and `DK 23B` on one each. A project builder sells a
catalogue: the same house on many lots, so one render is the picture for every
one of them. **Three uploads cover thirteen properties**, and every future lot
of those designs, for ever.

**A picture FOR ONE PROPERTY.** The exception and the guarantee: a lot whose
render differs, a brochure that held the wrong picture, a one-off. Whatever
went wrong, somebody can fix one card.

Both are the same act — the builder gave us this picture — so both go through
one module, and the Command Centre performs the same two on the builder's
behalf. The record says which of them supplied it.

## Neither invents a level or a stage

A builder-supplied image is stored as `uploaded_document` / `source_supplied`,
because that is what it is. It therefore travels **every existing rule
unchanged** rather than around them: `isDisplayableSourceImage` admits it,
`rankImage` puts it in the builder's own tier, `chooseCardImage` orders it by
its evidence level, and the marketplace eligibility sweep judges its pixels.

In particular it goes through the **promotional-overlay rule** like any other
builder image: a render with "$25,000 REBATE" set over it is refused here
exactly as it is when it arrives inside a brochure, and for the same reason.

The evidence ladder already had the right two rungs; they had no human route to
them:

| | level | why |
|---|---|---|
| supplied for **this property** | **1** | the same rung as a column naming the row's image — the same claim, made more directly. Nothing was read, inferred or matched, so it must outrank anything taken out of a document, or an override would not override. |
| supplied for a **design** | **4** (`DESIGN_EVIDENCE_LEVEL`) | the same rung a design brochure's render sits on. Weaker than every property-specific reading, so **a brochure naming this lot takes the card back the moment one is read** — which is what a builder means by supplying a stand-in. |

## Why `designIdentityIsDistinctive` is deliberately not used

That rule asks whether a design name is distinctive enough to **identify a
document by itself** — whether a page mentioning "18" can be taken as being
about this design. It is a rule about inference from somebody's prose, and it
is right for that.

There is no inference here. `designIdentityIsDistinctive('DK 22B')` returns
**false** — two tokens, neither of them three letters — and `DK 22B` is exactly
the design eleven live properties state. Applying a text-matching rule to an
exact, builder-chosen, organisation-scoped equality would refuse the whole case
this exists for.

The guard that replaces it is stronger: **a render can only be uploaded for a
design this organisation's own stock states.** A builder cannot supply a render
for a design they do not sell, and `designsInStock` is what the surface offers
them to choose from — so they never type a design name at all.

And the attribution itself cannot be clever: exact key equality inside one
organisation. `DK 22B` reaches `DK 22B` and never `DK 23B`, which differ by one
character and are different houses.

## The rules that keep it honest

- **Bytes are validated server-side, out of storage.** The browser PUTs to a
  signed URL and a second call confirms; that call downloads what was actually
  stored and runs `validateSourceImageBytes` on it. A browser cannot declare a
  PNG and leave a PDF there.
- **A storage path in a request body is a lookup key, never authority.**
  `isBuilderSuppliedPath` requires one of the two prefixes this product writes,
  and the caller must also own the organisation the path names.
- **Supplying replaces, it does not accumulate.** One `source_reference` per
  design and per object, so a corrected render replaces the one before it
  instead of leaving it in the gallery, still eligible, still competing for the
  card.
- **Withdrawing a design's render withdraws it from the properties too.** A
  render removed from the design but left on eleven cards is a picture the
  builder believes they removed, still on eleven cards.
- **Nothing here writes `primary_image_id`.** That is one decision with one
  implementation — `enforceStrictPrimaryImages` — and an attach that wrote the
  pointer itself would be a second one.
- **The attach requeues the property itself**, because a property left
  `settled` would hold a correct, eligible picture that never reaches the card.
  It is part of the act rather than something each caller must remember — and
  it is also what lets the Command Centre supply a picture without its serving
  function naming pipeline state, which a standing contract test forbids.
- **An undeployed migration is not a fault.** `builder_design_images` arrives
  with a migration and the code arrives with a deploy; `isMissingCapability`
  keeps the skew quiet instead of logging an error per property per sweep.
- **It can never fail the act it accompanies.** `applyDesignRenderFor` runs
  inside the settler's per-property sweep, before the stage the property was
  claimed for. A fault there is logged and the property is still settled.

## The design render reaches stock imported later

`applyDesignRenderFor` runs on **every settler sweep**, not only at upload. A
render is supplied once and the stock keeps arriving: next month's list adds
four more `DK 22B` lots, and a builder who handed that render over in March
should not have to hand it over again. Idempotent — a property already carrying
it costs one indexed read and no write.

It reads the property's own `source_row` when the caller does not carry one,
because the settler's claimed item comes from `claim_builder_stock_image_work`,
which returns the work columns and not `source_row`. Trusting the argument
alone would have made this a no-op on the one caller that matters most — and a
no-op that looks exactly like a builder who supplied nothing.

It also reads the design from `unmapped.HOUSE` where `house_design` is null,
because rows imported before that column was mappable are exactly the rows this
feature was built for.

## What the surfaces offer

**Builder Portal → Stock list → Design renders.** Every design their own stock
states, with what supplying a render would do — *"11 properties · 11 with no
picture"* — and the one that would fix the most blank cards first. That
ordering is the whole ergonomics of the panel: a builder does not have to know
that eleven of their properties are `DK 22B`, and must not have to type it.

**Builder Portal → each property row.** "Add picture", beside the image badge.

**Command Centre → Builder Stock tab.** "Add a picture" on any card with none,
gated on `listings` edit — supplying a picture changes what the marketplace
shows, never who a property is offered to.
