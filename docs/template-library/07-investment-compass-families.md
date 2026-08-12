# Investment Compass — design families and colourways

How the approved Claude Design catalogue reaches the Template Library, and what
to change when you want a different result.

---

## What was approved

Claude Design's **Investment Compass Template Catalogue** defines ten design
families, five structural variants each, ten curated colourways per family —
**fifty masters, five hundred visual combinations**. It lives in the Claude
Design project `5dbd1c71-8a23-45af-8616-989b2a36efa8`:

| File | What it holds |
| --- | --- |
| `Template Catalogue.dc.html` | `FAMILIES` (families and manifests), `COLOURWAYS` (ten per family), `CW_KEYS`, `AXES`, `USE_MATCH`, `ARCHETYPES` |
| `<Family> Archetypes.dc.html` × 10 | The drawn A4 pages for each family's reference variant |

All ten families are implemented.

## The one rule the whole architecture rests on

The catalogue states it in the selection panel:

> Tokens carry no layout meaning. Any colourway composes with any of the five
> layout variants.

That is why this is **50 master templates × 10 palette presets**, not 500
templates. A colourway is a `Partial<Tokens>` handed to the renderer; the
document is the same schema either way. `investmentCompassCatalogue.spec.ts`
asserts the invariant directly — every block's geometry is byte-identical
across a family's ten palettes.

## Only the reference variant is drawn

`Template Catalogue.dc.html` computes archetype coverage as `BUILT` when
`axisIndex === 0` and `MANIFEST` otherwise, and the selection panel says so:

> This is the family reference. The other four variants are expressed as
> overrides on it.

So each family has one drawn expression and four declarative ones. That is
reproduced exactly: `templates.ts` holds **one composition**, parameterised by
the resolved manifest. An eleventh family is a declaration in `source.json`; a
sixth variant is an override object.

---

## The ten families

| # | Family | Faces | Note | Colourways | Masters |
| --- | --- | --- | --- | --- | --- |
| 01 | **Private Banking** | Cinzel · Playfair · Inter · Plex Mono | Gold on obsidian, editorial ledger, restrained accent | 6L/4D | Chancery, Chancery Compact, Sovereign Folio, Bullion Rail, Discretion Ledger |
| 02 | **Institutional Research** | Noto Serif · IBM Plex Mono | Numbered exhibits, masthead, coverage-note discipline | 6L/4D | Exhibit, Exhibit Dense, Coverage Note, Analyst Folio, Committee Brief |
| 03 | **Luxury Editorial** | Noto Serif | Serif throughout, photographic plates, justified columns | 6L/4D | Atelier, Atelier Plate, Grand Folio, Frontispiece, Monograph |
| 04 | **Modern Fintech** | Inter | Dark data ribbon, chips and tabs, violet accent | 6L/4D | Signal, Signal Compact, Console, Ribbon, Pulse |
| 05 | **Architectural Property** | Lato | Lato light, monochrome, measured drawings and schedules | 6L/4D | Drawing Set, Schedule, Elevation, Site Plan, Datum |
| 06 | **Swiss Minimal** | Inter | Strict grid, flat blocks, single red accent, no ornament | 6L/4D | Grid, Grid Tight, Objective, Raster, Hairline |
| 07 | **Corporate Advisory** | Lato | Decimal numbering, letterhead band, signed notes | 6L/4D | Board Pack, Board Pack Brief, Engagement Note, Committee Memo, Advisory Letter |
| 08 | **Wealth Management** | Roboto | Obsidian bands, statement rules, capital framing | 6L/4D | Statement, Statement Compact, Portfolio Review, Client Pack, Fiduciary |
| 09 | **Data / Analyst** | IBM Plex Mono · Inter | Mono figures on cell gridlines, field keys printed beside values | 6L/4D | Model, Model Dense, Worksheet, Dictionary, Terminal |
| 10 | **Dark Executive** | IBM Plex Mono · Inter | Mono on obsidian, vertical rail, amber for the base case | **4L/6D** | Obsidian, Obsidian Brief, Night Desk, Signal Dark, Executive Rail |

Dark Executive is the only family that leads dark — six of its ten colourways
are dark grounds, and its default is `Amber Obsidian`. Every other family
defaults to a light ground, because the catalogue picks index 0 unless its
ground disagrees with the variant's declared mode.

