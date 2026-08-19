# Stage 5 — the screening resolution centre

Read this before changing `ScreeningStageCard.tsx`,
`screeningResolution.pure.ts`, `screeningNextAction.ts`,
`AmlContextActionPanel.tsx`, or `deriveScreeningNextAction`.

Stage 5 already had every fact it needed, decided server-side and correct.
What it did not have was an arrangement of them. An operator opened the stage
and read a stage card, a screening scope, a parties list, a sanctions
requirement, a party-screening panel, a screening-checks panel and a right
rail, then reconciled all seven to learn one thing: what to do next. This
programme is orchestration over that architecture. It adds no screening
system, no determination store, no policy engine and no journey status.

## The reported screen, and what it actually was

A case showing **Case stage: Closed**, **Service gate: Terminated**,
**Passport: Revoked** — and beside them an **Advance status** card offering
*Cleared*, over a Stage 5 that looked like live onboarding.

Traced to the production row. `AML-2026-00005` held
`case_stage = 'closed'` and `status = 'kyc_complete'` at the same time. Both
surfaces were reading their own dimension correctly and **the data disagreed
with itself**.

The write that produced it is in the case events: *"Case reopened — resumed
at kyc_complete"*. `reopen_case` moved the legacy `status`, and left the
canonical `case_stage` and `closed_at` exactly where they were.
`transition` — the other write that changes `status` — has always kept
`case_stage`, `client_portal_status` and `service_gate_status` coherent
through `STATUS_TO_STAGE`. Reopening did not, and nothing noticed because each
reader was individually right.

**`reopen_case` now syncs `case_stage` and clears `closed_at`.** It still
deliberately does **not** touch `service_gate_status`:
`STATUS_TO_SERVICE_GATE[resumeStatus]` would revive a terminated gate, which
is the one thing reopening must never do.

Two dimensions, one lifecycle: a disagreement between them is a defect rather
than a third state, so every reader takes the **safer** of the two. The
transition panel is terminal when *either* says closed, and the sync operation
reports `case_closed` on the same rule.

## The second dead end

**Provider unavailable, with nothing to press.** The blockage was real, the
owner was right, and the MLRO looking at it could lawfully have completed the
screening by hand — the capability shipped in #2202 — but the stage named
neither route.

`ScreeningNextAction` now carries an optional `alternative`: a second lawful
route to the same blockage, owned by a different role. **Both are decided
server-side**; the browser only chooses which to show first. When a required
sanctions screening is blocked, the MLRO's primary is *Complete sanctions
screening manually* and the administrator's route stays named and owned as the
alternative — so the broken automation is never papered over by the existence
of a manual route, and neither role is left holding a status with no step.

An alternative is a different **method** of discharging an obligation. Nothing
in it can make an obligation unnecessary.

## Obligation ≠ method ≠ outcome

The rule the whole screen turns on. Three different questions were being
rendered in one vocabulary:

| | question | values |
| --- | --- | --- |
| **Obligation** | is this owed at all? | required · not required · not established |
| **Method** | how would it be carried out? | automated · automated unavailable · manual MLRO · recorded determination · none |
| **Outcome** | what has been established? | not started · running · no match · possible match · confirmed match · unable to complete · not a PEP · PEP · review due |

`not required` is an **obligation**. `no match` is an **outcome**. `provider
unavailable` is a **method** being unavailable and says nothing about either.
Collapsing them into one badge is how "not required" came to read as "clear",
and how an unavailable provider came to read as a case that needed nothing. A
test asserts the two vocabularies share no value at all.

`screeningResolution.pure.ts` builds one row per determination and is pure: it
reads what the server decided and arranges it. It decides no obligation,
performs no screening and reaches no determination.

## The four layers

```
A  lifecycle · ONE status · ONE action (+ the other lawful route)
B  required determinations — one row each, three answers each
C  checks that are not required — collapsed
D  parties, and the evidence panels below the card
```

