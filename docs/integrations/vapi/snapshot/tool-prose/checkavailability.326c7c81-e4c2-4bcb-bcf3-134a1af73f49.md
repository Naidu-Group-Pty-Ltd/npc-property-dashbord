# `checkAvailability` — prose

Everything in this tool that an LLM reads when deciding whether and how to call it. Extracted from the committed JSON; nothing added.

`326c7c81-e4c2-4bcb-bcf3-134a1af73f49` · type `function`

## Description

Check the availability on the business calendar for a requested time by the customer. If all the slots are available, respond by saying we're available all day. If there are busy slots, make sure the requested time slot is available. If not, suggest alternative slots.

## Parameters

### `times`  — `string`

Requested time for appointment booking

## Spoken messages

_none — the caller hears nothing while this runs_

