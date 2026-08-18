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

## Assistant version history

`GET /assistant/{id}/version` returns a full historical configuration per version — **444
versions across the 28 assistants**, 11.9 MB. That raw history is *not* committed;
[`snapshot/history-index.json`](./snapshot/history-index.json) records, for every version,
its timestamp, server URL, LLM model, voice ID and a hash of the system prompt, which is
enough to see when any of those changed and to fetch the full record on demand.

Tools have no equivalent: `GET /tool/{id}/version` returns **404** for all 20.

## What is redacted

Six credential values, replaced with `{{REDACTED:…}}` placeholders and listed by path in
`snapshot/manifest.json`: four Twilio Account SIDs, one Airtable personal access token and
one GoHighLevel PIT token. Nothing else is altered. The last two sit on tools no assistant
calls, and neither appears on the Make rotation list — both should be rotated.
