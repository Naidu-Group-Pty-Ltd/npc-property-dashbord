# `phoneNumber_inject` — prose

Everything in this tool that an LLM reads when deciding whether and how to call it. Extracted from the committed JSON; nothing added.

`c40722f1-a359-42e1-ba80-e99ef706a916` · type `function`

## Description

Context bridge tool fired once before Angela hands off to a downstream assistant. This tool preserves resolved caller context such as contactId, firstName, fullName, phone, contactState, confirmedIntent, and callerReason. It must not search GHL, create contacts, book calls, or choose the downstream assistant by itself.

## Parameters

### `callerReason`  — `string`

A short plain-English summary of why the caller is being handed off.

### `confirmedIntent`  — `string` · **required** · enum: `discovery`, `strategy`, `finance`

The confirmed downstream pathway. Must be one of: discovery, strategy, or finance.

## Spoken messages

**request-start**

> _empty_

