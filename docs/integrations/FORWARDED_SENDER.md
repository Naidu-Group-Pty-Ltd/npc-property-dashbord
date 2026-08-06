# The agent was our own colleague

**Scenario** `NPC Email 1 New` (Make id `9618493`, team `528268`) — the live intake
scenario, active on a 15-minute schedule. Not the same scenario as
[`NPC_EMAIL_1_AUDIT.md`](./NPC_EMAIL_1_AUDIT.md) (`6720116`), which is switched off.
**Writes to** `Property Intake Master` (`tblWIg5cs85O30pcY`) in base `NPC Emails`
(`apptyShYE0yzL4IGB`).

Every listing this scenario wrote recorded **Lavan Kenobi / lavankenobi@gmail.com**
— or Rugesh Naidu — as the person to contact about the property. All 51 records it
had written carried an NPC mailbox in `Sender Email`, and the Listings page offered
to email that address as "the agent".

---

## Why

Three things, each individually reasonable.

**1. Intake stopped receiving mail from agents.** Listings now arrive *forwarded*
by NPC staff out of their personal mailboxes. The subject on the records that
prompted this was `Fwd: 'nsw' - Alert` — a realcommercial saved-search alert,
forwarded in. Nothing in the pipeline knew that had changed.

**2. Six modules read the envelope.** Modules 25, 28, 38, 72, 96 and 105 mapped

```
Sender Email  <-  {{1.from.emailAddress.address}}
Sender Name   <-  {{1.from.emailAddress.name}}
```

That is correct provenance for a message an agent sent, and it is the *forwarder*
for one they did not. This mapping is not a bug on its own — it is F7 of the
original audit, which moved these fields off the language model and onto the
trigger precisely so they would be facts rather than guesses. The fact simply
stopped being the one we wanted.

**3. The dashboard trusted it.** `listingContact.pure.ts` falls back to
`Sender Email` when `Agent Email` and `Agency Email` are both empty, on the
documented premise that "for a listing that arrived as an agent's own broadcast,
the sender *is* the agent". That premise is what made the contact action available
on a third of the corpus instead of a quarter. Under forwarding it is false, and
the two empty columns are the common case — so the fallback fired almost every
time and resolved the agent to whichever colleague had pressed forward.

The compose dialog would then offer to send a property enquiry to him, about his
own forward.

---

## The original sender is still in the body

The forwarding headers survive into the plain-text body, and they carry the whole
chain. One real example, six hops deep:

```
---------- Forwarded message ---------
From: Lavan Kenobi <lavankenobi@gmail.com>          <- forwarder
From: Lavan Kenobi <lavankenobi@gmail.com>
From: Lavan Kenobi <lavankenobi@gmail.com>
From: Lavan Kenobi <lavankenobi@gmail.com>
From: Rugesh Naidu <naidu.rugesh@gmail.com>         <- forwarder
From: Blights Real Estate Yorke Peninsula <yp@blights.com.au>   <- the agency
```

So the answer is recoverable, and it is worth more than "not Lavan": the innermost
hop is a real agency address on records that had none.

Three things had to be true at once, and each was learned from a body that broke
the previous attempt:

- **Take the *last* `From:`, not the first.** The first is the outermost
  forwarder. This is the whole reason the chain has to be walked at all.
- **Require a forwarding marker somewhere.** Reply threads quote a bare `From:`
  line with no marker. Two of the 120 bodies sampled were replies quoting *our own
  outbound mail*, and without this gate the parser replaced a real agent
  (`rodb@realtypacific.com.au`) with `rugesh@npcservices.com.au` — the same defect,
  reintroduced by the fix for it.
- **Skip addresses that are ours.** Chains routinely pass through
  `property@npcservices.com.au`, which would otherwise become the "last" hop. This
  is what turns "the last `From:`" into "the last `From:` belonging to an agency".

Anchoring each `From:` to a marker of its own does *not* work: a Gmail forward of
an Outlook forward nests one header block inside another and only the outer one
carries the `Forwarded message` text.

### Measured

Against the 120 most recent bodies in the `Emails` table:

| | |
|---|---|
| forwarded messages with a recoverable header | 6 |
| resolved to the originating agency | 6 |
| resolved to an NPC address | 0 |
| non-forwarded messages altered | 0 of 106 |

