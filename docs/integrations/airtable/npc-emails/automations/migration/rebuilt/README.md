# The five automations as they were actually created

These are the exact `create_automation` payloads used to rebuild the target base
(`appFNPL7iYiuQyHAO`) on 2026-08-18 — the files in [`../../source/`](../source)
with every `tbl…`/`fld…` reference rewritten to the target's ids, and nothing else
changed. `_id-map.json` is the substitution that produced them.

They are kept because an automation cannot be exported back out as a create
payload: replaying or auditing this step later means starting from these files,
not from the live base.

| File | Created as |
| --- | --- |
| `link-stage-2-response-to-applicant.json` | `wflyGxwKaLbVsv14E` |
| `link-stage-2-detailed-response-to-applicant.json` | `wfl37KYYbuQv15cRP` |
| `link-stage-3-booking-to-applicant.json` | `wfls49xnPmVibeeLs` |
| `send-confirmation-email-on-new-business-readiness-response.json` | `wflh77ndoCHYMbs6Q` |
| `notify-aurixa-team-on-new-business-readiness-submission.json` | `wflbWecuoA3q6sQLj` |

## The three `structure-*.json` files

These are the **structure-only** rebuilds of the script-bearing automations, as
the target base returned them — trigger and nodes with the `customScript` removed,
because the API refuses it (`readOnlyNodeType`).

| File | Created as | Scripts still to paste |
| --- | --- | ---: |
| `structure-aurixa-lead-capture.json` | `wflEQ1wsJH1x7GQhL` | 2 |
| `structure-delete-records-after-30-days.json` | `wflz5O9df5UjBzd3X` | 1 |
| `structure-delete-property-intake-records-after-30-days.json` | `wflOrWaQohUvhvcFb` | 1 |

`Auto-generate report` has no file here because it could not be created: its only
two nodes are the `customScript` and a `conditionalGroup` with an empty branch
(`emptyBranchNotNested` outside a loop), and an automation must have at least one
node. Build it by hand from [`../../source/`](../source).

**`noOp` does not work as a script placeholder.** It is in the type enum but is
rejected as `readOnlyNodeType`. An empty `repeatingGroup` body is accepted, which
is how both purges hold the shape open.

## Two things to know before reusing these

**Node keys in these files are the source's, and Airtable ignores them.** The
`key` on every node is minted fresh on create, and the internal `$ref` wiring is
re-pointed to the new keys as part of the same call. That is why verification
canonicalises keys positionally rather than comparing them: a diff that expects
the keys to survive will report five false failures.

**`_id-map.json` covers 24 of the 54 ids the bundle references.** The other 30
belong to `Properties`, `Property Intake Master` and the extra `Aurixa Waitlist`
columns that only the four script-bearing automations touch. Extend the map
before rebuilding those; the five here need nothing more.
