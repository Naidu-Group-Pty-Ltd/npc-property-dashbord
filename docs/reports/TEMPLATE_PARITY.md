# Template parity: a template changes the layout and nothing else

The owner set the rule on 26 Sep 2026. For every report type other than the
five Investment tiers, a document drawn through a design-system template must
carry exactly the information the report's standard document carries. The
template decides how the document looks: its cover, colourway, typefaces and
running furniture. It never decides what the document says.

On 26 Sep 2026 each non-Investment report type's standard document and its
template document were rendered from the same real record, on the catalogue's
masters, and compared. **None of the nine carried the same information.** This
document records every difference found, the protection shipped while they are
fixed, and the rule a report type must pass before its templates are used
again.

## Why nothing caught it

The tests that existed checked wiring:

- each projection restates its format's normaliser;
- each master binds only paths the projection publishes;
- each master renders without an unresolved binding.

All three held, and the documents still differed. No test had ever rendered one
record through both paths and compared what each printed. A master can bind
only published paths and still leave half of them unbound, cap a list at three,
or state something the record does not say.

## What is in force now (Phase 0)

### The nine report types are held on their standard documents

`supabase/functions/_shared/reports/templateParity.pure.ts` is the one
register. `TEMPLATE_RELEASED_REPORT_TYPES` names the report types whose
template path is released, and today it names `investment` alone.

`tryTemplateDocument` reads the register before it reads the record or the
person's choice, so no delivery path can reach a template for a held report
type:

- the download, the email attachment and the portal publish all go through it;
- the report type is normalised first, so every alias is held with its format;
- anything not released is held, an unknown spelling included, so a new alias
  cannot release a format by accident.

A held report type is produced as its standard document for everyone, whatever
template they chose. The standard document is the complete one, so nothing is
lost.

**The person is told.** A choice that is kept but not applied must never look
like one that was honoured:

- the chooser shows "This report uses its standard layout for now" above the
  designs, and still lets a choice be saved;
- the Template per report format card marks each held format "On hold";
- a download with a saved choice shows the same notice beside the file.

The notice is information, not a warning: nothing failed.

The Cash Flow finalisation key records the template **in effect**, which is
none while the report type is held. A choice cannot change the key of a
document it did not change, and a document produced while held cannot be
served as the templated one after release.

### Report Q&A prints the answer chosen

The Q&A adapter is never told which answer was chosen, and every content page
of the Q&A masters draws `qa.answer`. So the templated "This answer" printed
the conversation's FIRST answer whatever was chosen, and the templated
"transcript" printed the first answer and none of the others.

The adapter now declines all three subjects, as it already did for the
structured write-up. `render-report-qa-pdf`, which is addressed by message and
paginates a transcript of any length, draws every Q&A document.

"Add to this chat" never takes the template path, because only the route
writes the chat message. The chat is said to hold the file only when the
route's answer names the message. When the message could not be written, the
file is saved to the person's downloads and they are told which of the two
happened. (`qaTemplateDeclines.spec.ts`)

### No clone's cover carries the house's tagline (seed v23)

All 500 family masters set "Your dedicated property partner", the house's own
tagline, as a literal under the cover wordmark. That included the Investment
masters. Every clone's templated cover therefore carried the house's words
under the clone's name.

The masters now bind `{{org.tagline}}`. `applyOrganisationProjection`
publishes it on the prime alone, with exactly the words the literal carried:

- the prime's covers print what they always printed, and the renderer draws
  every cover byte for byte as it drew it with the literal;
- a clone's cover draws no tagline, because a bound text block that resolves to
  nothing is not drawn.

`coverTaglineIsTheIssuers.spec.ts` renders all 500 covers both ways.

Seed `20261225090000_seed_template_library_v23_issuer_tagline.sql` and its
refresh `20261225100000_refresh_active_masters_from_library_v23.sql` carry it
to the library and to every unedited active master. Compared row by row with
v22:

- 500 of 543 rows differ, each in exactly one block, in `schema` and
  `preview_schema` alike;
- `required_bindings` gains `org.tagline`;
- the 43 voice templates are byte-identical.

## What was found, report type by report type

These differences were measured on 26 Sep 2026. Each is closed in Phase 2 by
construction (below), and the release check proves it.

### Shared by every report type

- Every cover printed the house's tagline as fixed text. **Closed by seed v23.**
- A list or table with three or more slots is not drawn when only one item
  fills it, so a single recommendation hides the whole list.
- Content placed in a heading's intro line is lost on families that do not
  draw that line.
- The template prints the platform's standard disclaimer when no firm
  disclaimer is set; the standard document prints none.
- Charts are dropped where the same data sits in a table.
- The company name is resolved in the opposite order on the two paths: Report
  Settings first on the template path, Branding first on the standard path.

### Report Q&A: blocker

- "This answer" printed the first answer, whichever was chosen. **Closed by
  the decline.**