Recovered addresses: `scott@shore-property.com.au`, `admin@jmsons.com.au`,
`yp@blights.com.au`, `sales@waterscarpenter.com.au`. The 8 forwards with no header
block in the body fall back to the envelope, which is what they did before.

---

## The change

### Make — `blueprints/npc-email-1-new.upgraded.json`

New module **200**, a `regexp:Parser` shaped like the one already at module 13,
inserted after module 4 (`HTMLToText`) whose `text` output it reads. `global` off
so it cannot multiply bundles; `continueWhenNoRes` **on** so a direct email does
not stall in it. It exposes `fwd_name` and `fwd_email`.

The six write modules then map

```
Sender Email  <-  {{ifempty(200.fwd_email; 1.from.emailAddress.address)}}
Sender Name   <-  {{if(length(200.fwd_email) > 0; 200.fwd_name; 1.from.emailAddress.name)}}
```

`Sender Name` is deliberately not `ifempty(200.fwd_name; …)`. When the header gave
an address but no display name, falling through would pair the agency's address
with the forwarder's name — which is worse than an empty name, because it looks
answered.

The four extraction prompts (modules 20, 21, 36, 98) get the same rule stated to
the model, so it does not reintroduce a forwarder one field to the left as
`agent_email`. The rule also closes an observed defect: `agent_email` and
`agency_email` both held `sales@waterscarpenter.com.au` on 46 records, because
nothing told the model that a general inbox is not an agent's own address.

Nothing else in the blueprint is touched — 6 modules × 2 fields, 4 prompts, 1
module added, verified by diffing the generated file against the original.

### Dashboard — `_shared/listingContact.pure.ts`

`isIntakeOperatorEmail` rejects `@npcservices.com.au` and the staff mailboxes that
forward into intake, in **every** column rather than only `Sender Email`. A model
that reads a forwarded chain and reports the forwarder as `agent_email` is making
the same mistake one field to the left and should fail the same way.

This is the half that fixes the 51 records already written, without touching them:
the wrong value stays in the column as a record of what arrived, and stops being
offered as a contact. It also means the dashboard is correct whether or not the
blueprint below has been imported yet.

**Add a mailbox to `INTAKE_OPERATOR_ADDRESSES` when someone new starts forwarding
into intake.** Leaving one out is silent, and the symptom is their name appearing
as the agent.

---

## Applying the Make change

Not live. Make's API takes a blueprint as an inline request parameter and this one
is 766 KB minified, past what that path carries — the same constraint recorded in
the original audit. It ships as a file to import:

1. Open scenario **NPC Email 1 New** → **⋯** → **Import Blueprint**
2. Choose `docs/integrations/blueprints/npc-email-1-new.upgraded.json`
3. Re-select connections if Make prompts
4. **Run once** against a forwarded test email before leaving the schedule on

`npc-email-1-new.original.json` is the pre-change blueprint, captured live on
2026-08-06 — import it to roll back. `apply-sender-fix.py` regenerates the
upgraded file from it, so the edit can be re-applied if the scenario is changed in
the UI first:

```
python3 docs/integrations/blueprints/apply-sender-fix.py
```

### Verify after import

- Forward a listing email in from a personal mailbox. `Sender Email` should hold
  the **agency**, not the forwarder.
- Send one directly from an agency address. `Sender Email` should be unchanged —
  this is the regression that matters, and it is the 106-of-106 column above.
- Reply to an NPC thread from an agency address. `Sender Email` must be the
  agency, not `rugesh@npcservices.com.au`.

---

## Still open

The 51 records already written keep an NPC address in `Sender Email`. The
dashboard no longer offers it, so this is a cosmetic and archival question rather
than a live one, and the raw bodies are still in the `Emails` table if those rows
are ever worth re-deriving — 46 of them already carry
`sales@waterscarpenter.com.au` in `Agency Email`, so only 5 are genuinely without
a contact.

Recovering an *agent* rather than an agency for a forwarded portal alert is a
different job: those alerts print agent names (`Paul Cunningham; Saxon Stonehouse`)
and no addresses. The address lives on the listing page, which is what the
scrape branch (F13/F14/F16 of the original audit, modules 94 → 98 → 100 → 97)
exists to fetch.
