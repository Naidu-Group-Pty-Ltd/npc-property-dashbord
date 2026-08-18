# NPC assistants — side by side

For cross-checking against the Vapi dashboard. Every value is from the committed JSON.

| Field | Active Nurturing | Discovery Call Follow Up | Discovery Call Follow Up Test | Discovery Call Follow Up Test 2 | Discovery Call No Show Follow Up | IFC Follow Up | IFC Inbound | IFC No Show Follow Up | Inbound Agent | Opt In Follow Up | Opt In Follow Up Inbound | Quiz Follow Up | Strategy Session (Phone) Follow Up | Strategy Session (Phone) No Show | Strategy Session Inbound |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **LLM** | gpt-5.2-chat-latest | gpt-5.1-chat-latest | gpt-5.2-chat-latest | gpt-5.2-chat-latest | gpt-5.2-chat-latest | gpt-5.2-chat-latest | gpt-5.6-luna | gpt-5.2-chat-latest | gpt-5.6-luna | gpt-5.2-chat-latest | gpt-5.6-luna | gpt-5.2-chat-latest | gpt-5.2-chat-latest | gpt-5.2-chat-latest | gpt-5.6-luna |
| **Temp** | — | 0.9 | 0.9 | 0.9 | 0.9 | — | — | — | — | 0.9 | — | 0.9 | 0.9 | — | — |
| **Voice ID** | `cgSgspJ2msm6` | `jBzLvP03992l` | `jBzLvP03992l` | `jBzLvP03992l` | `xgnMn9p1V1XV` | `02y4x5i9YrzY` | `02y4x5i9YrzY` | `02y4x5i9YrzY` | `M7ya1YbaeFaP` | `cJi4iYb9fQ8Q` | `cJi4iYb9fQ8Q` | `TcAStCk0faGc` | `02y4x5i9YrzY` | `02y4x5i9YrzY` | `02y4x5i9YrzY` |
| **Voice model** | eleven_flash_v2_5 | eleven_turbo_v2_5 | eleven_turbo_v2_5 | eleven_flash_v2_5 | eleven_flash_v2_5 | eleven_flash_v2_5 | eleven_flash_v2_5 | eleven_flash_v2_5 | eleven_flash_v2_5 | eleven_flash_v2_5 | eleven_flash_v2_5 | eleven_flash_v2_5 | eleven_flash_v2_5 | eleven_flash_v2_5 | eleven_flash_v2_5 |
| **Transcriber** | flux-general-en | nova-2 | flux-general-en | flux-general-en | flux-general-en | flux-general-en | flux-general-en | flux-general-en | flux-general-en | flux-general-en | flux-general-en | flux-general-en | flux-general-en | nova-2 | flux-general-en |
| **Prompt chars** | 37,089 | 16,725 | 30,100 | 29,284 | 34,672 | 40,878 | 41,511 | 41,404 | 43,970 | 36,698 | 44,426 | 43,388 | 40,392 | 40,896 | 40,648 |
| **Tools** | 5 | 4 | 6 | 5 | 5 | 6 | 5 | 5 | 5 | 5 | 5 | 5 | 7 | 5 | 7 |
| **Broken tools** | — | 3 | — | 3 | — | — | — | — | — | — | — | — | — | — | — |
| **KB files** | 1 | — | 1 | 1 | 1 | — | 1 | — | 1 | 1 | 1 | 1 | 1 | — | 1 |
| **Max dur (s)** | — | — | 929 | 929 | — | — | 1444 | — | 16562 | 929 | 1444 | 929 | — | — | 1444 |
| **Silence (s)** | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| **Recording** | off | off | off | off | off | off | off | off | off | off | off | off | off | off | off |
| **Server** | supabase | eu2 MAKE | supabase | none | supabase | supabase | supabase | supabase | supabase | supabase | supabase | supabase | supabase | supabase | supabase |
| **Calls seen** | 16 | 70 | 44 | 80 | 60 | 4 | 0 | 3 | 37 | 100 | 0 | 100 | 71 | 3 | 0 |
| **Version** | v3 | v1 | v1 | v1 | v1 | v1 | v1 | v1 | v3 | v1 | v1 | v1 | v1 | v1 | v1 |

## Tool matrix

| Tool | Active Nurturing | Discovery Call F | Discovery Call F | Discovery Call F | Discovery Call N | IFC Follow Up | IFC Inbound | IFC No Show Foll | Inbound Agent | Opt In Follow Up | Opt In Follow Up | Quiz Follow Up | Strategy Session | Strategy Session | Strategy Session |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| end_call_tool | ● |  | ● | ● | ● |  | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| get_call_context |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |
| ghl_check_availability | ● |  | ● |  | ● | ● | ● | ● |  | ● | ● | ● | ● | ● | ● |
| ghl_create_booking | ● |  | ● |  | ● | ● |  | ● |  | ● | ● | ● | ● | ● | ● |
| ghl_delete_event_npc |  | ● | ● | ● |  |  |  |  |  |  |  |  |  |  |  |
| ghl_delete_event_npc_2 |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |
| ghl_delete_event_npc_2_1 |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |
| ghl_delete_event_npc_3 |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  |
| ghl_delete_event_npc_3_1 |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| ghl_resolve_contact | ● |  | ● |  | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| phoneNumber_inject |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |
| transfer_to_human | ● |  | ● |  | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| **MISSING 4aa1a306** |  | ● |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| **MISSING 199be122** |  | ● |  | ● |  |  |  |  |  |  |  |  |  |  |  |
| **MISSING 4d3ab4a4** |  | ● |  | ● |  |  |  |  |  |  |  |  |  |  |  |

## Where prompts are shared

Every assistant has a system prompt unique to it — no two share one byte-for-byte.
