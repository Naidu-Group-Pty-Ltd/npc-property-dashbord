# Stage 9 — Service gate & Passport

Read this before touching `_shared/aml/passport/passportState.pure.ts`'s reason
codes, `refreshRemedy`, `gatePassportPath.pure.ts`, `GatePassportPathCard`,
`passportActions.pure.ts` or `journeyModel`'s `passportStage`.

The reported symptom: *"to me there doesn't seem to be a clear distinction for
section 9 to be ticked off as green after the user has already ticked off the
Approved function… it is a little difficult to understand and proceed forward
from here."*

That reading was right twice over, and neither half was a rendering problem.

## A remedy that cannot discharge the reason

`refresh_required` is **one code covering two different owed acts**, and the
product rendered both of them as *"issue a new version"*.

Measured on the reported case, `AML-2026-00005`, from production:

| fact | value |
|---|---|
| `aml.compliance_attestations` | v1, issued 2026-08-27 |
| `superseded_at` | NULL |
| `refresh_required_at` | NULL |
| open `partner_refresh_obligations` | 0 |
| `service_gate_status` | `under_review` |
| derived passport state | **`refresh_required`** |
| its reasons | **`["service_gate_regressed"]`** |

Nothing about the document was wrong. `derivePassportState` flags the Passport
when the gate has not been approved — correctly, because a Passport nobody has
authorised the service for must not read as Current — but it flags it with the
*same code* it uses for a document that is genuinely out of date.

So Stage 9's step 4 said **"A newer version is needed — reissue from the
reliance panel below"**, and the reliance panel opened *"Issue the
attestation"* as the one act, reading *"v1 is flagged for refresh — issuing v2
supersedes it"*, with a **Reissue as v2** button.

Following that advice supersedes a perfectly good v1 and changes nothing —
**v2 reads `refresh_required` too**, for the same reason, because the gate is
still not approved. It is a loop, and it writes an audit trail on the way
round.

**The rule: a remedy that cannot discharge the reason is never offered as the
next step.**

`refreshRemedy(reasons)` in `passportState.pure.ts` is the one place that knows
which act clears which reason — `"reissue"`, `"approve_gate"`, `"both"`,
`"none"`. Three things keep it honest:

- **An unrecognised reason counts towards the reissue.** That is the
  conservative side: an unnecessary version costs a version, a withheld one
  strands the case.
- **A healthy or terminal reason owes nothing.** `issued_current` publishes
  `current_attestation_gate_approved`, and a caller may hand this function any
  state's reasons; defaulting that into "reissue" would tell an operator to
  supersede a Passport that is working. A locked or terminated gate is
  likewise the MLRO's own standing decision, not a debt.
- **Nothing may go unclassified.** `passportRefreshRemedy.test.ts` reads
  `passportState.pure.ts` for every reason string it can emit and fails on one
  the classifier does not name. A new gate-shaped reason cannot silently
  default into "reissue" and reopen this.

## Why the stage would not tick green — and now says so before the click

On that case the stage completes **the moment the gate is approved**:
`service_gate_regressed` was the only reason, so the server re-derives
`issued_current` immediately. A test asserts that, against the same
`derivePassportState` the server runs.

Nothing on the screen ever said so. Three things were in the way.

**The issuance debt was counted twice.** Step 4 sat outstanding for a fact
step 2 already carried — "the gate is not approved". Where the gate is the
*only* reason, a version exists, so the step is **done** and says
`v1 is issued and stays in force. It reads as current the moment the gate above
is approved`. The stage still does not complete: completion is every owed step,
and the gate is still one.

**There was no finishing line.** `gatePassportProgress` reports `remaining`
and `finishesStage`, and the card names it: *"One step left — Service gate
approved. Completing it finishes this stage."* The promise is exact or absent —
a **blocked** last step promises nothing and names who must act instead, and
two owed steps say two.

**Three numbers described one stage.** The header rendered "0 of 3 items on
this stage complete", the rail rendered "0 of 3 items complete", and the card
listed four steps. All were true and none was about the list underneath them —
the identical defect Stage 5 already fixed. Stage 9 now sets
`deferToSurfaceBelow` and `deferReadinessToSurfaceBelow`, and the card carries
the only count, in the units of its own steps. `anytime` is excluded: **a look
is not a debt**.

`journeyModel.passportStage` follows the same rule — where only the gate is
owed, the Passport is a *completed* item rather than a second outstanding one,
and the summary says the approval "is all that is left on this stage".

## The portal tiles on the Compliance Journey Map

Two defects of the same kind: the map showed a door that does not exist and
refused to light the ones that do.

**Builder and Developer are ONE portal.** They sign into the Builder/Developer
portal. `partnerOnboarding.pure.ts` removed that split from the onboarding
wizard — *"two doors into one room"* — and the map kept it, so a "Developer
portal" tile stood there permanently reading "Not yet connected" because there
is nothing for it to connect to. It is one tile now, and `PORTAL_ORG_TYPES`
maps the portal to the organisation types it serves, so a partner recorded as
`developer` lights the portal they actually sign into rather than **vanishing
from the map**. The AML server's vocabulary is unchanged: `organisation_type`,
`portal_type` and the builder portal's own `org_type` all still carry both.

**A live Passport reads green.** A live grant is the outcome the whole journey
exists to produce — *"one process, every portal"* — and it was drawn in
progress-blue while the Client portal went green for finishing its own part. A
case whose Passport had reached three partners looked unfinished on the one map
that exists to show it had not been done three times.

Green here says exactly what the Client portal's green says: this portal's part
of the one process is done and the partner can read the record. It is
deliberately **not** a claim about that partner's own compliance — the status
wording stays a fact about ACCESS (`Passport live`, or `Passport live · partner
assessed`), because "Partner assessment satisfied" carried precisely that risk.
A revoked grant is not live, so **withdrawing access takes the colour back**.

Finance keeps its own middle state — the case row records that the portal was
*requested*, which the partner tiles have no equivalent of — and a live
Passport outranks it.
