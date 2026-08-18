# Vapi — org snapshot and migration bundle

Two things live here, and they are not the same thing.

| Directory | What it is |
| --- | --- |
| [`snapshot/`](./snapshot) | **The whole org, as it is now.** All 28 assistants and 20 tools with full configuration, plus every squad, phone number, workflow, test suite and file. Read-only capture; no migration opinion. |
| [`npc-services/`](./npc-services) | **The migration bundle.** Only the 15 NPC assistants and their closure, plus the clone plan, tool audit and webhook re-point map. |

Snapshotting is not migrating. The 13 non-NPC assistants are captured in `snapshot/`
for completeness and are **not** in scope for the clone.

## How this was taken

`GET` requests only, against `https://api.vapi.ai`. Nothing in the Vapi org was created,
updated or deleted to produce it. Each collection was checked against an individual
`GET` first — list payloads are byte-identical to single-resource payloads, so nothing is
truncated — and every committed record is byte-identical to the API response apart from
six redacted credential values.

**What is captured per assistant:** the complete record — system prompt (verified
byte-identical, up to 44,426 characters), LLM provider/model/temperature, voice provider
and voice ID with stability/similarity/speed, transcriber, server URL and timeout, first
message, end-call and voicemail messages, timeouts, tool ids, knowledge-base file ids,
analysis and artifact plans, compliance settings, and every other field the API returns —
134 distinct field paths in all.

**Per tool:** type, server URL and timeout, header *names* (values redacted), the full
function schema with parameters and required list, request/response messages, and which
assistants use it.

`assistants-index.json`, `tools-index.json` and [`snapshot/INDEX.md`](./snapshot/INDEX.md)
are derived views for reading at a glance — every value in them also appears in the full
records.

## The org is being edited while this was taken

Two pulls a few hours apart in the same session are not identical, and the difference is
not noise. **`NPC Active Nurturing` and `NPC Inbound Agent` had their `server.url` changed
at 17:28 and 17:29 on 2026-08-18**, from the new Make account back to the Supabase edge
function. Their version counters went v2 → v3. **The account owner made those changes
deliberately** — they are recorded here because the snapshot spans them, not as an anomaly.

Version history records the whole sequence — for `NPC Active Nurturing`:

| When | Server URL |
| --- | --- |
| 2026-08-18 17:29 | Supabase `vapi-call-webhook` (current) |
| 2026-08-18 12:44 | `hook.us2.make.com/my4fk4f1…` |
| 2026-07-22 and earlier | Supabase `vapi-call-webhook` |

The 12:44 entry is this migration's own footprint: creating a Vapi *app* hook in Make
writes its URL into the bound assistant, so those two were repointed as a side effect of
the Make work rather than deliberately. The 17:29 entry undid it. Net effect: **no NPC
assistant now points at the new Make account.**

Treat this snapshot as a point-in-time capture, not a stable baseline.

## Assistant state is captured four ways

The JSON records are the source of truth; these make them usable.

| Path | What it is |
| --- | --- |
| `snapshot/prompts/<sha16>.md` | **286 distinct system-prompt blocks** as plain text — every prompt in the current state *and* in all 444 historical versions, stored once and readable. |
| `snapshot/state/<assistant>.md` | One card per assistant: model, voice with every parameter, transcriber, server, tools (flagging the ones that 404), messages, behaviour flags, prompt links, call counts. |
| `snapshot/history/<assistant>.json` | Every version's **full** configuration, verbatim, with prompts by reference. |
| `snapshot/COMPARISON.md` | The 15 NPC assistants side by side, plus a tool matrix — built for checking against the dashboard. |

**The prompt store is lossless, and that is verified rather than assumed.** All 444 versions
rehydrate to a byte-identical match against the raw API payload, and every live prompt block
is present unaltered. Storing prompts once turns 11.9 MB of near-duplicate JSON into 7.5 MB
of readable Markdown plus 1.2 MB of configuration.

### Call volume — counts only

`snapshot/call-volume.json` records how many calls each assistant has and when the most
recent was. **No transcript, recording, phone number or any other call content was requested
or stored.** It is there to separate live assistants from dormant ones, and it shows
something worth knowing before migrating: **three of the four `NPC Sales Force` squad members
have never taken a call** — `NPC IFC Inbound`, `NPC Strategy Session Inbound` and
`NPC Opt In Follow Up Inbound` are all at zero. Only `NPC Inbound Agent` (37) has traffic, so
the inbound handoff routing has never actually been exercised in production.

## Tool state is captured the same four ways

| Path | What it is |
| --- | --- |
| `snapshot/tool-prose/<tool>.md` | **Everything an LLM reads about the tool**: the function description, every parameter description, the spoken `request-start` / `request-complete` / `request-failed` messages, and any transfer destination. Verified verbatim against the JSON. |
| `snapshot/tool-state/<tool>.md` | Server URL, timeout, header names, async flag, function signature, messages, and which assistants use it. |
| `snapshot/tool-versions/<tool>.json` | `GET /tool/{id}/versions`. |
| `snapshot/TOOLS-COMPARISON.md` | All 20 side by side, an assistant × tool matrix, and every orphan and dangling reference. |

