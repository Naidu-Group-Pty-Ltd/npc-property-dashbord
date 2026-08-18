# Tools — side by side

For cross-checking against the Vapi dashboard. Every value is from the committed JSON.

| Tool | Type | Params | Msgs | Used by | Server host | Points at |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `end_call_tool` | endCall | 0 | 1 | 13 | `—` | — |
| `ghl_resolve_contact` | function | 3 | 1 | 13 | `hook.eu2.make.com` | Vapi - GHL Contact Resolver v4 |
| `transfer_to_human` | function | 2 | 2 | 13 | `hook.eu2.make.com` | NPC Vapi - Transfer Caller to Human via Twilio Redirect (BLOCKED on Make plan) |
| `ghl_check_availability` | function | 8 | 1 | 12 | `hook.eu2.make.com` | Vapi - GHL Availability Intent Router |
| `ghl_create_booking` | function | 10 | 2 | 11 | `hook.eu2.make.com` | Vapi - GHL Booking Intent Router |
| `ghl_delete_event_npc` | function | 2 | 1 | 3 | `hook.eu2.make.com` | shared by the five NPC Delete scenarios |
| `ghl_delete_event_npc_2` | function | 2 | 1 | 2 | `hook.eu2.make.com` | **unmapped** |
| `ghl_delete_event_npc_2_1` | function | 2 | 1 | 2 | `hook.eu2.make.com` | **unmapped** |
| `ghl_delete_event_npc_3` | function | 2 | 1 | 2 | `hook.eu2.make.com` | **unmapped** |
| `checkAvailability` | function | 1 | 0 | 1 | `hook.eu2.make.com` | Xenochrome Availability Check |
| `get_call_context` | function | 0 | 1 | 1 | `hook.eu2.make.com` | NPC Vapi - get_call_context v1 |
| `ghl_delete_event_npc_3_1` | function | 2 | 1 | 1 | `hook.eu2.make.com` | **unmapped** |
| `phoneNumber_inject` | function | 3 | 1 | 1 | `hook.eu2.make.com` | Discovery Call Handoff |
| `get_contact_airtable_test` | function | 3 | 1 | 0 | `airtable.com` | **old Airtable base (browser URL, not an API)** |
| `ghl_mcp` | mcp | 0 | 0 | 0 | `services.leadconnectorhq.com` | GoHighLevel MCP |
| `go_high_level_mcp_contact_get_tool` | gohighlevel.contact.get | 0 | 0 | 0 | `—` | — |
| `go_high_level_mcp_contact_get_tool` | gohighlevel.contact.get | 0 | 1 | 0 | `—` | — |
| `google_sheets_tool` | google.sheets.row.append | 0 | 0 | 0 | `—` | — |
| `phoneNumber_inject` | function | 2 | 1 | 0 | `hook.eu2.make.com` | **unmapped** |
| `transfer_to_human` | transferCall | 0 | 1 | 0 | `—` | — |

## Which assistants use which tool

| Tool | Active Nurturi | Discovery Call | Discovery Call | Discovery Call | Discovery Call | IFC Follow Up | IFC Inbound | IFC No Show Fo | Inbound Agent | Opt In Follow  | Opt In Follow  | Quiz Follow Up | Strategy Sessi | Strategy Sessi | Strategy Sessi |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `checkAvailability` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `end_call_tool` | ● |  | ● | ● | ● |  | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `get_call_context` |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |
| `ghl_check_availability` | ● |  | ● |  | ● | ● | ● | ● |  | ● | ● | ● | ● | ● | ● |
| `ghl_create_booking` | ● |  | ● |  | ● | ● |  | ● |  | ● | ● | ● | ● | ● | ● |
| `ghl_delete_event_npc` |  | ● | ● | ● |  |  |  |  |  |  |  |  |  |  |  |
| `ghl_delete_event_npc_2` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |
| `ghl_delete_event_npc_2_1` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |
| `ghl_delete_event_npc_3` |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  |
| `ghl_delete_event_npc_3_1` |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| `ghl_resolve_contact` | ● |  | ● |  | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `phoneNumber_inject` |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |
| `transfer_to_human` | ● |  | ● |  | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |

## Orphans and breakages

**7 tools no assistant references.** They still exist in the org and two carry live credentials.

- `get_contact_airtable_test` (`11317eb2-1b44-4e9e-ae7f-e6baaee0d77b`) — **carries a credential**
- `ghl_mcp` (`32c907eb-ff8c-4a9e-868d-67eb1144ee42`) — **carries a credential**
- `go_high_level_mcp_contact_get_tool` (`300e5550-fa2f-4fa6-99e2-0636b59f4973`)
- `go_high_level_mcp_contact_get_tool` (`e525406e-acaa-4e9d-b806-7ae9d21c358e`)
- `google_sheets_tool` (`a1124ce2-f0f0-476d-969d-bdff57937775`)
- `phoneNumber_inject` (`c40722f1-a359-42e1-ba80-e99ef706a916`)
- `transfer_to_human` (`3a6a892d-2907-4da0-b2f8-a55d5b404a84`)

**4 tool ids are referenced by assistants but return 404** — deleted while still wired up:

- `199be122-72f1-4bbb-ada3-aedba74b59b1` ← NPC Discovery Call Follow Up, NPC Discovery Call Follow Up Test 2
- `4aa1a306-b057-4b0a-bcc0-f38749637ee0` ← NPC Discovery Call Follow Up, NPC Discovery Call Follow Up Test 2
- `4d3ab4a4-2662-4b5a-9089-068faf7a2b00` ← NPC Discovery Call Follow Up, NPC Discovery Call Follow Up Test 2
- `b85639dd-2df5-416f-886a-406b68a34f04` ← Ashley
