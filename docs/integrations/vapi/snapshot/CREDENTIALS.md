# Provider credentials

The org's connected providers, from `GET /credential`. **Vapi does not return the secret values** — these records carry only the provider, id and configuration, so nothing here is redacted by me and nothing sensitive is committed. Verified: 0 credential-shaped values across all seven full records.

A new Vapi account needs all seven re-created before the cloned assistants and tools will work.

| Name | Provider | Created | Notes |
| --- | --- | --- | --- |
| Vapi-Twilio | `byo-sip-trunk` | 2026-01-31 | gateway `npc-vapi.pstn.twilio.com`, `inboundEnabled: false`, `outboundLeadingPlusEnabled: true` |
| — | `gohighlevel` | 2026-05-12 | backs the `ghl_*` tools |
| — | `make` | 2024-07-18 | **points at the LEGACY Make account** — `teamId 528268`, region `eu2` |
| — | `openai` | 2024-07-16 | backs every assistant's LLM |
| — | `openrouter` | 2026-01-08 | unused by any current assistant |
| — | `perplexity-ai` | 2026-01-08 | unused by any current assistant |
| — | `xai` | 2026-01-08 | unused by any current assistant |

## The Make credential is the one that matters for this migration

```json
{
  "provider": "make",
  "teamId": "528268",
  "region": "eu2"
}
```

`528268` is the **legacy** Make team and `eu2` the legacy zone — the same account the 13 tool webhooks still point at. The new account is team `2731020` in `us2`. This credential has to be re-created against the new team, and it is a dependency the tool payloads themselves do not reveal: no tool or assistant record references a `credentialId`, so the link is only visible from `/credential`.

## The SIP trunk

`Vapi-Twilio` is a `byo-sip-trunk` whose only gateway is `npc-vapi.pstn.twilio.com` with **`inboundEnabled: false`**. Taken with the squad being SIP-only and both Australian numbers routing nowhere, nothing in this org currently accepts an inbound PSTN call into the NPC Sales Force squad.

