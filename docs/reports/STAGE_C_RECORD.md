# Stage C — the release, and what is proven before it

19 September 2026. Branch `claude/reporting-engine-audit-4850hs`, PR #2700.
Stage A's record is [`STAGE_A_RECORD.md`](./STAGE_A_RECORD.md), Stage B's is
[`STAGE_B_RECORD.md`](./STAGE_B_RECORD.md).

Stage C is R1–R12 and the preservation checks, CI green on the final head, the
authorised merge / deploy / browser-publish gates, and fresh Annabelle and
Pallas journeys producing ten PDFs within the A$25 limit.

**Most of R1–R12 needs the deployed candidate.** `S5_ISOLATED_RUN_REQUEST.md`
defines them: R1 is generation end to end including resume, R2–R3 an edit read
back unchanged, R4–R5 template apply and change surviving a reload, R6–R7
preview against export, R8–R9 navigation and permissions. Every one of those
runs in the application against deployed edge functions. They are what the
merge and deploy unlock, and nothing here claims them.

**The preservation checks do not need it, and they are done.**

---

## 1. The read-path preservation check

The standard's rule is that a change to how a report is READ must preserve
*"verified facts, accepted financial inputs, material findings, user edits,
historical records"*, and that *"infrastructure evidence must not silently
change the financial model."*

Nothing on this branch writes to a report row, so the stored bytes are
trivially unchanged. The question that matters is what a **reader** now gets.
So the same read path was executed over the same **105 stored rows** at this
branch's head (`601bae591`) and at its merge base (`6d2a9c987`), in a worktree,
and the two captures diffed field by field.

`scripts/verify/read-path-preservation.mts` and its companion
`read-path-preservation-diff.mjs` are retained so this is re-runnable rather
than a claim. Every import in the capture is optional, because a module this
branch created does not exist at the base — which is what lets one file run at
both revisions.

```
rows compared: 105
prose byte-identical: 105 of 105
directives removed by the evidence contract: 831
loan structure sentences DERIVED (base had none): 104

unexpected differences: NONE
```

Compared on every row: the prose a client reads (hashed and line-counted), the
directives kept, and then **`capitalGrowth`, `cpiGrowth`, `occupancyWeeks`,
the whole `keyMetrics` object, the whole `initialCosts` object, the year-1 and
year-10 moderate projections, the template projection's entire `financials`
block, and every field of `loanDetails`** — `monthlyPayment`, `annualPayment`,
`totalInterest`, `interestRate`, `loanAmount`, `loanType` and `structure`.

Two differences are expected and are the work itself:

- **831 unsupported directives removed** across 105 documents, each returned on
  `findings` as the internal audit record rather than deleted silently.
- **104 loan structure sentences derived** where the base carried none — a
  disclosure added beside the figures, never a figure changed. The 105th row
  holds no loan block.

**Everything else is identical, including every figure named above.** The
accepted CGR is untouched on every row; so is every projection, every key
metric, every acquisition cost and every repayment.

### What the first run got wrong, and why it is worth recording

The first pass reported **99 of 105 documents with changed prose**, which would
have been a serious finding. It was my measurement, not the code: the prose
filter excluded `{{…}}` directive lines and not `::: stat …  :::` fences, so
the summary-strip removals (Stage B §3.1) counted as prose. A stat fence is a
label, a unit and a value — a card, not a sentence — and it is now excluded
with the directives, while every other fence kind (pull quote, sidenote,
divider, quote page) keeps its content in the comparison, so a change to one
would still show. Re-run: 105 of 105.

The rule that catches this class is the repository's own, and it is why the
check reports a hash rather than a verdict: **a preservation check that cannot
say what changed is not a preservation check.**

---

## 2. The seed regeneration — v15

Until the seeded catalogue is rebuilt, **no master change on this branch
reaches a deployment**: the masters are authored in `scripts/template-library/`
and the database reads a generated migration. The latest was **v14**
(`20261203000000`, written 18 Sep), which predates both of this branch's master
changes.

### The one-query check, answered

`buildSeedCatalogue.ts` carries its own rule in its header: *"if
`20261203000000` is already recorded, the next change needs a v15."* Editing an
already-applied seed in place is **inert** — the file changes, the database
does not, and the masters silently never ship. That is the exact silent-failure
shape this programme keeps finding, so it was checked rather than assumed.

The SQL tool is unavailable in this session and that restriction is not
bypassed. The applied-migration list is Management API metadata, not SQL
execution, and it is the same answer:

```
total applied migrations: 980
  20260918090000 (v11) applied: True
  20261112000000 (v12) applied: True
  20261202000000 (v13) applied: True
  20261203000000 (v14) applied: True
```

**v14 is recorded**, so this is **v15**
(`20261204000000_seed_template_library_v15_running_head_and_columns.sql`).
The asymmetry also favours it independently: the migration upserts on
`(slug, version)`, so a v15 is correct whether or not v14 had run, while
editing v14 is correct only if it had not.

### What it wrote

```
✓ 543 templates validated against the live schema
  43 voice, 50 Investment Compass, 50 Borrowing Capacity, 50 Portfolio
  Performance Review, 50 Property Comparison, 50 10 Year Cash Flow, 50 Client
  Details Form, 50 Cash Flow Comparison, 50 Report Q&A, 50 Commercial &
  Industrial Capacity, 50 Market Intelligence
  477 production-ready, 66 preview-only
  → 20261204020000_seed_template_library_v15_running_head_and_columns.sql (40,679 KB)
```

