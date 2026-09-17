# The five reports — implemented / tested / visually verified / released

Four separate states, kept separate on purpose. A change can be written and
under test while nobody has looked at a page it draws, and every one of these
reports has at some point been all three of those without being released.

Nothing here is released. **Production release remains subject to the owner's
approval gate.** The branch is `claude/adoring-hopper-g02tdt`.

| | implemented | tested | visually verified | released |
| --- | --- | --- | --- | --- |
| **Investment Compass** | S1–S3 | 10,246 tests, PDF/UA-1 | 6 pages + 1 tier page + the 36-page Templates render | no |
| **Financial Analysis** | S3 | binding + render specs, PDF/UA-1 | 1 tier page | no |
| **Strategic** | S3 | binding + render specs, PDF/UA-1 | 1 tier page | no |
| **Executive Briefing** | S3 | binding + render specs, PDF/UA-1 | 1 tier page | no |
| **Snapshot** | S3 | binding + render specs, PDF/UA-1 | 1 tier page | no |

## What each column means here

**Implemented** — the change is in the branch and reaches this report through
the shared path (`reportBindingProjection.pure.ts` and the block renderers),
not through a review script.

**Tested** — the report suite passes (10,246 tests, 0 failing), and the
document this report draws validates as PDF/UA-1 against veraPDF 1.30.2. That
is a machine check: it proves the structure tree exists, the heading levels
descend, every figure carries alternative text and the metadata claims what
the file is. **It cannot tell you whether the alternative text is any good.**

**Visually verified** — somebody has looked at every page of a rendered
document for this report. For the Compass that is the six review pages, its
tier page and all 36 pages of the Templates-workflow render. **For the other
four it is one page each**, composed from bindings to show the tier
separation. One page is not a document: the remaining four reports have not
been drawn end to end and read page by page, and that is S5's work.

**Released** — nothing is. No production deploy, no migration, no historical
report regenerated or rewritten.

## The honest gaps

- Four of the five reports are visually verified on **one page**, not a
  document.
- The review pages are a review artefact. Their prose has not been moved into
  the masters, so a production render draws the masters' own copy.
- The frontend journey — selection, editing, saving, reopening, previewing,
  exporting, history and permissions — has not been exercised end to end. S5.
- The ten-year outlook's source work is S4 and is not started.
