# A premium document — what the 97 Poole Road Compass got wrong

Everything here was measured on one delivered PDF: the Investment Compass
issued for **97 Poole Road, Kellyville NSW 2155 on 20 September 2026**, 38
pages, read page by page and then measured mechanically out of the file
itself rather than from the source that produced it.

That distinction matters twice in this document. Reading the PDF by *font*
is what turned "too much bold" into 18.6%. And reading it by *wording* is
what proved that one of the reported defects was already fixed and the
document simply predated the deploy.

---

## 1. Emphasis — 18.6% of the body copy was bold

`supabase/functions/_shared/reports/investment/emphasisDensity.pure.ts`

Read out of the PDF by font:

```
body copy (Inter, 14 device px)   41,773 chars regular
                                   9,570 chars BOLD   = 18.6%
274 bold runs, median 26 chars, mean 35, longest 246
```

7.2 emphasised spans a page. A well-set document runs at one to three per
cent. The five longest spans were 160–246 characters each — a complete
sentence apiece, in bold, inside a paragraph of the same words.

Four structural rules take that document to **4.1% and 1.9 spans a page**:

| rule | what it catches | spans |
| --- | --- | ---: |
| clause | a span carrying its own comma, full stop or dashed aside, or running past `EMPHASIS_PHRASE_WORDS` | 71 |
| figure | a number with at most four words around it | 76 |
| repeat | the second and later emphasis in one paragraph | 45 |
| table | any emphasis inside a table cell | — |

**The phrase ceiling is derived, not chosen.** With the punctuation rule
alone applied, the surviving spans fall into two populations with a clean gap
between them: 80% at eight words or fewer, **not one at nine**, and every span
from ten words up carrying its own subject and verb.

**A run-in label is kept** — a phrase closed by a colon or full stop standing
in for a heading (`**Local government area:** The Hills Shire Council`). The
register lists depend on it, and it does not spend the paragraph's one
emphasis, so a labelled fact keeps its phrase too.

**This is not the prose regex-scrub `RUNTIME_CONSOLIDATION.md` §8 forbids.**
`**` is markup, not a word. Strip the markers from the input and the output
and they are byte-identical, and `emphasisDensity.spec.ts` asserts that rather
than promising it. If that assertion ever fails, the module has started
rewriting prose and must come out.

---

## 2. The glance strip — twelve boxes of dingbats

`supabase/functions/_shared/reports/glanceStrip.pure.ts`

`{{glance: …}}` drew a washed, left-ruled callout carrying raw `✓ ⚠ ◆ ★`.
`vizFigures.pure.ts`'s own header said why: *"a new `.glance-strip` rule would
be a new thing to style, test and keep in print contrast for no gain over a
callout."* A reasonable call about implementation cost and a wrong one about
the page — twelve of those boxes reached this document, three on page 28 and
three more on page 29.

Three things were wrong and none of them was the content.

**A dingbat is not a category.** The glyph carried the whole meaning — good,
watch, fact, bottom line — in a way that survives neither greyscale, nor a
screen reader, nor a reader who has not been told the key. `★` against `◆` is
a distinction nobody can look up.

**A wash and a rule say "separate object."** Border, fill and rule are the
expensive signals in print, and this block spent all three on a summary of the
prose directly beneath it.

**The findings did not align.** Each item started where the previous glyph
ended, so four findings sat on four different left edges inside one box.

It is a ruled key now — hairlines above and below, no ground, no left bar, the
meaning set as a **word** in a fixed column so every finding hangs on one axis.
Rendered against the real stylesheet in Chromium it is calmer and 17% shorter.

Three rules hold it. **The meaning is a word and the colour is second**, so it
reads in greyscale and out loud. **The glyph never reaches the page** — it is
an input vocabulary, `glanceTone` is the one place that mapping lives, it is
generous on each side, and an unrecognised marker is `context` rather than a
dropped finding. **It stays a `<ul>` of `<li>`**, because `render-template-pdf`
asks WeasyPrint for `pdf/ua-1` and the structure tree is built from element
names.

---

## 3. The running head said `Part 07` twenty-six times

`scripts/template-library/investmentCompass/templates.ts`

v16 fixed the half of the running head that was **discarded** and left the half
that was **repeated**. It passed `Part NN · {{narrative.chapters.i}}`, so this
document carried `Part 07 · <chapter>` on twenty-six consecutive pages: true —
the body is one part — and saying nothing twenty-six times over.

