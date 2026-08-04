# Airtable retention — Property Intake Master

**Base** `NPC Emails` (`apptyShYE0yzL4IGB`)
**Automation** `Delete Property Intake Records After 30 Days` (`wfljwe75Zqv5u8uCx`)
**Cloned from** `Delete Records After 30 Days` (`wflOUO4qcLHFpMUA8`), which does the same
job for the `Properties` table.

Property Intake Master is a working table, not an archive: an intake row is a snapshot of
what an agent's email said on the day it arrived, and a listing that has not been re-sent
in a month is stale. The existing purge on `Properties` already encodes that decision, so
this one is a clone of it rather than a new policy.

## Configuration

| | Value |
|---|---|
| Trigger | Scheduled — daily, 00:00 `Asia/Kuala_Lumpur` |
| Step 1 | Find records in `Property Intake Master`, where `Created Time` is before *30 days ago* (`Asia/Kuala_Lumpur`), limit 1000 |
| Step 2 | Repeating group over those records → **Run a script**, deleting one record per iteration |

Identical in every parameter to the `Properties` purge except the table and the date
column. The window is measured on **`Created Time`**, a `createdTime` column, so it counts
from when the record entered the table and cannot be moved by a later edit — the same field
family the original keys off (`Created`, also `createdTime`).

## The one manual step

The automation is saved with its trigger and its find step, and **the Run script step is
empty**. Airtable's API refuses to author script nodes — `create_automation` and
`update_automation` both reject `customScript` with `readOnlyNodeType`, by design — so the
body has to be pasted in the UI once.

1. Open <https://airtable.com/apptyShYE0yzL4IGB/wfljwe75Zqv5u8uCx>
2. Inside **For each expired record**, add a **Run script** action
3. Add two input variables:
   | Name | Value |
   |---|---|
   | `recordId` | the loop's current record → **Airtable record ID** |
   | `tableId` | `Property Intake Master` (table id `tblWIg5cs85O30pcY`) |
4. Paste the script — byte-identical to the one the `Properties` purge runs:

```js
let { recordId, tableId } = input.config();

await base.getTable(tableId).deleteRecordAsync(recordId);

console.log(`Deleted record: ${recordId}`);
```

5. Test, then turn the automation on. It is saved as a **draft and is off** until you do.

## Before you turn it on

This deletes records permanently and there is no undo. Two things worth checking on the
first run:

- **It will delete a lot on day one.** Everything already older than 30 days goes in the
  first pass. Run the find step alone first and read the count.
- **`findRecords` caps at 1000 per run.** If the backlog is larger the automation will take
  several nights to drain, one thousand records at a time. That is the same behaviour as
  the `Properties` purge and needs no change — it just means day one is not the whole job.

The dashboard already assumes this window: `listingFreshness` in `src/lib/listingDisplay.ts`
treats "new" as a matter of days rather than weeks specifically because Airtable prunes at
30, and `listings_cache` shares the same retention horizon.
