# `get_call_context` — prose

Everything in this tool that an LLM reads when deciding whether and how to call it. Extracted from the committed JSON; nothing added.

`0bd36de8-6d3a-43e5-9c3f-25ca6de97662` · type `function`

## Description

Retrieves the stored live call context for the current Vapi call from the external session store. Use this tool after contact resolution and at the start of downstream assistant flows to recover contactId, firstName, fullName, phone, contactState, confirmedIntent, and callerReason. This tool does not search GHL, create contacts, book calls, or update calendars.

## Parameters

_none_

## Spoken messages

**request-start**

> _empty_