---

## Where things live

| File | What it owns |
| --- | --- |
| [`investmentCompass/source.json`](../../scripts/template-library/investmentCompass/source.json) | **The approved source**, a verbatim evaluation of `FAMILIES` + `COLOURWAYS` |
| [`investmentCompass/generate.ts`](../../scripts/template-library/investmentCompass/generate.ts) | Emits the two generated modules from it |
| [`investmentCompass/families.generated.ts`](../../scripts/template-library/investmentCompass/families.generated.ts) | Ten families, fifty variants, every manifest — generated |
| [`_shared/templateColourways.generated.ts`](../../supabase/functions/_shared/templateColourways.generated.ts) | All one hundred colourways — generated |
| [`_shared/templateColourways.pure.ts`](../../supabase/functions/_shared/templateColourways.pure.ts) | The **derivations**: every colour role the six approved values do not cover |
| [`investmentCompass/family.ts`](../../scripts/template-library/investmentCompass/family.ts) | Typed model, plus the **measured** typography and geometry |
| [`investmentCompass/resolvers.ts`](../../scripts/template-library/investmentCompass/resolvers.ts) | Manifest vocabulary → renderer primitives |
| [`investmentCompass/blocks.ts`](../../scripts/template-library/investmentCompass/blocks.ts) | Manifest-driven block helpers |
| [`investmentCompass/templates.ts`](../../scripts/template-library/investmentCompass/templates.ts) | The one composition, compiled fifty times |
| [`investmentCompass/qa.ts`](../../scripts/template-library/investmentCompass/qa.ts) | Chromium render QA — measured overflow, screenshots, PDF |
| [`src/lib/templateLibrary/entryDesign.ts`](../../src/lib/templateLibrary/entryDesign.ts) | Reading a library entry's family facts in the UI |

### Generated, not hand-written

Ten families × five variants is ~250 manifest entries; ten × ten colourways is
500 colour values. That is not something anyone transcribes correctly by hand,
and a single mistyped hex is a design change nobody approved and nobody can see
in review. So `source.json` is a **verbatim evaluation** of the Design file's
own JavaScript, and the TypeScript is emitted from it.

`investmentCompassSource.spec.ts` re-derives the comparison every run: a
hand-edit to a generated file — the exact way a design decision gets quietly
changed by an engineer — fails the suite rather than shipping.

### Measured, not guessed

The catalogue names typography as a preset (`cinzel_playfair_inter`) and spacing
as a scale name (`generous`). The actual point sizes exist only in the ten drawn
archetype files, so `BASE_SCALES` in `family.ts` records what each family's
pages **actually set** — cover title from its `h1`, section heading from the
median `h2`, body from its paragraphs, cells from its tables. Institutional
Research's cover is 14pt because it is a masthead, not a title page; Swiss
Minimal's is 52pt, the largest in the catalogue, against 8.2pt body. That ratio
is the Swiss argument, and borrowing another family's would erase it.

---

## The resolver, and why it exists

The manifest vocabulary is wide: **31 `kpi_layout` values, 30 `chart_style`, 29
`cover_overlay`, 27 `section_header_style`, 26 `table_style`.**

Thirty-one KPI renderers would be absurd. Thirty-one silent fallbacks to one
renderer would be a lie. So `resolvers.ts` gives every value an **explicit**
entry saying which primitive draws it and with what parameters:

```ts
four_column_ruled: { variant: 'ruled', columns: 4, items: 4 },
console_twelve:    { variant: 'ruled', columns: 6, items: 12 },
grid_cells_six:    { variant: 'ruled', columns: 6, cellBorders: true, items: 6 },
ledger_rows:       { variant: 'rows',  columns: 1, items: 5 },
```

Two consequences, both wanted: a reviewer can read what `holdings_rows` becomes
and disagree with it, and **a value with no entry throws**. The spec walks every
value in `source.json` and asserts each resolves — a family added to Design and
not mapped here fails the build rather than quietly rendering as somebody else's
layout.

Where several values resolve alike, the comment says so. `ledger_rows`,
`statement_rows` and `schedule_rows` are all a ruled ledger of label/figure
rows; what the catalogue distinguishes between them is the *family's* typography
and rule weights, which the family layer already supplies.

