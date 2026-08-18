# Wiring the new Vapi account into the new Make team

Executed 2026-08-18 against team `2731020` (us2). The legacy Make team (`528268`, eu2)
and the legacy Vapi org were not written to. No scenario was activated.

## What the sweep found

All 37 scenarios in the team were fetched and scanned for every identifier the Vapi
migration minted or retired: the 45 migrated object ids, the 4 un-migrated phone-number
ids, the 13 excluded assistant ids, the source org id, `{{SECRET:*}}` placeholders,
`api.vapi.ai` calls and `x-vapi-webhook-secret` validation.

**17 scenarios reference Vapi data; 15 needed wiring.** The other two carry only
GoHighLevel PIT-token placeholders (`GHL_PIT_TOKEN_CONTACTS`, `GHL_PIT_TOKEN_BOOKING`),
which are not Vapi's concern and stay on the manual runbook. Notably, **no scenario
validates `x-vapi-webhook-secret`** — the header Vapi sends is currently accepted, not
checked, so the freshly minted secret needs no Make-side configuration until someone
adds validation.

## What was changed, per scenario

Two kinds of edit, applied together in one blueprint update per scenario:

1. **Assistant ids** — every reference to a source-org assistant id replaced with the
   new org's id (13 replacements across 13 scenarios; `Discovery Call Handoff` carries
   three, routing between the inbound assistants).
2. **API key** — every `{{SECRET:VAPI_API_KEY}}` placeholder replaced with the new
   account's key (19 occurrences across 14 scenarios), in `Authorization: Bearer`
   headers on `api.vapi.ai` HTTP modules: outbound `POST /call` starters and
   `DELETE /call/{id}` cleanup calls.

| Scenario | Assistant id edits | Key subs |
| --- | --- | --- |
| NPC Delete Opt In Call | — | 1 |
| NPC Delete Quiz Sub Call | — | 1 |
| NPC Active Nurturing | NPC Active Nurturing | 1 |
| NPC Vapi Outbound Sandbox | NPC Discovery Call Follow Up | 1 |
| NPC Discovery Call Live | NPC Discovery Call Follow Up Test 2 | 1 |
| NPC Opt-In Follow Up Test | NPC Opt In Follow Up | 1 |
| NPC Discovery Call Test | NPC Discovery Call Follow Up Test 2 | 1 |
| NPC Discovery Call No Show Live | NPC Discovery Call No Show Follow Up | 1 |
| NPC Strategy Session Follow Up Zoom | NPC Strategy Session (Phone) Follow Up | 1 |
| NPC Quiz Submission Follow Up Test | NPC Quiz Follow Up | 1 |
| NPC Strategy Session Follow Up Test | NPC Strategy Session (Phone) Follow Up | 2 |
| NPC IFC Follow Up Test | NPC IFC Follow Up | 2 |
| NPC Strategy Session No Show | NPC Strategy Session (Phone) No Show | 2 |
| NPC IFC No Show | NPC IFC No Show Follow Up | 2 |
| Discovery Call Handoff | Strategy Session Inbound, Opt In Follow Up Inbound, IFC Inbound | 0 |

## What was deliberately NOT changed

- **Phone-number ids.** Ten scenarios pass a `phoneNumberId` to `POST /call` —
  `de3918be…` (Naidu Twilio) in nine of them, `f53c1661…` (NPC Services Twilio) in the
  sandbox. Phone numbers are not migrated yet, so these still carry the **old** ids and
  every outbound call from these scenarios will fail against the new account until
  phase `07-phone-number` runs and these two ids are swept again. This is the single
  remaining coupling.
- **The two `vapi2` app hooks** (`NPC Active Nurturing Call Report`, `Discovery Call
  Handoff`). They are bound to old assistant ids through "Aurixa's Vapi connection"
  (`10496920`), which holds the **old** account's key. Updating or deleting them could
  make Make fire an *unregister* call at the legacy org with that key — which the
  don't-touch-legacy rule forbids. Events flow correctly regardless: the hooks are
  URL-addressed and the cloned assistants carry exactly these hook URLs in `server.url`.
  The safe rebind is: authorise a Vapi connection with the **new** key, then repoint
  each hook's `data` (`__IMTCONN__`, `assistant_id`, `externalHookId`) at the new
  connection and new assistant ids.
- **GHL PIT placeholders**, scenario scheduling, activation state, and everything in
  the two GHL-only scenarios.

## Verification

Every updated scenario was re-fetched and checked four ways: no
`{{SECRET:VAPI_API_KEY}}` placeholder remains, no old assistant id remains, module
counts are unchanged, and the key is present exactly where a placeholder was.
**15 of 15 pass all four checks.** A manual re-fetch of `Discovery Call Handoff`
additionally confirmed all three route bodies answer Vapi with the new inbound
assistant ids.

## The one step only a person can do

A pending Make **credential request** exists for the new-account Vapi connection
(request `90c491fe-d545-4177-8a10-3b6f6962a17c`, team inbox:
`https://us2.make.com/2731020/credentials-requests/inbox?requestId=90c491fe-d545-4177-8a10-3b6f6962a17c`).
Authorising it with the new account's key creates "NPC Vapi (new account)" — after
which the two `vapi2` hooks can be safely repointed (`__IMTCONN__` to the new
connection, `assistant_id`/`externalHookId` to `66d3e994…` and `b834610e…`), because an
unregister attempt would then hit the new org, where the old ids resolve to nothing.

## The tool webhooks — re-pointed to us2 (second pass, same day)

A follow-up pass re-pointed the cloned tools' `server.url`s from the legacy eu2 hooks to
the new team's us2 hooks — a write to the **new** Vapi org only. Every mapping is
evidence-backed, not name-guessed:

| Tool | New target (us2 hook / scenario) | Evidence |
| --- | --- | --- |
| `get_call_context` | `7lw416w6…` NPC Vapi - get_call_context v1 | Old udid observed in that scenario's own samples; name match. |
| `ghl_check_availability` | `ik45qbx1…` Availability Intent Router (Native) | Only availability scenario; old udid in its samples. |
| `ghl_create_booking` | `017xspgx…` Booking Intent Router (**Generic HTTP PIT**) | Both routers received booking calls historically; Generic's samples run to **2026-05-14**, Native's end **2025-11-26** — traffic moved to Generic. ⚠️ Generic's GHL call still carries the unfilled `{{SECRET:GHL_PIT_TOKEN_BOOKING}}`, a pre-existing runbook item. |
| `ghl_resolve_contact` | `gukfea8c…` Contact Resolver **v4 CANONICAL** | Tool's old udid (`db3ws2lm…`) observed in v4's blueprint; v3 holds the older udid. |
| `phoneNumber_inject` | `8k9ofpk…` Discovery Call Handoff (vapi2 hook) | Tool's old udid matches the handoff's old hook in the cutover table; the scenario answers with an `assistantId`, which is a handoff responder, not a report sink. |
| `ghl_delete_event_npc` | `jutejxif…` NPC Delete Booking Test | Prompts: Rita's (discovery) reminder-flow delete; only non-IFC/non-strategy delete scenario. |
| `ghl_delete_event_npc_2` | `asr1irn2…` NPC Delete Strategy Session | Prompts: `_2_1` is the **Zoom** strategy delete, so `_2` is phone. |
| `ghl_delete_event_npc_2_1` | `brtnxcxd…` NPC Delete Strategy Session (Zoom) | Prompts, verbatim: *"to delete an existing **Zoom strategy session**"*. |
| `ghl_delete_event_npc_3` | `h28wac17…` NPC Delete IFC Session | Prompts: `original_mode = "phone"` → `_3`. |
| `ghl_delete_event_npc_3_1` | `f87otoag…` NPC Delete IFC Session (Zoom) | Prompts: *"delete **Zoom** Initial Finance Consult"*. |

`end_call_tool` has no server URL. **`transfer_to_human` stays on eu2** — its target
scenario, *NPC Vapi - Transfer Caller to Human via Twilio Redirect*, was never cloned
into the new team, so there is no us2 hook to point it at. Clone that scenario, then
re-point the tool.

All ten PATCHes verified by read-back: URLs exact, and no other tool field drifted.

## Assistant server URLs — synced to live source truth

Comparing every new-account assistant against a fresh pull of the source found two
drifts and one stale straggler, all fixed:

- **NPC Active Nurturing** and **NPC Inbound Agent** — the source moved them to the
  Supabase edge function `…supabase.co/functions/v1/vapi-call-webhook` at 17:29, *after*
  the clone bundle was captured, so the clone carried the older us2 Make-hook values.
  Both now match the source (URL + `x-vapi-webhook-secret` header, which carries the
  **minted** secret, never the leaked one; `staticIpAddressesEnabled: false` mirrored on
  Inbound Agent).
- **NPC Discovery Call Follow Up** — the source itself still points at a dead eu2 hook
  (`xoktvkk0…`, last updated 2025-11-26, belonging to no exported scenario; flagged
  "must be re-pointed" in `assistant-server-urls.json` since capture). The clone now
  points at the same Supabase function as its Test twin and every sibling. This is a
  deliberate divergence: the clone is ahead of the source, which remains stale.

Final state: **zero `hook.eu2.make.com` references anywhere in the new Vapi org except
`transfer_to_human`**, which is flagged above.

## The `vapi2` hook rebind — completed with the new-account connection

The user created **"Aurixa Systems"** (connection `10508414`), a Vapi connection holding
the new account's key. That unblocked the rebind, done by the path that provably cannot
touch the legacy org: **new hooks were created rather than the old ones edited**, so Make
never had a reason to fire an unregister call with the old key.

| Scenario | Old hook (old-key connection, old assistant id) | New hook (conn `10508414`, new assistant id) |
| --- | --- | --- |
| NPC Active Nurturing Call Report | `2705105` (`my4fk4f1…`) — parked | `2707363` (`xhh35t8m…`) → assistant `66d3e994…` |
| Discovery Call Handoff | `2705117` (`8k9ofpk…`) — parked | `2707365` (`pncd1qrc…`) → assistant `b834610e…` |

Three things the operation surfaced and settled:

- **The key check was structural.** The new hooks were bound to *new-account* assistant
  ids, so if the connection had accidentally held the old key, registration would have
  404'd and failed harmlessly. Both registrations succeeded (`externalHookId` echoes the
  new ids) — proof the connection holds the new key.
- **Hook registration overwrites the assistant's `server.url`** — confirmed live: both
  assistants briefly pointed at the new hook URLs. Both were restored to the Supabase
  `vapi-call-webhook` function, which is the live source truth; in the source the same
  hooks sit registered-but-parked in exactly this way.
- **`phoneNumber_inject` followed the scenario**: its tool `server.url` was re-pointed
  from the old handoff hook to the new one (`pncd1qrc…`), since the scenario now listens
  there.

The two old hooks (`2705105`, `2705117`) are parked, referenced by nothing. **Do not
delete them until the legacy Vapi account is decommissioned** — deletion is the one
operation that could make Make unregister against the legacy org with the old key. The
old connection `10496920` is likewise kept until then.

**Legacy integrity was verified twice by full read-only re-pull** — immediately before
and immediately after the hook operations: all six resource types byte-identical to the
pre-push snapshot both times. Nothing in the legacy Vapi org was changed at any point.
