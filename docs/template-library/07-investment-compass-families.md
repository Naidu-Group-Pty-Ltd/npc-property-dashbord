# Investment Compass — design families and colourways

How the approved Claude Design catalogue reaches the Template Library, and what
to change when you want a different result.

---

## What was approved

Claude Design's **Investment Compass Template Catalogue** defines ten design
families, five structural variants each, ten curated colourways per family —
fifty masters, five hundred visual combinations. It lives in the Claude Design
project `5dbd1c71-8a23-45af-8616-989b2a36efa8`:

| File | What it holds |
| --- | --- |
| `Template Catalogue.dc.html` | `FAMILIES` (the ten families and their manifests), `COLOURWAYS` (ten per family), `CW_KEYS`, `AXES`, `USE_MATCH`, `ARCHETYPES` |
| `Private Banking Archetypes.dc.html` | Seven drawn A4 pages for `pb-01` Chancery |
| `<Family> Archetypes.dc.html` × 9 | The same for the other nine families |

**This pilot implements Private Banking only.** The other nine families are
declared in the source and not in this repository.

## The one rule the whole architecture rests on

The catalogue states it in the selection panel:

> Tokens carry no layout meaning. Any colourway composes with any of the five
> layout variants.

That is why this is **50 master templates × 10 palette presets**, not 500
templates. A colourway is a `Partial<Tokens>` handed to the renderer; the
document is the same schema either way.

## Only one variant per family is drawn

`Template Catalogue.dc.html` computes archetype coverage as `BUILT` when
`axisIndex === 0` and `MANIFEST` otherwise, and the selection panel says so:

> This is the family reference. The other four variants are expressed as
> overrides on it.

So Chancery has seven composed pages in the source and `pb-02`…`pb-05` are
specified declaratively, as sparse override objects on the family base. That is
reproduced exactly: `privateBanking.ts` holds **one composition**, parameterised
by the resolved manifest. A sixth variant would be an override object, not a new
document.

---

## Where things live

| File | What it owns |
| --- | --- |
| [`_shared/templateColourways.pure.ts`](../../supabase/functions/_shared/templateColourways.pure.ts) | The ten approved colourways (verbatim), the derivation rules, and `applyColourwayToSchema` |
| [`src/lib/templateLibrary/colourways.ts`](../../src/lib/templateLibrary/colourways.ts) | One-line shim so the browser and the edge function read one module |
| [`investmentCompass/family.ts`](../../scripts/template-library/investmentCompass/family.ts) | The Private Banking family: manifest, five variants, typography, density scales, margins |
| [`investmentCompass/blocks.ts`](../../scripts/template-library/investmentCompass/blocks.ts) | Manifest-driven block helpers — `kpis()` reads `kpi_layout`, `table()` reads `table_style`, and so on |
| [`investmentCompass/privateBanking.ts`](../../scripts/template-library/investmentCompass/privateBanking.ts) | The one composition, compiled five times |
| [`investmentCompass/qa.ts`](../../scripts/template-library/investmentCompass/qa.ts) | Chromium render QA — measured overflow, screenshots, PDF |
| [`src/lib/templateLibrary/entryDesign.ts`](../../src/lib/templateLibrary/entryDesign.ts) | Reading a library entry's family facts in the UI |

## The five masters

| Template | Code | Axis | Density | Recommended use | What makes it different |
| --- | --- | --- | --- | --- | --- |
| **Chancery** | `pb-01` | A reference | balanced, 20mm | Client-facing flagship | The family reference — no overrides |
| **Chancery Compact** | `pb-02` | B condensed | compact, 16mm | Portfolio reviews | Six KPI columns, tight ledger rules, dense print |
| **Sovereign Folio** | `pb-03` | C expansive | spacious, 26mm | Single-asset pitch | Bleed cover, oversized numerals, 2×2 display KPIs |
| **Bullion Rail** | `pb-04` | D architecture | balanced, 20mm | Long reports | A gold rail down every page; KPIs stack against it |
| **Discretion Ledger** | `pb-05` | E presentation | balanced, 20mm | Numbers-first clients | Double-rule totals, severity bars, ruled recommendation |

