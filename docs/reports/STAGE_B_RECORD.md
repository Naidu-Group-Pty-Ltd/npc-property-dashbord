# Stage B — the five formats, produced and read

19 September 2026. Branch `claude/reporting-engine-audit-4850hs`, PR #2700.
Stage A's record is [`STAGE_A_RECORD.md`](./STAGE_A_RECORD.md).

Stage B asked for **all five complete revised formats, every page inspected.**
This is what was produced, how, and what reading the pages found.

---

## 1. What was produced, and what it is

Every document below came out of the **real delivery journey** — the report
page, the editor, the template picker, the Publishing & Export panel, the
finalisation and the send — driven in a real Chromium against the running
application, with the final PDF drawn by **WeasyPrint 69.0**, the version
`weasyprint-service/requirements.txt` pins. No credential, no network, no side
effect outside the process.

| tier | document | subject | record |
|---|---|---|---|
| `compass` | Investment Compass | 48 Redfern Street, Cowra | `09f8569e` |
| `financial` | Financial Analysis | 48 Redfern Street, Cowra | `8b0c7c8d` (a fork of `09f8569e`) |
| `strategic` | Due Diligence Report | 48 Redfern Street, Cowra | `bd1b75a7` (a fork of `09f8569e`) |
| `briefing` | Executive Briefing | 1/27D Mitchell Street | `89b451f6` |
| `snapshot` | Snapshot Report | 1/27D Mitchell Street | `8c6edc56` |

**Three of the five are the same property.** The Cowra record has 42 `financial`
and 42 `strategic` children in the retained set and **no** `briefing` or
`snapshot` child, so those two tiers are read on the record that has them. Both
are named rather than left to be assumed.

**These are stored records rendered through the real composition and render
path. They are not fresh generations** — Stage A's §1 says why, and it has not
changed: acquisition runs in deployed edge functions and this branch is
unmerged.

---

## 2. What the journey and the measurement say

| tier | journey | pages | fonts embedded | measurement |
|---|---|---:|---|---|
| Compass | **33/33** | 31 | 11/11 | **PASS**, no issues |
| Financial Analysis | **33/33** | 21 | 12/12 | **PASS**, no issues |
| Due Diligence | **33/33** | 24 | 12/12 | **PASS**, no issues |
| Executive Briefing | **33/33** | 11 | 6/6 | **PASS**, no issues |
| Snapshot | **33/33** | 11 | 5/5 | **PASS**, no issues |

No illegible text, no off-page run, no overlapping run, no mojibake, no blank
page, no hole, no client-facing sentinel, correct page numbering on every
numbered page.

**That is not evidence of completion, and is not offered as any.** §1 of the
standard says so in terms: passing clipping and overlap checks is not
sufficient. What follows is from reading the pages.

---

## 3. What reading the pages found

### 3.1 A figure in a summary strip, on 83 of 89 stored reports — FIXED

Page 4 of the Cowra Compass drew, at display size:

```
INDICATIVE LOCAL GROWTH
3.52%
Annual house price growth, Cowra (latest published)
```

`3.52` appears **exactly once in the whole record** — inside the model's own
prose, as the `::: stat` fence that draws it — and `data_sources.marketData` is
`null`. The words *"(latest published)"* assert a provenance nothing holds.

The directive contract could not see it. `assessChartEvidence` walks lines
beginning `{{`, and a stat card is one of the five `:::` fences
`renderMarkdown` draws. §2 asks for the contract to hold over *"charts, tables,
prose, captions, summary strips and recommendations"*, and a stat card is a
summary strip.

Measured across the 89 retained reports: **85 stat fences, 3 distinct**, and
the growth one is in **83** of them, because it rides the parent's content into
every fork.

| fence | value | record | verdict |
|---|---:|---|---|
| Indicative local growth · *Annual house price growth, Cowra (latest published)* | 3.52 | `marketData: null` | **refused** — `market_not_held` |
| Mining share of workforce · *ABS Census 2021, POA* | 41.2 | demographics + employment answered | kept |
| 10-year population change · *SA2 Moranbah · 2015–2025* | 9.7 | demographics answered | kept |

The rule is the record, not the words: the same module keeps Moranbah's two
figures because that record's producers answered, and refuses Cowra's because
its market producer did not. **Judging a fence is not scrubbing prose** — a
fence is a structure with a kind, a label, a unit, a subtitle and one value,
which is exactly the property that makes a directive judgeable. Removal takes
the whole block, never half a fence, and the prose either side is untouched:
re-rendered, page 4 keeps *"free-standing houses on generous blocks"* and
*"Property fit"* and no longer carries the figure. 31 pages, VISUAL PASS.

The prose half moved with it: `claimSupportRules` rule 2 forbade a proportion
of sales and said nothing about a growth rate, a median, a yield or a vacancy
rate. It names them now, and names the stat card.

### 3.2 The editorial changes have not reached a document — EXPECTED, AND VISIBLE

Page 4 still runs `Part 03 · Report` in the running head and still carries the
heading *"The report"*. Both were fixed in Stage A. They have not reached the
page because **the seeded catalogue has not been regenerated** — §5.5 of the
Stage A record — and this render is the proof of that caveat rather than a
counter-example to it.

### 3.3 What still stands in the stored documents

Every §2 claim traced in Stage A §5.2 is visible on these pages, exactly as
that record says: *"detached, renovated 3-bedroom residential home"*,
*"Bedrooms: 3"*, *"Bathrooms: 1"*, *"Well-presented renovated home"*. All are
closed at the producer and none is rewritten here, because a corrected revision
is a generation.

Two more, recorded rather than fixed, because both need the regeneration:

- **A listing portal is cited for a planning fact.** Page 4 states *"no
  bushfire, flood or heritage overlays on public mapping"*, sourced to
  `[Property.com.au, 119, 120, 137 and 139 Redfern Street profiles]` — four
  OTHER addresses. `planningFactBlocks` rule 4 already forbids writing that no
  overlay applies, and the acquisition ledger and the rebuilt chapter are what
  replace it.
- **The parking count is asserted and then doubted.** Page 3 prints
  *"Configuration · 1 car"*; page 6 says *"1 off-street space recorded in some
  data sources, on-site parking layout should be confirmed at inspection as
  online listings differ slightly"*, and the glance strip carries
  *"⚠ Off-street parking to be confirmed on inspection"*. `property_specs`
  holds `parking: 1`. One record, three confidences.

---

## 4. What Stage B has not closed

1. **No fresh generation**, for the reason Stage A gives.
2. **The seed has not been regenerated**, so no master change is on a page yet.
3. **`briefing` and `snapshot` are read on a different property**, because the
   Cowra record has no child of either tier.
4. The two findings in §3.3 are recorded and not fixed.
