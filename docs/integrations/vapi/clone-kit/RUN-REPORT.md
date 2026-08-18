# Run report — the push, executed 2026-08-18

Everything except phase `07-phone-number` now exists in the new account
(org `453f00c2-cb26-43f0-8da3-2eb13b578e15`). The legacy Vapi account and
Make.com were not written to at any point; the wrong-account guard fingerprinted
the target before the first write.

## The probe settled the contested-field question

`CLONE-CONTRACT.md` left open whether a `POST` accepts the nine assistant
fields and three tool fields absent from the OpenAPI document. It does — the
probe created a throwaway assistant carrying all nine and a throwaway
`transferCall` tool carrying `function` + `async`, and **every field came back
accepted**; both objects were deleted (200). The spec under-documents the API;
nothing needed a modern-equivalent substitution, and `backgroundDenoisingEnabled:
true` is confirmed present on the two assistants that depend on it.

## What was created — 45 objects, zero errors

| Phase | Resource | Name | Old id | New id |
| --- | --- | --- | --- | --- |
| 00-file | file | Npc Services Information Document (1).do | `9fff4149-3aec-48f0-9378-d56760390216` | `1e87753e-6c9e-427f-8e72-95c24c0dcea6` |
| 00-file | file | Npc Services Information Document (1).pd | `b3b1fdd2-8784-48af-aa1a-cc20740b72ff` | `a9c4f938-1578-4fef-859f-84938cd4c553` |
| 01-tool | tool | end_call_tool | `bbbf6fb6-685d-411e-b0e1-bec5acc4fa8e` | `838edbad-fc35-444b-865f-64b622af0121` |
| 01-tool | tool | get_call_context | `0bd36de8-6d3a-43e5-9c3f-25ca6de97662` | `2c726b9d-bcd5-4334-b1a2-0e871554d9f9` |
| 01-tool | tool | ghl_check_availability | `6587bc7d-7382-4e33-a38d-95f5740df52a` | `3d407940-f697-404c-a6d4-0137e79a0d9f` |
| 01-tool | tool | ghl_create_booking | `f195a817-8346-475d-ad0e-8033f1d2e283` | `7d6b6d41-0059-44a9-a9c5-fdc0c8c6d218` |
| 01-tool | tool | ghl_delete_event_npc_2_1 | `a34b05ef-5218-4771-bf2b-4b171ad8f9c9` | `63601bb7-719b-42e8-a7bb-3384db13b4ab` |
| 01-tool | tool | ghl_delete_event_npc_2 | `87fb4ce8-b696-4925-bfbf-8bd9678d4e36` | `263ea8d0-ca99-4ae2-bf97-6edbdead58ac` |
| 01-tool | tool | ghl_delete_event_npc_3_1 | `ba13974d-8005-487d-81b9-4dc569a9f6d4` | `95b925f0-9674-4d18-aab5-4d800867598f` |
| 01-tool | tool | ghl_delete_event_npc_3 | `006be564-14c2-4db9-9c90-6821d363b123` | `908405fb-6def-4dce-8d73-54b371d5b0da` |
| 01-tool | tool | ghl_delete_event_npc | `5934c762-0223-4112-bfb7-88931da17652` | `90dc98c2-3afd-4e58-a5da-0e95e7496be6` |
| 01-tool | tool | ghl_resolve_contact | `3e116e74-0dda-4277-ae38-468bdd3464e6` | `05dd96f7-12e5-4d24-85dc-c2c43172bd1e` |
| 01-tool | tool | phoneNumber_inject | `9789b720-ee13-4389-ba33-678883eaa891` | `76dad303-a7fa-4e61-b933-c365b721b0cf` |
| 01-tool | tool | transfer_to_human | `5c0c334c-6bbf-4399-b748-a3c50207e754` | `bf4b9260-0168-4beb-8a1b-52b5c4788f15` |
| 02-structured-output | structured-output | Appointment Booked | `94648165-f08f-4d2e-ad13-91ec7f41d443` | `929cc802-0273-4190-8871-103a078b3542` |
| 02-structured-output | structured-output | Appointment Cancelled | `00d9c6e4-6383-4b59-97be-b7dba41f0ace` | `bf0e9d4b-f9e1-4ba6-bcd6-74931fad6f0a` |
| 02-structured-output | structured-output | Appt Time Selected | `e783bfd6-fd93-4462-b5a4-abd97aac60e1` | `74fe20e5-bc1a-409d-b2f9-d563e2a17fa8` |
| 02-structured-output | structured-output | contact_id | `e6a0c195-3ef9-4661-951f-bd66a801cd62` | `8fdd7e17-a386-440f-8f37-66925d11aadd` |
| 02-structured-output | structured-output | Zoom Call Booked | `468022e7-2ba9-4154-8178-927586daf240` | `5a94d37a-0dcb-4c1e-b839-e45c734c3996` |
| 02-structured-output | structured-output | Zoom Call Booked | `a5b2f26a-dcfc-4e2f-82d9-87bcaa572782` | `f9151e70-254b-4536-8e75-af7ece9495c7` |
| 03-scorecard | scorecard | scorecard for assistant NPC Opt In Follow Up | `cf81945a-c941-46a2-a538-2987abffe521` | `4b17b93c-01fd-4f61-b34b-f4272ac15085` |
| 04-assistant | assistant | NPC Active Nurturing | `cc46d882-55c0-454c-82e2-ef00ae000aec` | `66d3e994-32c4-4d38-90af-2351078ad0f7` |
| 04-assistant | assistant | NPC Discovery Call Follow Up Test 2 | `c0bc54fd-a9fb-4970-822b-b471c198e43b` | `8057b181-7e8a-46fe-80d3-afc8df6fca75` |
| 04-assistant | assistant | NPC Discovery Call Follow Up Test | `29d6c50e-36e4-406c-b2ea-93f7fc2997a4` | `6930782c-fc21-4b0b-9e38-97d508cc413d` |
| 04-assistant | assistant | NPC Discovery Call Follow Up | `38e71746-75f8-4a7f-b527-f0b7528d76f0` | `d3f63417-ffdc-4505-91e8-f6ad6cd9841d` |
| 04-assistant | assistant | NPC Discovery Call No Show Follow Up | `e1b76e7c-b9a2-461b-a951-e6b253a4d0d7` | `9013efd8-c662-4466-99f9-bb9597b44cfb` |
| 04-assistant | assistant | NPC IFC Follow Up | `a4ddecba-df99-49e4-8e47-4c4b57f4a991` | `55685df0-3ab8-4b8b-8695-6640e4e06fc1` |
| 04-assistant | assistant | NPC IFC Inbound | `7770a48b-68d1-48df-a03a-9cc5b9e91ad8` | `ed0aa90f-e5ea-439d-b086-f694cf5f978d` |
| 04-assistant | assistant | NPC IFC No Show Follow Up | `4274ab0d-f8e6-4ab9-9b47-1f12255e73c0` | `209964e0-9b0c-48b1-a190-9b462de21462` |
| 04-assistant | assistant | NPC Inbound Agent | `bfff143e-03f7-4bc2-afbb-5734987f672f` | `b834610e-469e-4f9f-9130-01a1fa751064` |
| 04-assistant | assistant | NPC Opt In Follow Up Inbound | `739b47bf-9adb-4ac6-aca4-976d815f673e` | `fdb1ecde-e884-4650-abd3-8c19a2a006dd` |
| 04-assistant | assistant | NPC Opt In Follow Up | `b3acdd28-558a-4893-9cfe-c3abacdbe6bd` | `9b4f7438-35b1-4d87-809a-03e56c2f9144` |
| 04-assistant | assistant | NPC Quiz Follow Up | `72cebdc8-8ea2-4ed3-8ae5-bbbeb5fa782f` | `044329e5-4709-49f9-81f7-d1e25ea28213` |
| 04-assistant | assistant | NPC Strategy Session Inbound | `5ae449c8-1999-4f44-9115-9d63bf7444ae` | `f958ec93-6f41-4507-a7b1-f8c8d54e775e` |
| 04-assistant | assistant | NPC Strategy Session (Phone) Follow Up | `dcc0d0c4-1e01-4455-b895-7b268b1b96f0` | `f8abe39e-0944-4a53-afa6-95ac1852f892` |
| 04-assistant | assistant | NPC Strategy Session (Phone) No Show | `1f91270c-67e0-453b-83f4-6cf4d44abea1` | `5aa70a8e-01fb-4bcb-b275-6822b4e7e3da` |
| 05-squad | squad | NPC Sales Force | `a9656ea1-3575-4ac6-b985-fd138be06cc5` | `13c37e4c-3289-4d0f-98f2-b16e2258c945` |
| 06-workflow | workflow | NPC Follow Up | `81f2958a-90cb-4ab0-b76a-1e0940babe42` | `08b5496b-80aa-4c54-afcd-0b895a1baa4b` |
| 08-insight | insight | Call Ended (Error) Count | `7e64bbaf-d6be-4064-89d0-781af0cf85dd` | `8c8944ae-435c-4d60-a413-5b95a99f0fdb` |
| 08-insight | insight | Model Request Failed Count | `ae2cd7ed-b911-43cc-87c1-bcd8b3ca33b6` | `e6208d0b-4e79-4724-ad11-6b893095bf13` |
| 08-insight | insight | Tool Failed Count | `f9126d1f-a913-4481-8f3a-a051324fb476` | `6e590fed-9dcf-41b8-9cf8-e78b3b82a932` |
| 08-insight | insight | Transcriber Request Failed Count | `000f73e6-58c0-4204-a7ab-b15b7159bf1c` | `766fabcf-bd11-454b-8701-38877249c467` |
| 08-insight | insight | Transfer Failed Count | `88789258-e2d4-44a4-96a0-468ee2b66b8a` | `0636bccc-50e6-4e8c-be5a-11b47db4e11f` |
| 08-insight | insight | Voice Request Failed Count | `a454b1b1-83db-42be-9ca3-e08a0096ee4a` | `843913a8-75f2-4393-b539-26fc3afb57a1` |
| 09-board | board | Default Dashboard | `dbd8261e-ca8a-479b-9d8b-c32bfaa92872` | `68c1aba9-6340-41fa-a4c0-1d98b07bea94` |