The five KPI layouts (`four_column_ruled`, `six_column_ruled`,
`two_by_two_display`, `stacked_rail`, `ledger_rows`) are the axis they most
visibly differ on, and a test asserts all five are distinct.

## The ten colourways

Transcribed verbatim from `COLOURWAYS.pb`. Field order is the catalogue's own
`CW_KEYS = ['colourway','paper','ink','accent','rule','muted','ground']`.

| Colourway | Paper | Ink (field) | Accent | Ground |
| --- | --- | --- | --- | --- |
| Gold on Obsidian *(default)* | `#FAF7EF` | `#251F18` | `#8E6C15` | light |
| Oxblood | `#FAF7EF` | `#241819` | `#7B2230` | light |
| Verde | `#F7F6EF` | `#1C241D` | `#2F5D45` | light |
| Navy Signet | `#F8F8F4` | `#1B2130` | `#22406E` | light |
| Slate Bronze | `#F6F5F2` | `#23211E` | `#8A6A3A` | light |
| Platinum | `#F7F7F5` | `#1E1E1C` | `#4A4A46` | light |
| Obsidian Reverse | `#1E1A15` | `#F2EBDE` | `#D9A520` | dark |
| Oxblood Night | `#1C1416` | `#F0E6E4` | `#C0565F` | dark |
| Deep Verde | `#141A16` | `#E8EFE8` | `#6FA98A` | dark |
| Midnight Navy | `#131720` | `#E9EDF4` | `#7FA3D8` | dark |

**"Gold on Obsidian" is a LIGHT ground.** The name describes the cover field;
the body ground is ivory. `Obsidian Reverse` is its dark counterpart.

### Three things that bite

**The colourway's `ink` is the FIELD colour, not body copy.** The approved
archetype sets `--field: #251F18` and `--ink: #312A21` — the NPC design system's
`--aurixa-obsidian` (34 20% 12%) and `--foreground` (34 20% 16%), four points of
lightness apart. `bodyInkFor()` derives body ink by lifting the field by that
measured delta, and a test pins it to the reference pair. Setting body copy to
the field colour is invisible on screen and wrong on paper.

**A colourway id is only meaningful inside its family.** `findColourway()` takes
a family key, and `resolveRequestedColourway()` validates against the entry's own
stored list. A global lookup would let a request paint a Private Banking master
in a palette no designer ever paired it with.

**Semantic colours do not follow the colourway.** `positive` / `caution` /
`negative` / `info` are Category B in the NPC design system — fixed by design, so
a tenant brand can never recolour a loss. They are lifted for dark grounds only,
where the print-weight values go muddy.

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
like five versions of each other — and publishing any one of them would
deprecate the other four.

`variant` is constrained to `('composite','financial','due_diligence')` and is
copied onto `report_templates.variant`, where it feeds report routing. Widening
that CHECK to hold structural variant names would put design vocabulary into a
routing column.

Both were left exactly as they are.

---

## Changing the design

1. Edit the family manifest or typography in `investmentCompass/family.ts`, or a
   colourway in `templateColourways.pure.ts`.
2. `npm run templates:library:seed` — revalidates all 48 templates against the
   live Zod schema, the production renderer allow-list and the publish gate,
   checks the family typography actually compiled, and refuses to write a
   migration if any page overflows its footer.
3. `npm run templates:library:verify` — the catalogue suite, including all fifty
   template × colourway renders.
4. `npm run templates:compass:qa` — Chromium render QA: measured overflow,
   screenshots and PDFs into `audit-output/investment-compass/`.

### What the build refuses to write

On top of the existing gates, a family template must also:

- compile the family's own typography (Cinzel display, Playfair headings) —
  otherwise a "Private Banking" master would be filed under a face it is not set
  in;
- declare a density that matches its resolved manifest, so a user filtering to
  "compact" cannot be handed a spacious page;
- offer only colourways registered for its family, with a default among them.

