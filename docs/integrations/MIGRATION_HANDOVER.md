# Migration handover — state at pause, 2026-08-18

The account migration (Make.com, Airtable, Vapi) is **paused ahead of the Supabase and
GitHub legs**. This document is the complete picture of what remains: what only you can
do, what is billing-gated but ready for me to run the moment it unlocks, what waits on
an input, and the open decisions. Everything not listed here is done and verified —
summarised in §5.

---

## 1. Manual — only you can do these

### Make.com (team `2731020`, us2)
- **Fill the two GoHighLevel PIT tokens** — `{{SECRET:GHL_PIT_TOKEN_BOOKING}}` in
  *Vapi - GHL Booking Intent Router (Generic HTTP PIT)* (the live booking path — Vapi's
  `ghl_create_booking` tool now points at it) and `{{SECRET:GHL_PIT_TOKEN_CONTACTS}}` in
  *GHL MCP - Get Contact By Phone via HTTP*. These are the **only two** secret
  placeholders left across all 37 scenarios. Rotate the GHL keys first — the old values
  are burned (see Security below).
- **Apply the 7 GHL contact-cache key edits** in the Make UI (recorded in
  `make/MAKE_CUTOVER.md`).

### Airtable (base `appFNPL7iYiuQyHAO`)
- **Import the Emails table CSV** — 5,325 records / 7.7 MB, too large for the API. File
  and steps are in the runbook.
- **Paste the 4 automation scripts** — the script-bearing automations exist structurally
  (`create_automation` rejects script steps); paste each script body in the UI. The
  corrected `auto-generate-report` script (adds `x-webhook-secret`, throws on non-2xx)
  is at `airtable/npc-emails/automations/scripts/auto-generate-report.CORRECTED.js`.
- **Finish "Auto-generate report" in the UI** per
  `automations/migration/rebuilt/AUTO_GENERATE_REPORT.md`, including its 10th input
  variable (the webhook secret).
- **Enable the automations** — everything the API created is saved as a **draft**;
  deployment is UI-only. Do this after the scripts are pasted.
- **Add the seven UI-only fields** if parity matters (aiText and createdTime types the
  API cannot create; the four formula substitutes for created/modified times are already
  in place). List in `airtable/npc-emails/REBUILT_BASE.md`.
- **Decide the Property Intake purge clock question** (30-day retention — see
  `AIRTABLE_RETENTION.md` note in the runbook).