The master changes are in it, by count against v14:

| marker | v14 | v15 |
|---|---|---|
| `narrative.chapters` bindings (the running head names the chapter) | 0 | **880** |
| `As assessed` eyebrow (the `The report` heading block) | 44 | **0** |
| `"Permits"` column head (Commercial Capacity constraints table) | 50 | 50 |
| seeded rows | 544 | 544 |

The third change is the constraints table's column widths, which the QA gate
measured directly (`0 of 50 overlap, 0 of 400 rows wrap`) and which
`commercialCapacityCatalogue.spec.ts` fails on the old values — all three come
from one generation off one source tree, in one run.

### Two things the first attempt got wrong, both caught by a gate

**The version collided.** `20261204000000` is already carried by
`20261204000000_client_files_bucket_and_accrual_repair.sql`, and
`20261204010000` by `20261204010000_email_followup_reminders.sql`.
`check-migration-version-collisions.mjs` failed the `security` job and is right
about why: *one version records one ledger row, so the others can never be told
apart from applied.* The seed is **`20261204020000`**.

**And a seed alone is not the change.** The v14 refresh's own comment states
it: *"adopted masters are COPIES, and nothing else updates a copy after
adoption. A library seed alone changes what a NEW adoption gets and leaves
every document people already generate drawing the old page."* Seeding the
library without refreshing the active masters would have changed the running
head for a future adoption and left every existing report drawing
`Part 03 · Report` — the silent half-fix this programme keeps finding, in the
release step itself.

So **`20261204030000_refresh_active_masters_from_library_v15.sql`** follows it,
with the mechanics of the v13 and v14 refreshes unchanged: the entry's current
schema with **this row's own token colours carried forward** (the colourway
bake is exactly that merge, so no palette is invented), `entryVersion` advanced
so the picker keeps recognising the copy, and rows with no library lineage,
inactive drafts and rows the library no longer lists left untouched.
Idempotent.

Re-run: `check-migration-version-collisions.mjs` **passes** (997 files, 32
frozen collisions over 77 files, **0 new**), `check-migration-security.mjs`
passes (96 migrations at or after 20260909000000), gate wiring and gate-env
wiring pass.

`npm run templates:library:verify`: **30 files, 2,869 tests passed.**
`npx tsc --noEmit` clean.

**Nothing is deployed by this commit.** A seed migration reaches the database
through `apply-migration.yml` on a merged file, and the merge is itself a gate
that is not mine to open.

---

## 3. How the served build can be verified, and which half cannot

Stage C asks for the served build to be **verified rather than inferred from
Lovable's latest edit**. That is worth settling before the deploy rather than
after, because half of it cannot be done from here — and finding that out
afterwards is how a gate becomes a formality.

Measured 19 Sep 2026 from the production egress, read-only GETs, no
credentials:

| origin | answer |
|---|---|
| `https://npc-property-dashbord.lovable.app` | **302** → `https://command-centre.npcservices.com.au/` |
| `https://command-centre.npcservices.com.au` | **403**, Cloudflare managed challenge (`Just a moment…`, 5,402 bytes) |
| `https://dduzbchuswwbefdunfct.supabase.co/functions/v1/render-template-pdf` | **405** — the function's own answer |
| `https://dduzbchuswwbefdunfct.supabase.co/functions/v1/generate-investment-report` | **400** — the function's own answer |

This refines what Stage A recorded. That record said *"401 at both Lovable
origins"*; the Lovable origin now **redirects to the custom domain**, so there
are not two independent refusals — there is one WAF and one answer. The
conclusion is unchanged and now rests on a measurement of both paths.

So the verification splits:

| what this branch changed | where it runs | verifiable from here after the deploy |
|---|---|---|
| the read-path rules, the evidence contract, the loan structure sentence, the fork classifier — everything in `supabase/functions/_shared/` | edge functions | **Yes.** The origin answers this egress with the functions' own 405/400, so a deployed change can be proven by production effect, unauthenticated, as this programme has done before. |
| the seeded masters (v15) and the PDF outline in `src/lib/reportTemplate/` | the browser bundle | **No.** Behind the challenge above. Fetching the bundle and grepping for a marker only the new code carries is the usual method and it is unavailable. |

**One human action, named once and unchanged:** open
`command-centre.npcservices.com.au` signed in to the tenant, or the Lovable
editor, and confirm the last **publish** — not the last edit. Nothing here
substitutes for it, and no substitute would be sound.

---

## 4. What Stage C still owes

1. **CI green on the final head** — the PR is watched and each push has
   reported a clean check suite; the final head's suite is what the merge gate
   reads.
2. **The authorised merge, deploy and browser-publish gates**, and the served
   build verified by fetching it rather than inferred from Lovable's latest
   edit.
3. **R1–R12 in the application**, which the deploy unlocks.
4. **The fresh Annabelle and Pallas journeys** — ten PDFs, real generations,
   within A$25 (**A$0.00 spent**). They are also what settle the two questions
   Stage B named and deliberately did not turn into rules: whether a retrieved
   growth reading can disagree with the accepted CGR unnoticed, and whether
   condensation can introduce a claim its parent did not make.
