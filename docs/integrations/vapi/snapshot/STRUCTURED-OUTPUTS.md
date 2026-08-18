# Structured outputs and scorecards

`artifactPlan` on an assistant can reference two further resource types. Both were found only by walking every field of the assistant payloads — nothing in the assistant record names the endpoint, and neither type appears in any tool, squad or phone-number record.

## Structured outputs — `GET /structured-output`

Six exist. These are the post-call extractions Vapi runs over a transcript: each has an AI-evaluated schema and a description that tells the model what to look for.

| Name | Type | Schema | Referenced by | Description |
| --- | --- | --- | ---: | --- |
| `Appointment Booked` | ai | `boolean` | 3 | Tracks successful appointment bookings from customer calls |
| `Appointment Cancelled` | ai | `boolean` | 1 | Monitors appointment cancellations during calls |
| `Appt Time Selected` | ai | `string` | 2 | Capturing the exact appointment time is essential for scheduling. |
| `Zoom Call Booked` | ai | `boolean` | 1 | Tracking whether the call was booked is crucial for measuring the assistant's effectiven |
| `Zoom Call Booked` | ai | `boolean` | **0** | Tracking whether the call was booked is crucial for measuring the assistant's effectiven |
| `contact_id` | ai | `string` | 1 | GHL contact id |

**One is an orphan.** `Zoom Call Booked` `468022e7` is a byte-for-byte duplicate of `a5b2f26a` — same name, same description, same schema — and no assistant references it.

### `assistantIds` on these records is stale — do not trust it

Each structured output carries an `assistantIds` reverse reference, and **three of the six disagree with the assistants themselves**. All three name `NPC Opt In Follow Up`, which has referenced **no** structured outputs since **2026-01-09** — its `artifactPlan.structuredOutputIds` has been empty across every version since. The assistant is right and the reverse reference was never cleaned up.

Worth stating because it is a trap for a migration script: read the forward reference (`assistant.artifactPlan.structuredOutputIds`), never the reverse one.

| Record | `assistantIds` says | assistants actually referencing it |
| --- | --- | --- |
| `Appointment Booked` | NPC Discovery Call Follow Up, NPC Discovery Call No Show Follow Up, NPC Opt In Follow Up, NPC Quiz Follow Up | NPC Discovery Call Follow Up, NPC Discovery Call No Show Follow Up, NPC Quiz Follow Up |
| `Appt Time Selected` | NPC Discovery Call No Show Follow Up, NPC Opt In Follow Up, NPC Quiz Follow Up | NPC Discovery Call No Show Follow Up, NPC Quiz Follow Up |
| `Zoom Call Booked` | NPC Opt In Follow Up, NPC Quiz Follow Up | NPC Quiz Follow Up |

## Scorecards — no endpoint exists

`NPC Opt In Follow Up` and `NPC Opt In Follow Up Inbound` both reference scorecard `cf81945a-c941-46a2-a538-2987abffe521`. **It cannot be retrieved.** Eleven candidate paths were tried as both a collection and a by-id lookup — `/scorecard`, `/scorecards`, `/score_card`, `/scoreCard`, `/score-card`, `/rubric`, `/rubrics`, `/evaluation`, `/evaluations`, `/assistant-scorecard`, `/call-scorecard`, plus `/artifact` and `/artifact-plan` — and every one returns **404**.

So this is a dangling reference of the same kind as the four missing tool ids: the id is live in two assistant configs, and the object behind it is either deleted or served by an endpoint this API version does not expose. A clone will carry the id across and it will resolve to nothing.

## Not fetched because they are empty

`/eval` returns 0 items. `/template` returns 0. `/knowledge-base` returns 0 — the assistants' knowledge bases are `provider: google` file lists on `model.knowledgeBase`, not managed knowledge-base objects.