A running head exists to say where the reader is. Across a single part the part
number does not; the chapter does. The part structure is on the contents page,
which is where it varies. The marker is the chapter alone.

**The ten characters that frees are not a line.** The marker sits in 34% of the
measure, about 43 characters, against `CHAPTER_MAX_CHARS` of 64 — so the worst
case still takes both lines the rule reserves. What it buys, measured on the
twelve chapters this report actually produced: **three wrapped** to a second
ragged right-aligned line with the prefix, **one wraps** without it.

The railed eleven masters are untouched and stay right: there the part is an
eyebrow *above* the chapter rather than a prefix beside it, so the repetition is
subordinate by construction and carries the orientation for free.

Shipped as seed **v17** plus the active-master refresh. Proven by the
migration's own bytes: **0** markers still carry `Part NN · <chapter>`, 2,000
carry the chapter alone, 1,507 rail markers untouched.

---

## 4. Eight drawings, two datasets

`supabase/functions/_shared/reports/investment/blockHygiene.pure.ts`

`directiveKey` normalised the **whole** directive, so a caption was enough to
make a repeat look new to the pass that exists to stop repeats. The identical
three bars

```
Other offences 22 | Robbery 16 | Arson 9
```

were drawn on pages 20, 23, 24 **and** 25 under four different titles, and
`$1,650,000 / $1,808,000 / $1,110,000` on pages 21, 29 and 31 under three more.
Eight drawings, two datasets, and the de-duplicator saw seven distinct charts.

**The data is the chart; a caption is what a section calls it.** `title` and
`caption` leave the key and nothing else does — a directive differing in a
digit, a label, a unit or a maximum is still a different chart, because each of
those changes what a reader takes from it.

---

## 5. More than one unit on one track

`supabase/functions/_shared/reports/investment/chartUnits.pure.ts`

Page 13 plotted `99.1%`, `100%` and `~2.1 km` together, so 2.1 kilometres drew
as a 2% sliver of a percentage axis. Page 28 plotted `241` new dwellings
against `$163,527,942`, so the count drew as a hairline.

Both are correct arithmetic and neither says anything. A bar's length is the
only thing a bar chart says, and it says it by putting every value on one
track; a reader takes "short bar" as "small quantity" because that is the only
reading the form admits.

`chartScale.pure.ts` already keeps one scale per unit **across** a document.
This is the defect one level down — two units **inside** one chart, where no
choice of maximum can help.

**A chart of more than one unit is not drawn; it is set as the table its data
already is.** Nothing is dropped: every label, every value and their order
survive, and the title becomes a caption rather than a heading so the
document's own outline and contents page are untouched. It does not unify
(converting km to m so the axis agrees would invent a comparison the writer did
not make), it does not guess, and it never touches a single-unit chart — which
is every chart in a document that was already right.

---

## 6. A column that says the same thing on every row

`foldConstantTableColumns` in
`supabase/functions/_shared/reports/investment/derivedHygiene.pure.ts`

Page 34 ran its nine-column infrastructure register off the right page edge:
the header cut to `Deliver / timing` and every cell under it to
`Not / publish / by this / registe`.

Two of those nine columns held one identical value on all five rows —
`Not stated — the figure is the applicant's own cost of development` and
`Not published by this register` — repeated down the page, carrying nothing per
row, and costing the measure the width that then guillotined the table.

**A column whose every cell is identical is a footnote, not a column.** Stated
once below the table, verbatim, never abbreviated. Three bounds keep it off a
table that was already right: only a table of `CONSTANT_COLUMN_MIN_WIDTH` (6)
columns or more, only with `CONSTANT_COLUMN_MIN_ROWS` (3) body rows or more,
never the first column, and never below two columns.

---

## 7. Demand 13, from one demographic drift reading

`supabase/functions/_shared/reports/market/demandScoring.pure.ts`

The report published Grade C, **48 out of 100**. Every figure reproduces
exactly from the record:

```
Growth   56 × 42.1%  = 23.58
Location 64 × 26.3%  = 16.84
Yield    32 × 15.8%  =  5.05     3.467% gross, $1,100/wk over $1,650,000
Demand   13 × 15.8%  =  2.05     ← ABS ERP 17,911 → 17,584, −0.368%/yr
                       ------
                        47.53 → 48
```