**Every scalar value in every raw tool payload is represented in at least one of these views.**
That is asserted, not assumed — the only exclusions are `orgId`, the constant
`function.parameters.type`, and credential header values, which are redacted by design.
The assertion exists because an earlier version of these views silently omitted four things:
**static body fields** (`tool.parameters`), `variableExtractionPlan`, tool `metadata` and
`function.strict`. The raw JSON always carried them; the readable layer did not.

Static body fields matter most of the four. They are what the tool sends on **every** call
regardless of what the model decides — `transfer_to_human` posts `callerPhone`,
`customer_number`, `vapiCallId`, `calledNumber` and `callType`, all filled from Vapi
template variables. Four of the twenty tools use them, and `phoneNumber_inject` sends
thirteen. `variableExtractionPlan.aliases` is the same story in reverse: it binds fields of
the HTTP response back into Vapi variables, which is how `contactId` and `firstName` become
available to later turns.

The prose files matter more than they look. A tool's description is what decides whether the
model calls it at all, and `ghl_create_booking` alone carries a 500-character description
plus ten documented parameters — that text is the contract, and it is easier to review as
Markdown than buried in JSON escapes.

### Correction: tools *do* have version history

An earlier pass in this session reported that they do not. That was wrong, and the cause was
a path assumption: assistants expose `/assistant/{id}/version` (**singular**), so the same
form was tried on tools, where it 404s. The working path is `/versions` (**plural**).

Worse, the two assistant forms are not aliases — they are different systems, and both are
now captured:

| Endpoint | Returns |
| --- | --- |
| `GET /assistant/{id}/version` | 444 auto-snapshots, full config under a `data` key |
| `GET /assistant/{id}/versions` | 33 **named** versions (v1/v2/v3) with `configHash`, `parentVersion` and **`createdBy`** |
| `GET /tool/{id}/versions` | 20 named versions, one per tool |
| `GET /tool/{id}/version` | 404 |

`createdBy` is the useful addition: it attributes each named version to an account. It is
what confirms the 17:29 server-URL change on `NPC Active Nurturing` was made by
`lavan.smi@gmail.com`, and it is blank on versions the platform generated itself.

## Start here for the inbound squad

[`snapshot/SQUAD-NPC-SALES-FORCE.md`](./snapshot/SQUAD-NPC-SALES-FORCE.md) is a deep-dive on
`NPC Sales Force` — the only place in the org where a caller is routed between assistants,
and the part of the estate with the most moving pieces. Call flow, all four members, the
inline handoff tool, seven findings and what migration has to get right. **Every factual
claim in it is asserted against the raw API data by a check that passes 20/20.**

The headline: the handoff wiring itself is correct and complete, but `NPC IFC Inbound` is
instructed 15 times to call a booking tool it does not have, and the whole squad has never
executed a single handoff in production.

## Squads, phone numbers and the workflow

| Path | What it is |
| --- | --- |
| `snapshot/squad-state/<squad>.md` | Every member, every override, and the **inline `handoff_to_assistant` tool expanded** — its destinations, the condition each is chosen on, and the variables it extracts. |
| `snapshot/phone-state/<number>.md` | What each number routes to, plus `sipUri`, `fallbackDestination`, `smsEnabled`, server — and whether it can be carried across at all. |
| `snapshot/workflow-state/<workflow>.md` | The workflow as a **mermaid graph**, plus every conversation-node prompt, first message, tool node and edge condition, verbatim. |

**None of the three has version history.** `/version` and `/versions` both 404 for squad,
phone-number and workflow. `?version=v1` returns 200 but is byte-identical to the current
record — the parameter is ignored rather than serving history. Assistants and tools are the
only versioned resources.

### `NPC Follow Up` is an uncustomised Vapi sample

The one workflow in the org carries an NPC name and no NPC content. Counted across its
whole payload:

| Term | Mentions |
| --- | ---: |
| Wellness Partners | 6 |
| patient | 38 |
| Riley | 3 |
| Naidu / property / discovery call | **0** |
| NPC | 1 — the name on the record |

Its start node opens *"You are Riley, appointment scheduling assistant for Wellness Partners
health clinic."* **Nothing references it** — no phone number, assistant or squad. Its
`transferCall` node has an empty `destinations` array, so it could not transfer even if
reached. Decide what it is for before migrating it.

### Two numbers route nowhere

`+61286093299` (*Naidu Property Consulting Services*) and `+61281056305` (*NPC Services*)
have no `assistantId`, `squadId` or `workflowId`. Inbound calls to them are unrouted. The
`NPC Services` **Vapi** number is the one wired to the `NPC Sales Force` squad.

## Assistant version history

`GET /assistant/{id}/version` returns a full historical configuration per version — **444
versions across the 28 assistants**, 11.9 MB. That raw history is *not* committed;
[`snapshot/history-index.json`](./snapshot/history-index.json) records, for every version,
its timestamp, server URL, LLM model, voice ID and a hash of the system prompt, which is
enough to see when any of those changed and to fetch the full record on demand.

Tools have named versions of their own at `GET /tool/{id}/versions` — see the correction above.

## What is redacted

Six credential values, replaced with `{{REDACTED:…}}` placeholders and listed by path in
`snapshot/manifest.json`: four Twilio Account SIDs, one Airtable personal access token and
one GoHighLevel PIT token. Nothing else is altered. The last two sit on tools no assistant
calls, and neither appears on the Make rotation list — both should be rotated.