One value that reads like a rail and is not: **`scroll_rail`**. The source
describes Signal Compact as *"tab strip becomes a scroll rail. Print stays
A4-correct"* — a screen affordance. `hasRail()` excludes it, and a test asserts
the printed page has no vertical rule.

---

## Colourways

Each family's ten are in the approved order; index 0 is the default. The six
values per colourway follow the catalogue's own
`CW_KEYS = ['colourway','paper','ink','accent','rule','muted','ground']`.

### Three things that bite

**The colourway's `ink` is the FIELD colour, not body copy.** The approved
Private Banking archetype sets `--field: #251F18` and `--ink: #312A21` — the NPC
design system's `--aurixa-obsidian` (34 20% 12%) and `--foreground`
(34 20% 16%), four points of lightness apart. `bodyInkFor()` derives body ink by
lifting the field by that measured delta, and a test pins it to the reference
pair. Setting body copy to the field colour is invisible on screen and wrong on
paper.

**A colourway id is only meaningful inside its family.** `findColourway()` takes
a family key, and `resolveRequestedColourway()` validates against the entry's own
stored list. With a hundred ids in play, a global lookup would let a request
paint a Private Banking master in a palette no designer ever paired it with.

**Semantic colours do not follow the colourway.** `positive` / `caution` /
`negative` / `info` are Category B in the NPC design system — fixed by design, so
a tenant brand can never recolour a loss. They are lifted for dark grounds only,
where the print-weight values go muddy. All 100 colourways are asserted against
WCAG AA floors for body-on-paper, type-on-field and negative-on-paper.

---

## How a colourway reaches the page

Two paths, and the difference matters.

**Preview — a token override.** `renderTemplateToHtml` already accepted
`tokenOverrides`. Switching colourway re-renders the same schema with a
different colour map: no second template, no refetch, nothing written.

**Use template — a bake.** `buildWorkingCopyPayload` writes the chosen palette
into the copy's own `tokens.colors`. That is what makes the choice survive into
the Template Builder, the WeasyPrint PDF and live report generation without any
of them knowing colourways exist — the copy is an ordinary template that happens
to be that colour.

Referencing instead of baking would have meant teaching three pipelines to
resolve a colourway, and a saved copy whose appearance could change later —
which is what the library's snapshot rule exists to prevent.

There is one renderer. `render-template-pdf` takes **pre-compiled HTML** from
`renderTemplateToHtml`, so a change to a block renderer reaches the preview and
the PDF together.

---

## Database

One additive migration,
[`20260811110000_template_library_design_meta.sql`](../../supabase/migrations/20260811110000_template_library_design_meta.sql):
a `design_meta jsonb NOT NULL DEFAULT '{}'` column and a partial index. Nothing
existing is altered; every pre-existing row reads back as `{}`, which every
consumer treats as "not a family template".

### Why not `family_id` or `variant`

`family_id` is a **uuid meaning "the lineage this entry's versions share"**.
Every version of one template carries the same one, and the publish path
deprecates siblings by it:

```sql
UPDATE template_library_entries SET status = 'deprecated'
WHERE family_id = <new>.family_id AND status = 'published' AND id <> <new>.id
```

Overloading it with a *design* family would make five unrelated templates look
like five versions of each other — and publishing any one would deprecate the
other four.

`variant` is CHECK-constrained to `('composite','financial','due_diligence')`
and is copied onto `report_templates.variant`, where it feeds report routing.
Widening it would put design vocabulary in a routing column.

Both were left exactly as they are.

---

## Changing the design

1. **A design change** goes to Claude Design, then re-extract `source.json` and
   run `npm run templates:compass:generate`. Read the diff.
2. **A measurement or a mapping** is code: `family.ts` for type and geometry,
   `resolvers.ts` for the vocabulary.
3. `npm run templates:library:seed` — revalidates all 93 templates against the
   live Zod schema, the production renderer allow-list and the publish gate,
   checks each family's typography actually compiled and is loadable, and
   refuses to write a migration if any page overflows its footer.
4. `npm run templates:library:verify` — the catalogue suite, including all 500
   template × colourway renders and the no-layout-change invariant.
5. `npm run templates:compass:qa` — Chromium render QA into
   `audit-output/investment-compass/`.

### What the build refuses to write

On top of the existing gates, a family template must also:

- compile **and load** its family's four faces — a template that names Cinzel
  without a loadable face renders in the engine default and nothing says so;
- declare a density matching its resolved manifest, so a user filtering to
  "compact" cannot be handed a spacious page;
- offer only colourways registered for its family, with a default among them.

The voice system's **running-head rule does not apply to family templates**, and
that is deliberate. Under the approved catalogue a section eyebrow names the
*section* ("The verdict", "Projections") while the document is named by the
running head across the top of the page. Asserting the voice rule would reject
every one of these templates for following its own specification.

### Applying the migrations

No CI step runs migrations. Apply in order — the seed writes `design_meta`:

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260811110000_template_library_design_meta.sql
psql "$DATABASE_URL" -f supabase/migrations/20260811120000_seed_template_library_v4_investment_compass.sql
```

The seed is idempotent — it upserts on `(slug, version)` and touches only seeded
slugs, so re-running is safe and operator-promoted entries are never disturbed.

To check which catalogue a database is serving:

```sql
select design_meta->>'familyKey' as family, count(*)
from public.template_library_entries
where status = 'published'
group by 1 order by 1;
```

---

## Renderer support added for this layer

All additive, all default-preserving — a template that sets none of these
renders exactly as before, which the existing report-template suite asserts.

| Block | Props | Why |
| --- | --- | --- |
| `text-block` | `headingFont`, `bodyFont`, `eyebrowFont`, `eyebrowTracking`, `bodyTracking`, `headingWeight`, `headingLineHeight`, `bodyLineHeight`, `bodyStyle`, `bodyAlign` | Families run up to **four** faces with one job each; all three elements previously resolved to `--font-body`/`--font-heading`, and the eyebrow was pinned at 0.18em |
| `kpi-grid` | `variant` (`ruled`/`display`/`rows`/`stacked`), `cellBorders`, `valueFont`, `labelFont`, `noteFont`, `valueColor`, `ruleColor`, `emphasisColor`, `labelTracking`, `labelSize`, `noteSize`, `valueWeight`, `items[].note` | 31 declared KPI layouts; one filled-tile grid would have collapsed them |
| `data-table` | `headerStyle: 'rule'`, `gridLines`, `headerFont`, `headerSize`, `headerTracking`, `totalRows`, `rowRule`, `outerBorder`, `emphasisColor` | 26 table treatments — statements, worksheets, module grids, and one doubled-rule total |
| `callout` | `style` (`bar`/`margin`), `titleFont`, `titleColor`, `titleSize`, `titleTracking`, `bodyFont`, `bodySize`, `barWidth`, `ruleColor` | 21 callout styles across three genuinely different objects |
| `divider` | `orientation: 'vertical'`, `height`/`length` | The vertical rail and the drawing-set frame had no primitive |
| `hero` | `bg`, `eyebrow`, `eyebrowSize/Font/Tracking/Color`, `titleFont`, `subtitleFont`, `padding` | It drew an image and nothing else, so a hero with no image rendered transparent — and a *band* is what eleven cover overlays and every Wealth Management page opens on |
| `risk-register` | `display: 'bars'`, plus every colour as a prop | `severity_bars` vs `rated_table`; and the block hardcoded its whole palette |
| `decision-box` | `bg`, `color`, `headingColor`, `radius`, `barWidth`, `headingFont`, `bodyFont`, `headingSize`, `bodySize`, `headingTracking`, `maxWords` | `obsidian_card` needs the field colour; the block hardcoded `#FCFAF6` and silently truncated at 60 words |
| `footer`, `page-number` | `inset`, `fontSize`/`size` | The footer rule was full-bleed while the content rule spanned the margins |

Three of these fixed **latent defects** rather than adding features:
`risk-register`, `decision-box` and `hero`. The first two hardcoded every
colour, so they passed `isBrandSafe()` — which only inspects the schema — while
being the one element on the page that ignored the template's palette. The third
could not paint a background at all.

### jsPDF divergence

These props were added to the **HTML renderer only**. The library's entries all
declare `engine: 'weasyprint'`, and `render-template-pdf` compiles HTML, so the
production path is covered. The legacy jsPDF renderer ignores unknown props and
draws its existing defaults — a family template exported through it gets the
right content in the wrong typography. That is a known, bounded gap; it is not a
regression, because these templates did not previously exist.