- "Full transcript" printed only the first answer; questions 2 to 7 were
  listed without answers and question 8 onward was not listed. **Closed by the
  decline.**
- An answer was limited to eight pages: on a real 28,690-character answer,
  Chancery printed about half.
- The page made false statements, such as "all 4 exchanges" and "The first
  exchange is set in full".
- "Add transcript to this chat" attached nothing and reported success.
  **Closed.**
- The structured write-up was already identical: it uses the standard route.

### 10 Year Cash Flow: blocker

- The figures are after tax, while every master says "No tax position is
  modelled".
- A stored scenario series could replace the series the adviser reviewed on
  screen (a test: −$8,200 a year against the reviewed −$3,500).
- Stored deposit, loan and rate figures overrode the reviewed ones ($150,000 at
  5.90% against $160,000 at 6.10%).
- Dropped: purchase price, market value, term, weekly rent and yields; the
  year-one table and the per-year rows; the stated assumptions, the notes, the
  projections caveat and "Prepared for".
- Added: holding-cost components, and a principal-and-interest repayment
  printed on interest-only loans.
- Recomputed: LVR against the purchase price instead of the market value.

### Borrowing Capacity: the template is never used

- The browser looks the assessment up in a table it cannot see (0 of 128 rows
  by the repository's own measure), so the choice does nothing.
- Were it reached, it would drop the scenario comparison, recommendations past
  three, warnings past two of up to five, the audit trail's Effect and Rule
  columns and summary, and the LMI details.
- It would also word LMI wrongly for one of its modes and show a blank expense
  method for two methods.

### Client Details

- The primary contact's email, mobile, date of birth and gender are never
  printed.
- Dropped: the home section, the SMSF details, every expense line and the
  expense total, per-property equity and rent, employment contact details, and
  other income past its first line.
- False statements: "No income recorded" beside other income, and "every figure
  is summed from the rows it prints" once rows are dropped.
- Silent gaps: address history is cut at four entries with no note, and a
  failed read of related records prints as "nothing recorded".

### Portfolio

- The opening summary is not drawn on 18 of 50 masters, Chancery included.
- One page can show two different portfolio values, because the headline reads
  different fields from the body.
- Lists are capped with no note: strengths, concerns, risks, mitigations,
  recommendations, findings and verdicts.
- Dropped: the detailed recommendations, the 12-month action plan, the
  per-property analysis and most holdings columns.

### Property Comparison

- Strengths and concerns are printed for the first-ranked property only, three
  of each; a real record lost 14 bullets.
- Risk text is cut at 255 characters.
- Red flags appear only when there are two or more, and then only two;
  runners-up are capped at 2, "avoid" at 1 and alternative scenarios at 1.
- Missing: the ranking weights, "Prepared for" and two charts.
- Added: internal engineering remarks on 32 of 50 masters, and a claim about
  "the one the analysis would buy" on records with no pick.

### Market Intelligence

- Each layer gets three pages: on Chancery a 16,261-character layer prints
  about 7,700, with a note saying it continues. The standard document allows
  20,000 characters a section.
- Five sections are cut with no note: correlation, research, the executive
  summary, the briefing and the strategy.
- 6 of 60 sources are printed, under a reference to a "full edition" that does
  not exist.
- Events are capped.
- On an unbranded clone the template prints a platform advisory close that the
  standard document suppresses.

### Commercial & Industrial Capacity: the figures are identical

- A first render has no Analysis section, because the template path never
  generates one.
- Next actions vanish when nothing is outstanding.
- The funding-shortfall warning is missing on 21 of 50 masters, Chancery
  included.
- The engine's own disclaimer is printed by none of the 50 masters.
- The method trail shows 5 of 20 steps and points to a document the reader
  does not have.

### Cash Flow Comparison: cannot use a template

- It has no adapter, and its delivery never asks for a template. The 50 masters
  exist only as previews on sample data.
- Wired up as they stand, they would still fall short: they are fixed at ten
  years and carry only cumulative figures.

## How parity is reached (Phase 2)

The approach is **design from the template, content from the standard
composer**:

- the chosen template supplies the cover, colourway, typefaces and running
  furniture;
- the report type's own standard composer supplies every body page.

The information is then identical by construction. A field added to a composer
reaches every template the day it is added, rather than having to be added to
50 masters. The alternative, fixing the masters field by field, is nine report
types × 50 masters, and it drifts again the next time a composer changes.

## Releasing a report type

A report type joins `TEMPLATE_RELEASED_REPORT_TYPES` only when all three of
these hold:

1. **Its parity check passes in CI.** For the same real record, on every
   master, everything the standard document prints is found in the template
   document, and the template document states nothing the record does not
   support.
2. **The owner has read one sample PDF** of the report type through a template.
3. **The register is edited**, in one line, in the pull request that carries
   the check.

A surface must never release a report type by itself. The register is read by
the one function every delivery path calls, and `templateParity.spec.ts` pins
its contents, so a release is a reviewed change to the register and its test
together, never a side effect of other work.
