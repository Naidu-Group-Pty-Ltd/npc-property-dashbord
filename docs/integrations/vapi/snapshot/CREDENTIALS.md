# Provider credentials — what the new account needs before anything rings

`GET /credential` returned the source org's seven connected providers. Vapi never returns
the secret values, so the records in [`credentials/`](./credentials/) are metadata only —
asserted secret-free at write time. **This file was referenced by the README before it was
committed; the pre-cutover question "what do I configure in the new account?" is what
surfaced the gap.**

The load-bearing fact, measured from the payloads rather than assumed: **no payload
references a `credentialId`, and every provider the NPC estate actually calls is reached
through Vapi's managed keys, not through these credentials** — with one exception, OpenAI.

## What the 49 payloads actually depend on

| Dependency | Where | Credential needed in the new account? |
| --- | --- | --- |
| `openai` models (`gpt-5.2-chat-latest` ×10, `gpt-5.6-luna` ×4, `gpt-5.1-chat-latest` ×1) | all 15 assistants | **Yes — the one to configure.** The source org ran on its own OpenAI key; recreate that so model traffic bills to the company account. |
| `11labs` voices (7 distinct `voiceId`s) | all 15 assistants | **No.** The source org had **no 11labs credential** — voices resolve through Vapi's managed ElevenLabs. Carried by id; `verify` should confirm they resolve in the new org. |
| `deepgram` transcribers (`flux-general-en` ×13, `nova-2` ×2) | all 15 assistants | **No** — same: no deepgram credential existed; Vapi-managed. |
| `google` knowledge bases | 11 assistants | **No** — no google credential existed; Vapi-managed Gemini reads the uploaded files. |
| Make webhooks + `x-vapi-webhook-secret` | 12 tools, 1 assistant server, 1 phone number server | **Not a Vapi credential.** The secret is an env var at push time (`VAPI_WEBHOOK_SECRET`, the rotated value). |
| Twilio (2 numbers) | phase `07-phone-number` | **Not a dashboard integration** — the SID + auth token ride inline on the create (`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` env). |

## The seven source credentials, dispositioned

| Provider | Used by | New-account action |
| --- | --- | --- |
| `openai` | every assistant's model | **Recreate before first call** (the only one). |
| `make` | the Make↔Vapi app connection — reads legacy team `528268` / `eu2` | Recreate **from the Make side** against team `2731020` / `us2` when the Vapi-triggered scenarios cut over; the Make connection takes the NEW Vapi API key. Not needed for the push. |
| `gohighlevel` | nothing — the two GHL-native tools are orphans no assistant references; the NPC `ghl_*` tools are plain webhooks | Skip unless GHL-native tools are adopted later. |
| `xai` | no assistant (all 28 run openai models) | Skip. |
| `openrouter` | no assistant | Skip. |
| `perplexity-ai` | no assistant | Skip. |
| `byo-sip-trunk` (`Vapi-Twilio`, gateway `npc-vapi.pstn.twilio.com`, `inboundEnabled: false`) | no phone number (all 6 are `twilio`/`vapi` provider) | Skip unless outbound-via-SIP-trunk is in use somewhere the API cannot see. |

## Timing

Nothing above blocks `push.py probe` or phases 00–06: Vapi does not validate provider
credentials at create time, and no payload names a `credentialId`. The OpenAI key must
exist before the first **call**; the Twilio env vars before phase **07** — which is also
the live-traffic moment, since importing a Twilio number re-points its voice webhook at
the new org and inbound on that number leaves the old account then and there.
