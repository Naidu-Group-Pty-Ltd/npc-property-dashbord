# NPC Services

`ae35b1f3-25c4-4620-ac13-525a58da96c9` · **(no PSTN number — Vapi SIP)** · provider `vapi` · status `active`

## Routing

- squad → NPC Sales Force

## Configuration

- **sipUri**: `sip:naidupropertyconsultingservices@sip.vapi.ai`
- **server**: `{"url": "https://dduzbchuswwbefdunfct.supabase.co/functions/v1/vapi-call-webhook", "timeoutSeconds": 20, "headers": {"x-vapi-webhook-secret": "vapi_wh_dfc85e7ab32da6b7d20c5a0ea52c24e56ad20dd6ce0f0bddbe8a1a784c4d7701"}}`

- created 2026-01-31 · updated 2026-07-22

## Migration note

A Vapi-provider number is re-provisioned on clone and receives a **new `sipUri`**. Anything dialling the old SIP address breaks.