Layer C is collapsed on purpose: a scope nobody owes is not a task, and
putting it beside the ones that are is most of why the screen took a minute to
read. The reasoning stays one click away, because a reduced scope has to
remain reviewable.

## Closed cases

A closed case is a **retained record**. Its evidence stays readable and, where
the compliance architecture allows, recordable — no screening, adjudication or
PEP operation checks case status, which is the product's existing and
deliberate rule. What a closed case does not do is progress.

So the stage leads with that, states it in full, and offers the one authorised
action: `reopen_case`, through the existing operation and its recorded reason.
The rule is held on **both** sides — the engine and `resolveClosedCaseAction`
in the browser — because the two deploy separately and a Stage 5 that says
"Run screening" on a retained record asserts the journey is moving when it is
not.

**A finding is exempt.** A possible or confirmed match is a fact about a
customer and does not stop being one because the file was closed, so
adjudication and escalation still outrank the lifecycle.

Reopening restores the ability to **work** the case. It does not approve the
service, revive a terminated gate, restore a revoked passport, create partner
reliance, or mark any screening complete — asserted individually against the
operation's source.

## Nothing is reclassified automatically

A case previously classified `enquiry_only` that resumes is **prompted** to
review its perimeter; it is never silently flipped. Perimeter classification
is a compliance determination recorded by a reviewer or the MLRO, unknown
fails closed, and `reopen_case` writes nothing to
`case_screening_perimeter`.

## Two numbers, two questions

The rail said "10 of 10" beside "Closed" beside an open Stage 5, and called
two of the three "stage". They now say which question each answers:
**Viewing · Stage 5** for what the operator has open, **Journey position** for
where the record has got to, **Case lifecycle** for its status.

## Roles

| action | who |
| --- | --- |
| `run_screening`, `screening_stalled`, `enrol_subjects` | any Stage 5 writer |
| `classify_perimeter`, `adjudicate_match`, `reopen_case` | reviewer or MLRO |
| `complete_manually` | **MLRO only** |

Hiding a control is never authorisation. Every one of these is enforced
independently by the edge function.

## Deployment prerequisites

Measured against the live project on 2026-08-19. None of this is code to work
around; the manual route is a lawful alternative and the automated defects stay
observable to administrators.

- **`aml.sanctions_entries` = 0**, and `aml.sanctions_list_syncs` holds **no
  rows at all**. The DFAT Consolidated List has never been imported, so an
  automated check would screen against nothing. The MLRO uploads it at
  `/aml/verification`.
- **`provider_configs.pep_sanctions` is `local_lists`, `active`, `mode =
  simulator`.** Production refuses a simulator provider rather than degrading
  to it. It must be finished as live — and promotion is earned by entries
  actually being written, never asserted.
- **`20260921000000_aml_manual_screening.sql` IS applied.** `screening_method`
  exists on `aml.screening_checks`. No new migration is needed for this work.
- **The edge functions in this branch are undeployed.** Until `aml-cases`
  ships, `case_closed`, `manualAvailable` and the `alternative` route are
  absent from the response; the browser-side overrides in
  `screeningNextAction.ts` and `AmlContextActionPanel.tsx` carry the closed-case
  reading in the meantime, which is why they exist.

## UAT

1. Open a closed case. Expect **Case closed — journey paused**, a retained-record
   explanation, **Reopen case to resume AML/CTF**, and no Advance status card.
2. Reopen it. Expect the lifecycle to read as resumed on every surface at once,
   the service gate to stay terminated, and no passport to appear.
3. On a case with sanctions required and the provider down, as MLRO: expect
   **Complete sanctions screening manually** as the primary and the provider
   fault named as the alternative. As an administrator: the reverse.
4. Record a manual no-match. Expect the sanctions row to settle and PEP to stay
   outstanding on its own.
5. On an enquiry-only case: sanctions reads *Not required / No screening
   required / Nobody screened* and never *No match*.
