# `ghl_resolve_contact` — prose

Everything in this tool that an LLM reads when deciding whether and how to call it. Extracted from the committed JSON; nothing added.

`3e116e74-0dda-4277-ae38-468bdd3464e6` · type `function`

## Description

Resolve an inbound caller contact in GoHighLevel. The caller phone number is injected automatically by Vapi as a trusted static parameter and must not be generated, guessed, formatted, or manually supplied by the assistant. The tool must search by the injected phone number first. If no contact is found and the caller's name is known, the tool may create the contact.

## Parameters

### `first_name`  — `string`

The caller's first name, only if known.

### `full_name`  — `string`

The caller's full name, only after the caller provides it or it is already known from context.

### `last_name`  — `string`

The caller's last name, only if known.

## Spoken messages

**request-start**

> _empty_

