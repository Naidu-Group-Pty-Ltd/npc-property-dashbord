# KYC / identity verification — integration options

Status: **proposal, not implemented.** Written in response to the request for
"a KYC factor integrated for the client to complete … coupled with the main
command centre receiving the confirmation … trackable."

Everything below assumes the consent layer shipped alongside this document
(`aml.consent_documents`, server-enforced consent gate). Electronic
verification must not run before the `identity_verification` consent is
recorded — that consent is what authorises it.

---

## 1. What the regulation actually requires

Verification is not a single "KYC check". Under the AML/CTF Act and Rules a
reporting entity must, before providing a designated service:

| Requirement | What it means here |
|---|---|
| Collect KYC information | Name, date of birth, residential address (individuals); name, ABN/ACN, registered address (entities) |
| **Verify** that information | From reliable and independent documentation, electronic data, or a combination |
| Identify beneficial owners | Anyone owning/controlling ≥25%, or controlling a trust — and verify them too |
| Identify the person acting | Anyone acting on behalf of the customer, plus their authority to do so |
| Screen | Sanctions, PEP, and (risk-based) adverse media, on the customer and connected parties |
| Keep records | Seven years from the relevant trigger event |

Two practical consequences for the design:

- **A selfie-and-licence check is not sufficient on its own** for a company or
  trust purchase. The flow must branch on the purchasing structure the client
  already declares in the questionnaire.
- **The check result is evidence, not a status flag.** What matters at audit is
  the verification *report* — which sources were matched, at what confidence,
  at what time — not a green tick in our database.

---

## 2. Three viable integration options

### Option A — Managed IDV provider (recommended)

Use a single Australian IDV vendor covering document capture, liveness/face
match, DVS (Document Verification Service) checks, and sanctions/PEP screening
behind one API. Candidates in this market include FrankieOne, Trulioo,
Sumsub, Onfido and the identity arms of Equifax and illion. FrankieOne and the
credit-bureau options are the usual fit for an Australian real-estate reporting
entity because they bundle DVS, credit-header matching and PEP/sanctions.

**Flow.** Portal creates a verification session → client is redirected (or
shown an embedded widget) → provider captures documents and biometrics →
provider posts a signed webhook to a new `aml-provider-webhook` handler → we
store the outcome, the reference, and a copy of the report.

| | |
|---|---|
| **Pros** | Fastest to a compliant result. Liveness and document authenticity are genuinely hard to build. One contract, one audit trail. Vendor keeps pace with DVS and sanctions-list changes. |
| **Cons** | Per-check cost (typically a few dollars). Vendor lock-in. Client data leaves our systems — needs an APP 8 cross-border assessment and must be named in the collection notice (the shipped `privacy_notice` already discloses this). |
| **Effort** | ~2–3 weeks including webhook hardening, retries and the fallback path. |

**This is the recommendation.** The alternatives below are worth building only
in addition to it, not instead.

### Option B — Direct DVS via a gateway

Connect to the Attorney-General's Department **Document Verification Service**
through an accredited gateway. DVS confirms an identity document matches the
issuing authority's record. It does **not** confirm the person presenting it is
the document holder, so it must be paired with either a face match or a
document-sighting workflow.

| | |
|---|---|
| **Pros** | Authoritative source. Lower per-check cost. Data stays in Australia. |
| **Cons** | No liveness — an impersonation risk you must close another way. Accreditation and onboarding with a gateway takes time. Doesn't cover PEP/sanctions, so you still need a second vendor. |
| **Effort** | ~3–4 weeks, plus gateway onboarding lead time. |

### Option C — Assisted / manual verification (required regardless)

A staff member verifies from certified copies or an in-person/video sighting,
and records who verified, what they saw, and when.

This is not really an "option" — **you need it whatever else you build**, as
the fallback for clients who fail electronic verification, refuse it, or have a
thin data footprint (recent migrants, young adults, some trusts). Building only
the automated path guarantees a dead end for a real slice of customers.

The existing document-requirement and evidence machinery already covers most of
this; what's missing is an explicit *verification record* rather than just an
uploaded file.

---

## 3. Recommended shape

**Option A as the primary path, Option C as the mandatory fallback.** Skip
Option B unless per-check cost becomes material at volume.

### Data model

One new table, mirroring the pattern already used for consents:

```
aml.verification_checks
  id, case_id, party_id            -- party_id: the customer OR a beneficial owner
  check_type                       -- 'electronic_idv' | 'document_sighting' | 'dvs' | 'screening'
  provider, provider_reference     -- vendor + their session id, for reconciliation
  status                           -- 'pending' | 'in_progress' | 'passed' | 'failed'
                                   -- | 'referred' | 'expired' | 'abandoned'
  outcome_detail  jsonb            -- sources matched, confidence, reasons
  report_storage_path              -- the vendor's PDF/JSON report, retained as evidence
  verified_by, verified_by_type    -- staff member for manual checks
  requested_at, completed_at
  retention_trigger_recorded       -- feeds the existing §18 trigger clock
```

Critically: **one row per party, not per case.** A trust purchase can need four
verifications, and a case-level flag cannot represent "two of four passed".

`referred` matters as much as `passed`/`failed` — most real IDV outcomes that
need human attention are neither a clean pass nor a clean fail.

### Client portal

Add a **Verify your identity** step after Documents in the existing stepper:

- Shows one card per party requiring verification, derived from the declared
  structure and the ownership data already captured in Phase 6.
- Each card launches the provider session and reflects live status.
- Explicit "verify from documents instead" escape hatch, which raises a staff
  task rather than dead-ending the client.
- `submit_for_review` gains a verification gate alongside the consent gate.

### Command centre

- **Case workspace → Identity section**: per-party verification status, provider
  reference, outcome detail, and a link to the stored report.
- **Timeline**: every state change appends to the existing hash-chained
  `aml.case_events`, so verification history is tamper-evident like everything
  else.
- **Re-verify** action for MLRO/analyst when a check expires or circumstances
  change, preserving the prior result rather than overwriting it.
- Verification status feeds the **service gate** as an input — never as an
  automatic approval. A passed IDV is evidence for a decision, not the decision.

### Trackability

The request specifically asked for this. Four layers:

1. **Per-party rows** with explicit lifecycle states — you can always answer
   "who is outstanding and why".
2. **Provider reference stored on every row** — reconcilable against the
   vendor's own console during a dispute or an audit.
3. **Hash-chained case events** for every transition — already built, already
   independently verifiable via the Phase 11 chain-recomputation tooling.
4. **A verification ageing view** in the command centre: outstanding checks by
   age, so nothing sits silently.

---

## 4. Decisions needed before implementation

1. **Vendor.** Needs a commercial call plus a privacy assessment. If any
   processing is offshore, the `privacy_notice` consent document (v2026.1)
   already discloses cross-border disclosure in general terms, but the vendor
   should be named once chosen.
2. **Biometric handling.** Whether face-match images are retained by us at all,
   or only by the provider. Recommendation: **do not retain them** — they are
   sensitive information under the Privacy Act and add breach exposure for
   little evidentiary gain over the provider's report.
3. **Re-verification interval.** Whether verification expires (commonly 12–24
   months) and re-runs on the existing ongoing-CDD review cycle.
4. **Failure policy.** What a `failed` outcome does to the service gate.
   Recommendation: it should *inform* the gate and require a human decision —
   never auto-block, never auto-approve.

---

## 5. What this does not change

The protected baseline holds: verification results are **internal AML
information**. The client portal shows a party's own status and what is
outstanding; it never shows screening detail, PEP or adverse-media findings,
risk ratings, or reviewer commentary. The finance portal sees none of it.