Plus 6 backfill PATCHes re-attaching `assistantIds` to the five referenced
structured outputs and the scorecard once the assistants existed.

## Verification — three layers, all green

1. **Read-back diff on every create**: no field sent was dropped by any POST.
2. **`push.py verify`**: 51 checks, 0 problems — every object fetchable, every
   cross-reference resolves to the mapped id, every backfilled field present.
3. **Independent deep diff** of all 43 JSON objects against their source records
   (ids remapped, secret masked): byte-equal except one finding — Vapi stores the
   scorecard's two `assistantIds` in reverse order; same set, semantically
   identical. Both files uploaded byte-exact (18,567 and 21,622 bytes, status
   `done`). 12 server-added default keys observed, all additive.

## Deliberate divergences from the source

- **Webhook secret**: the 13 assistants' `x-vapi-webhook-secret` carries a
  **freshly minted value**, not the leaked one (SECURITY-INCIDENT.md). It is
  readable in the new account (assistant → server headers) whenever Make-side
  validation is configured — or rotate it again at that point.
- **Dangling toolIds dropped** (3, on `NPC Discovery Call Follow Up` and `…Test 2`)
  — they resolve to nothing in the source org either.
- The tool `server.url`s were pushed exactly as captured (legacy eu2 Make webhooks)
  and re-pointed to the us2 hooks in a same-day follow-up pass — see
  [`../../make/VAPI_WIRING.md`](../../make/VAPI_WIRING.md) for the evidence-backed
  mapping. `transfer_to_human` stays on eu2: its target scenario was never cloned.

## Not migrated, and why

| What | Why |
| --- | --- |
| 4 phone numbers (phase 07) | Deferred on instruction. Twilio imports also move live inbound routing and need `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`. Resume: `push.py run --execute --phases 07-phone-number`. |
| 13 excluded assistants + their tools | Excluded on instruction. |
| `make` credential | Recreated from the Make side at Make cutover. |
| Call history, logs | No write API exists; the old account is the archive. |
| "Riley" (pre-existing in target) | Not ours; untouched. |
