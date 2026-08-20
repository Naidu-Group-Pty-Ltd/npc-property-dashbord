# PEP source reachability — the spike

Read this before writing an adapter for any PEP source, and before adding a
candidate to `scripts/aml/pepSourceCatalogue.mjs`.

## Why it exists

A list of "authoritative machine-readable government datasets" is a
**hypothesis**. Building twenty bespoke adapters against sources nobody has
fetched is how a programme discovers, in week three, that half of them answer
403 to anything without a browser.

`scripts/aml/pep-source-spike.mjs` fetches every candidate once and reports
what actually came back. It writes nothing, it is on no schedule, and it never
fails the build — an unreachable government website is the finding, not a
broken repository.

## The two things it does that a status code cannot

**It sniffs the bytes.** `Members_List.csv` answers HTTP 200 with 184 KB and a
body beginning `%PDF-1.7`. The extension says CSV, the `Content-Type` header
can say anything, and the content is a PDF. Any check that trusted the URL
would have recorded that source as working, and an adapter would have been
written against it.

**It names a block page as a block.** A WAF answers 200 with HTML saying
"Access Denied" as readily as it answers 403. A run that counts that as a
success is measuring nothing.

## The controls, and why the results are interpretable

A bare list of status codes cannot tell "this source blocks automated clients"
from "this environment cannot reach `.gov.au` at all". So every run includes:

| control | expectation |
| --- | --- |
| **DFAT consolidated list** | Known good **from GitHub Actions** — the sanctions loader pulls 3,846 entries from a runner on a schedule. Known **blocked** from the dev container. |
| **data.gov.au CKAN API** | Known good from anywhere. Distinguishes a proxy fault from a WAF. |

**If the DFAT control fails, the run measured the network rather than the
sources, and every other line in it is a lower bound rather than an answer.**

## Results — development container, 2026-08-20

`6 / 22 candidates usable`. **The DFAT control FAILED**, exactly as predicted,
so this is a **lower bound** and not the number to plan against.

### Usable

| source | tier | what came back |
| --- | --- | --- |
| **APH — Senators list** (`allsenel.csv`) | A | **75 senators**, real CSV: title, surname, given names, preferred name, initials, post-nominals, state, party, gender, electorate |
| Parliamentary Handbook | B | 200, HTML |
| Queensland Parliament — members | B | 200, 1.7 MB HTML |
| AGOR (organisations register) | A | 200, CSV — bodies, not people |
| SA local-government data portal | A | 200, JSON |
| Wikidata SPARQL | C | 200, JSON |

### Not usable

| source | result |
| --- | --- |
| **APH — Members list** (the path the proposal names) | 200, **PDF** wearing a `.csv` extension |
| **Directory.gov.au bulk XML export** | Does not complete — current *and* retired host |
| PM&C ministry list | 403 · Incapsula block page |
| NSW, VIC, TAS, ACT parliaments | 403 · Cloudflare block page |
| WA, SA parliaments | 404 (paths need discovery) |
| NT Legislative Assembly | 503 |
| High Court, Federal Court, Defence, DFAT missions | 403 |

### Findings that change the design

**1. The APH Senators CSV is real, and Tier A.** The proposal's central claim —
that Parliament publishes machine-readable member data — is **correct**. The
path it named for Members is not.

**2. APH's static media path serves; its HTML pages do not.** `/-/media/…`
returns files while `/Senators_and_Members/…` returns 403. Any APH adapter has
to be built around that asymmetry, and the Members CSV filename must be
discovered rather than guessed — six symmetrical guesses all returned the same
404 page.

**3. Directory.gov.au's bulk export is the weakest link in the proposal.** It
is listed active on data.gov.au and it did not complete once, on either host.
It is also the source the proposal rates "best replacement". Until a run from
CI says otherwise, it should not be planned around.

## Results — GitHub Actions runner

> **Not yet run.** `workflow_dispatch` is only exposed for workflows present on
> the default branch, so the spike must be merged before it can be dispatched.
> The workflow writes nothing and touches no secret.
>
> Record the numbers here when it has run. The comparison between the two
> environments — not either column alone — is what decides which adapters get
> built.

| source | dev container | GitHub runner |
| --- | --- | --- |
| _(fill from the run)_ | | |

## How to run it

```
node scripts/aml/pep-source-spike.mjs --timeout 60 --json report.json
```

or dispatch **AML PEP source reachability spike** in Actions, which prints the
same report into the run summary and uploads the JSON.

## The rule this spike is protecting

Every source that reaches the screening engine must be able to report three
states that are never collapsed: **searched — no match**, **searched —
possible match**, and **not searched**. A source whose reachability was assumed
rather than measured is a source that will one day report the third as the
first, which is the failure the whole engine is built to prevent.
