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