Demand's 13 is `interpolate(−0.368, POPULATION_ANCHORS)` = 12.64, and the
population driver was the **only** component that reached the scorer.
`scoreDemand` renormalises over what was measured, so a weight of 0.15 divided
by a coverage of 0.15 is **1.00** — and the module's own header had forbidden
that since it was written: *"It carries 0.15, so it can inform a Demand score
and cannot carry one."*

A rule stated in a comment that the arithmetic did not enforce. The class this
repository keeps paying for.

### A dimension is scored only where something measured it directly

`DEMAND_PRIMARY` names the four components that may carry it. A driver is a
reason to *expect* demand, not an observation of it, and no renormalisation
turns one into the other. Nothing but drivers now yields `null` and a named
`missing` list. The reading is not discarded — it stays in `components`, it
still carries its own 0.15 wherever a primary measure is present, and a report
may still print it as evidence.

### And the primary measure the register was already publishing

Every other primary component comes from a vendor feed nobody here is entitled
to. The open sales register prints a transaction **count** beside every median
it prints, and until now only the latest row's count was read — as a confidence
sample size, never as a measurement.

`salesVolumeSeries` carries those counts and `scoreTransactionVolume` measures
the latest period against this market's own trailing mean: a ratio, not a
count, because 162 sales means nothing without knowing whether this postcode
usually does 90 or 300. 1.0 scores 50 for the same reason 3.0% vacancy does — a
market transacting at exactly its own recent rate is in balance with itself.
Three prior periods minimum, because a mean of two moves further on one unusual
period than the reading it is meant to judge.

### What this is not

**Yield's 32 is correct and is untouched.** 3.467% gross against a corpus
median of 4.36% is what this property is; re-anchoring to raise it would raise
every yield in the book, which `SCORE_CRITERIA_AND_CALIBRATION.md` §5 and
S5/S6 §4 forbid by name. Growth and Location are untouched.

**Risk still cannot score.** Hazard and planning are one independent category,
`MINIMUM_INDEPENDENT_CATEGORIES` is 2, and the only other category a house
offers needs a construction year held on 0 of 1,230 stored reports. Four of
five scored remains the honest maximum until an acquisition lands.

### The honest tail

Withholding Demand redistributes its weight across three dimensions whose
weighted mean is 54, so a measured Demand only lifts the composite above that:
a balance-point 50 gives **53**, and it takes about **57** to break even.

**The change is a correction, not a lift.** What it buys is a number that means
something — 48 was a demographic drift reading wearing a demand label.

---

## 8. What was already fixed, and what is still open

### Already fixed — the PDF predated the deploy

Page 36 read *"A further 41,431 characters of this answer are not shown. The
complete text is in the Markdown export."* Both halves of that wording are
Report Q&A's, and `REPORT_BODY_RENDER` has set `truncationSubject: 'report'`
with an empty destination since PR #2715 merged at 05:41 AEST on 20 Sep 2026.

Proven by execution rather than inferred: at the old 65,536 bound the notice
draws with **the exact wording the delivered PDF carries**; at the current
131,072 a body of that size draws whole with **no notice at all**. The report
was generated before that deploy reached production.

### Still open

Read page by page and not yet acted on:

* **Citation markers** — page 21 prints `.12` where markers 1 and 2 run
  together and page 22 prints `23` three times; the Notes list on page 36 has
  four entries. Page 25 reads `sofuture`, a space eaten where a marker was
  stripped.
* **Structural duplication** — the five-row planning controls table is printed
  in full on pages 15, 26–27 **and** 32; the residential-use table on 16, 27 and
  33; "What is mapped over this land" on 17 and 33. The verbatim appended
  registers plus the model's own reproduction of them.
* **Page 2** lists "1. Cover" and "2. Contents" as its own contents entries.
* **Page 27** ends a sentence mid-phrase: *"the land is zoned R2 – Low Density
  Residential, which is intended"*.
* **Page 32** prints an ISO date `2026-09-20` in prose where the rest of the
  document says "20 September 2026" — the `AU_LOCALE` rule, one level down in a
  template string rather than a formatter.
* **Pages 19 and 31** draw a planning-read callout with a large empty area and a
  lone green horizontal bar.
* **Page 21** draws a red zigzag sparkline mid-sentence, described in the
  sentence as *"a gradually rising line"*, in a colour that appears nowhere else
  in the document.
* **Page 22**'s *"Local vs NSW house price growth"* area chart has one series
  where the title promises two, and no axis, no value labels and no legend.