The voice system's **running-head rule does not apply to family templates**, and
that is deliberate. Under the approved catalogue a section eyebrow names the
*section* ("The verdict", "Projections", "Risk register") while the document is
named by the running head across the top of the page — `section_header_style:
eyebrow_rule_display` is exactly that arrangement. Asserting the voice rule
would reject every one of these templates for following its own specification.

### Applying the migrations

There is no CI step that runs migrations. Apply, in order:

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260811110000_template_library_design_meta.sql
psql "$DATABASE_URL" -f supabase/migrations/20260811120000_seed_template_library_v4_investment_compass.sql
```

The seed is idempotent — it upserts on `(slug, version)` and touches only seeded
slugs, so re-running is safe and operator-promoted entries are never disturbed.
The column migration must go first: the seed writes `design_meta`.

To check which catalogue a database is serving:

```sql
select design_meta->>'familyKey' as family, count(*)
from public.template_library_entries
where status = 'published'
group by 1;
```

---

## Renderer support added for this layer

All additive, all default-preserving — a template that sets none of these
renders exactly as before, which the existing 908-test suite asserts.

| Block | Props | Why |
| --- | --- | --- |
| `text-block` | `headingFont`, `bodyFont`, `eyebrowFont`, `eyebrowTracking`, `bodyTracking`, `headingWeight`, `headingLineHeight`, `bodyLineHeight`, `bodyStyle`, `bodyAlign` | The family runs **four** faces with one job each; all three elements previously resolved to `--font-body`/`--font-heading`, and the eyebrow was pinned at 0.18em |
| `kpi-grid` | `variant` (`ruled`/`display`/`rows`/`stacked`), `valueFont`, `labelFont`, `noteFont`, `valueColor`, `ruleColor`, `emphasisColor`, `labelTracking`, `labelSize`, `noteSize`, `valueWeight`, `items[].note` | Four of the five variants differ on KPI arrangement; one filled-tile grid would have collapsed them into the same page |
| `data-table` | `headerStyle: 'rule'`, `headerFont`, `headerSize`, `headerTracking`, `totalRows`, `rowRule`, `outerBorder`, `emphasisColor` | All three Private Banking table styles are unfilled statements; `double_rule_statement` closes a total with a doubled rule |
| `callout` | `style` (`bar`/`margin`), `titleFont`, `titleColor`, `titleSize`, `titleTracking`, `bodyFont`, `bodySize`, `barWidth`, `ruleColor` | `tinted_gold_bar` and `margin_note` are different objects; a circled exclamation mark is neither |
| `divider` | `orientation: 'vertical'`, `height`/`length` | Bullion Rail's `vertical_rail` had no primitive that could draw it |
| `risk-register` | `display: 'bars'`, plus every colour as a prop | `severity_bars` vs `rated_table`; and the block hardcoded its whole palette, so it ignored the colourway entirely |
| `decision-box` | `bg`, `color`, `headingColor`, `radius`, `barWidth`, `headingFont`, `bodyFont`, `headingSize`, `bodySize`, `headingTracking`, `maxWords` | `obsidian_card` needs the field colour; the block hardcoded `#FCFAF6` and silently truncated at 60 words |
| `footer`, `page-number` | `inset`, `fontSize`/`size` | The footer rule was full-bleed while the content rule spanned the margins — a 33pt discrepancy on a 20mm page |

Two of these fixed latent defects rather than adding features: **`risk-register`
and `decision-box` hardcoded every colour**, so they passed `isBrandSafe()` —
which only inspects the schema — while being the one element on the page that
ignored the template's palette. Under a colourway system that is visible.

### jsPDF divergence

These props were added to the **HTML renderer only**. The library's entries all
declare `engine: 'weasyprint'`, and `render-template-pdf` compiles HTML, so the
production path is covered. The legacy jsPDF renderer ignores unknown props and
draws its existing defaults — a Private Banking template exported through it
gets the right content in the wrong typography. That is a known, bounded gap; it
is not a regression, because these templates did not previously exist.