### Vapi (new org `453f00c2`)
- **Provide the Twilio auth token** when you want phase 07 to run (the Account SID is
  already recoverable from Make's Twilio connection). Nothing else is needed from you on
  the Vapi side — see §3 for what happens then.

### Security — rotations still owed
- **Legacy Vapi webhook secret** — the value leaked into five pushed git commits. The
  *new* account already uses a freshly minted secret (readable in any new assistant's
  server headers); the legacy account still runs on the leaked one until rotated or
  decommissioned. Also the two `serverUrlSecret` values (legacy assistants Aishu /
  Xenochrome). `vapi/SECURITY-INCIDENT.md` has the full record.
- **The credentials printed into the session transcript earlier** (Airtable PAT, GHL
  PIT, Twilio SIDs and friends — 8 total) should be rotated as they are burned.
- **Decide on git history rewrite** for the five leaking commits (owner's call; working
  tree has been clean since the fix).
- Optional hardening: the new Vapi API key now sits in plaintext `Authorization` headers
  in 14 Make scenarios (exactly as the legacy key did). Now that connection
  **"Aurixa Systems" (10508414)** exists, those HTTP modules could be switched to
  connection-held auth — say the word and I'll do that pass.

---

## 2. Billing-gated — I run these autonomously once the Make plan is upgraded

The Free licence sets three limits that bind: **`dslimit: 1`** (one data store),
**`dsslimit` 1 MB** total store storage (minimum allocation is 1 MB, and the existing
`GHL Contact IDs` store claims all of it), and **2 active scenarios** org-wide.

The moment a paid plan lands, I can, with no further input:

1. **Create the `Vapi Calls Human Transfer` data store** (its creation currently returns
   "Not enough space in storage").
2. **Create the two blocked scenarios** — *NPC Twilio - Store Active Call Context* (its
   us2 hook `ydaccnot…` already exists, parked) and *NPC Vapi - Transfer Caller to Human
   via Twilio Redirect* — from the exported blueprints, wired to the new Airtable base
   and connections like the other 37.
3. **Re-point the `transfer_to_human` Vapi tool** to the new transfer scenario's hook —
   it is the **last eu2 pointer in the new Vapi org**, waiting only on that scenario
   existing.
4. **Activate scenarios at cutover** — the 2-active cap makes go-live impossible on
   Free; with it lifted I can switch on the agreed set in dependency order.

*(Airtable and Vapi have no billing gates — everything blocked there is manual-only or
waiting on an input.)*

## 3. Waiting on an input — I run these once you hand it over

**Trigger: the Twilio auth token + your go-signal on timing.** Phase 07 is the live-traffic
moment: importing a Twilio number re-points its voice webhook at the new org immediately,
so inbound calls leave the legacy account the instant it runs. When you say go:

1. `push.py run --execute --phases 07-phone-number` — creates the 4 numbers (2 Twilio
   imports; 2 Vapi-native numbers get **new SIP URIs**).
2. **Sweep the ten `phoneNumberId` references** in Make onto the new ids (nine scenarios
   reference the Naidu Twilio number, the sandbox references the NPC Services one — list
   in `make/VAPI_WIRING.md`).
3. **Re-point anything dialling the old Vapi SIP URIs** — I'll surface these; external
   callers (GHL, website) are yours to change.
4. `push.py verify` and a final cross-system check.

## 4. Open decisions and known gaps

| Item | State |
| --- | --- |
| *NPC Discovery Call Summary* scenario | Deliberately not migrated — writes into base `appFOpIVCltTyJKgM`, outside this migration's scope. Decide whether it moves. |
| The two parked `vapi2` hooks (`2705105`, `2705117`) + old connection `10496920` | **Do not delete until the legacy Vapi account is decommissioned** — deletion could fire an unregister at the legacy org with the old key. |
| `NPC Discovery Call Follow Up` in the **legacy** account | Still points at a dead eu2 webhook; the clone is ahead of the source (points at the Supabase function). Nothing to do unless the legacy account must keep working. |
| 13 excluded assistants + their tools, 2 unreferenced tools carrying PAT/PIT | Excluded on your instruction; fully snapshotted if that changes. |
| 3 dangling `toolIds` on two Discovery assistants | Deleted in the source org; dropped from the clones, recorded. |
| "Rita" prompt references vs migrated tool names | Consistent — no action. |
| External webhook callers (GHL, website, forms) | Every hook URL changed zone (eu2 → us2). Re-pointing external callers is unavoidable at Make cutover and is a you-step; the full old→new table is `make/MAKE_CUTOVER.md`. |

## 5. Done and verified (the short version)

| System | State |
| --- | --- |
| **Vapi new org** | 45 objects cloned (files, 12 tools, 6 structured outputs, scorecard, 15 assistants, squad, workflow, insights, board), verified three ways, zero real diffs. All tool webhooks on us2 (except `transfer_to_human`, §2), all assistant server URLs match live source truth. Contested-fields question settled: the API accepts everything. |
| **Vapi legacy org** | **Byte-identical to the pre-push snapshot** — verified by full read-only re-pull, twice. Never written to. |
| **Make new team** | 37 of 39 scenarios present (incl. the 6 former "UI imports", now confirmed complete in-team) and wired: new Vapi key in 14, new assistant ids in 13, both `vapi2` hooks rebound through your new connection, Airtable modules on the new base. All inactive by design. |
| **Airtable new base** | 10 tables, 212 records + link edges, 205-column intake schema, formula substitutes, 6 automations recreated as drafts, 4 script-bearing ones structurally built. |
| **Repo** | Full snapshots, clone kit, runbooks and this handover under `docs/integrations/`; draft PR #2207 tracks the branch. |

*Paused here. Next legs when you are ready: Supabase, GitHub — then the Make/phone
cutover using §2 and §3.*
