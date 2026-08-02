# Zero-cost KYC — recommended solution

Requested 2026-07-28: integrate the KYC option at no cost.

**This is achievable for licence cost, with one exception that no amount of
engineering removes: the Document Verification Service.** §1 explains why that
is survivable rather than fatal, §2 is the stack with every licence verified,
§3 is what to build, §4 states plainly what you are giving up, and §5 is how
this stays defensible to AUSTRAC.

The previous blocker is solved. §2 identifies a face-recognition model whose
**weights** — not just its code — are Apache-2.0, which is what the earlier
CompreFace/InsightFace correction was missing.

---

## 1. Why $0 is legally viable

Electronic verification is **one permitted method, not a requirement**. The
AML/CTF Rules allow a reporting entity to verify a customer from *reliable and
independent documentation*, from *reliable and independent electronic data*, or
from a combination. Verifying from an original or certified copy of an identity
document is a compliant procedure in its own right, and is what a large share of
Australian real estate agencies and conveyancers already do.

So the zero-cost design is not "electronic verification with the paid bits
removed". It is **documentary verification as the primary method, strengthened
by free automated checks**, with the residual risk managed by a documented
risk-based approach.

That reframing matters: it means the free stack is not a degraded imitation of a
paid product, it is a different lawful procedure with its own controls.

---

## 2. The stack — every licence verified

Verified at the level that actually binds: the **model weights**, not the
repository badge.

| Layer | Component | Licence (code **and** weights) | Cost |
|---|---|---|---|
| Face detection | **YuNet** — `opencv_zoo/models/face_detection_yunet` | Apache-2.0 | $0 |
| **Face match** | **SFace** — `opencv_zoo/models/face_recognition_sface` | **Apache-2.0, weights included** — confirmed by reading the model's own `LICENSE` file, which is the full Apache 2.0 text | **$0** |
| Liveness | [Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing) | Apache-2.0, models bundled in-repo under the same licence | $0 |
| MRZ read + checksum | [`mrz`](https://github.com/Arg0s1080/mrz) / [PassportEye](https://github.com/konstantint/PassportEye) | MIT | $0 |
| OCR | [docTR](https://github.com/mindee/doctr) or Tesseract | Apache-2.0 | $0 |
| Sanctions / PEP | **DFAT Consolidated List** (XLSX, official, updated 23 Jul 2026) + UN Consolidated + OFAC SDN | Free, official government sources | $0 |
| Orchestration, evidence, audit | `aml.verification_checks` — already built | ours | $0 |

### The SFace finding

This is the load-bearing item. `opencv_zoo/models/face_recognition_sface/LICENSE`
is the complete Apache License 2.0, granting a *"perpetual, worldwide,
non-exclusive, no-charge, royalty-free, irrevocable copyright licence to
reproduce, prepare Derivative Works of … and distribute the Work"*. It applies
to the model as distributed, not merely to surrounding code.

That is the difference from InsightFace-ArcFace, whose weights are
non-commercial research only, and it is why this stack is lawful where the
earlier CompreFace recommendation was not without a paid licence.

SFace is a smaller, older model than ArcFace and will be somewhat less accurate.
That is the trade, and §4 addresses it. **Attribution obligation:** Apache-2.0
requires retaining the copyright notice (Shenzhen Institute of Artificial
Intelligence and Robotics for Society) and the licence text wherever the model
is distributed. Keep both alongside the model file.

### Why not DFAT via OpenSanctions

OpenSanctions republishes the DFAT list, but its aggregated data is CC-BY-NC and
so is not free for us. **Take the list directly from DFAT** — it is the legally
operative Australian source, free, official, and the one an AUSTRAC reviewer
would expect to see cited.

---

## 3. What to build

Four pieces. Nothing already built has to change: `aml.verification_checks` is
per-party, vendor-agnostic, `provider` is free text, and the three-attempt
ceiling is already a database constraint.

### 3.1 A small verification service

The models are Python/OpenCV and cannot run inside a Deno edge function. Stand
up one container exposing three endpoints:

```
POST /face/compare   { document_photo, selfie }  → { similarity, threshold, match }
POST /face/liveness  { selfie }                  → { score, is_real }
POST /doc/mrz        { document_image }          → { fields, checksums_valid }
```

Roughly 200 lines of FastAPI over OpenCV. It holds no state and no database
access — it takes images and returns numbers, so it never becomes another place
customer data lives.

Deploy it alongside existing infrastructure, or on a free tier. Compute is the
only non-zero item and at your volumes it is negligible; **licence cost is $0**.

### 3.2 Portal capture step

A "Verify your identity" step after Documents, per party:

1. Client photographs their ID document (already supported).
2. Client takes a selfie via `getUserMedia`.
3. Server calls `/doc/mrz`, `/face/liveness`, `/face/compare` and writes one
   `aml.verification_checks` row.
4. Result is `passed`, `referred` or `failed`; on failure the client sees
   attempts remaining, and the third failure moves them to `exhausted` with a
   staff task raised.

Gate it on the `biometric_collection` consent already published at catalogue
v2026.2 — the schema constraint already refuses to store a biometric without it.

### 3.3 Free sanctions screening

A scheduled job downloads the DFAT XLSX, UN and OFAC lists into an `aml`
reference table, then screens each party on name and date of birth.

**Deliberately tune the threshold low.** You do not have a commercial
aggregator's alias and transliteration handling, so accept more false positives
and send them to human review. Over-referring is a conservative failure mode and
costs staff minutes; under-matching is a compliance failure. Record the
threshold and its rationale — a reviewer will ask why it is set where it is.

### 3.4 Assisted verification — the fallback that carries the weight

Under this design the documentary path is not a fallback for edge cases, it is
**the primary evidence**. Staff record: which document was sighted, whether it
was an original or a certified copy, who certified it, who sighted it, and when.

Most of this exists in the document-requirement and evidence machinery. What is
missing is an explicit verification record rather than just a stored file —
which is exactly what `aml.verification_checks` with
`check_type = 'document_sighting'` is for.

### Optional, free, and stronger than DVS where it applies

Australian passports carry an **ICAO 9303 chip**. Reading it and validating the
issuer's signature (passive authentication) proves the document is genuine and
unaltered — cryptographic proof, arguably stronger than a DVS match — and the
chip yields the holder's photo for face matching. [JMRTD](https://jmrtd.org/) is
open source.

Two honest limits: it needs the CSCA certificate master list (full ICAO PKD
access is a paid membership, though many certificates are published), and NFC in
a browser is Chrome-on-Android only. So: a genuine bonus for some customers, not
a foundation.

---

## 4. What you are giving up

Stated plainly, because these must go in the AML/CTF program rather than be
discovered later.

1. **No DVS — you are not checking against the issuing authority.** You are
   checking that a document is internally consistent, that its MRZ checksums
   pass, and that the person presenting it matches its photo. A
   well-manufactured forgery of a real document can pass all three. **This is
   the single real gap**, and no free alternative closes it.
2. **Weaker liveness.** Silent-Face-Anti-Spoofing is unmaintained since 2020 and
   predates current generative attacks. Treat its score as one signal; never let
   it alone decide a pass.
3. **Lower face-match accuracy.** SFace under-performs ArcFace. With a
   three-attempt ceiling, more false rejections means more customers routed to
   manual handling. Budget staff time for this rather than being surprised by it.
4. **Screening quality is yours to own.** Official lists, but your own matching.
   Aliases and transliteration are where commercial aggregators earn their fee.
5. **No vendor liability or indemnity.** The accuracy risk sits with you.

**The honest summary: this is a good, lawful, zero-licence-cost system that is
weaker than a paid one at exactly one point — proving the document is real.**

---

## 5. Making it defensible

AML/CTF is explicitly a **risk-based** regime. A control set that is weaker in a
known way is acceptable where the weakness is identified, documented, and
compensated. It is not acceptable where it is undocumented or unnoticed.

Four things make this stand up:

1. **Write the limits into the AML/CTF program.** State that electronic document
   verification is not performed against the issuing authority, and why.
2. **Require certified copies or in-person sighting for higher-risk matters.**
   This is the compensating control that covers the DVS gap where it matters
   most, and it is free. Tie it to the existing risk rating.
3. **Set the screening threshold conservatively and record the reasoning.**
4. **Keep the evidence quality you already have.** Hash-chained events, consent
   pinned to the exact wording shown, per-party verification records, trigger-
   based retention. Evidence quality is where this system is already *stronger*
   than a typical paid integration, and it is what an independent review under
   AML/CTF Act s 84 actually examines.

### If it later needs to be upgraded

Nothing here is a dead end. Adding DVS through a Gateway Service Provider is a
new `check_type = 'dvs'` row against the same party — no schema change, no
rework of the portal flow, no migration. The same is true of swapping SFace for
licensed weights if accuracy proves insufficient in practice.

**Recommendation: build this, run it, and measure.** If the false-rejection rate
turns out to cost more in staff time than a paid licence would, you will have
real numbers to make that decision with rather than a vendor's marketing.


---

## 7. Implementation status (2026-07-28)

Built and shipped. What exists now:

| Piece | Where | State |
|---|---|---|
| Verification service | `services/aml-verification-service/` | FastAPI + OpenCV, Dockerised, 22 tests |
| Matching + MRZ engine | `supabase/functions/_shared/aml/matching.ts` | 42 unit tests |
| Self-hosted IDV adapter | `_shared/aml/providers/index.ts` → `selfhosted` | wired into the existing factory |
| Local-lists screening adapter | same file → `local_lists` | reads `aml.sanctions_entries` |
| Schema | `20260728120000`, `20260728160000` | applied live |
| Sanctions loader | `scripts/aml/load-sanctions-lists.mjs` | UN + OFAC automated; DFAT via CSV export |
| Client portal step | `src/components/portal/IdentityVerificationStep.tsx` | camera capture + upload fallback |
| Command centre panel | `src/components/aml/VerificationSection.tsx` | adjudication, sightings, audited image access |

### Decisions that were forced during the build

- **The portal reads party names from the client's own questionnaire, not from
  `aml.beneficial_owners`.** A contract test caught the latter. The ownership
  model carries internal analysis, and the portal boundary is drawn at the
  table rather than per-field precisely so it cannot be eroded a column at a
  time. Declared parties get a deterministic derived id so the attempt ceiling
  stays enforceable per party.
- **Liveness is never recorded as `pass`.** Best case is `warn`. Recording a
  heuristic as a pass would overstate what was established, and that record
  outlives whoever wrote it.
- **An unreadable MRZ is a warning, not a failure.** Australian driver licences
  carry no ICAO MRZ. A *failed check digit* is an entirely different signal.
- **A service outage returns the attempt to `pending`.** Our infrastructure
  failing must not consume one of the customer's three attempts.
- **A capture problem (`unusable`) is separated from an identity failure.**
  Bad lighting is not a finding against the customer.
- **Screening never auto-clears a match.** Everything above the threshold goes
  to a person; the low threshold is only defensible because a human adjudicates.

### Operational prerequisites

**Full sequence: [`kyc-go-live-runbook.md`](./kyc-go-live-runbook.md).** In short:
deploy the container somewhere the edge functions can actually reach (not
loopback — that is the step people get wrong), set the two secrets, load the
lists, run `npm run aml:kyc:preflight`, then switch the two providers to live.

---

## 8. Operational hardening (2026-08-02)

The gap between "built" and "runnable" — everything except the infrastructure
itself, which cannot be done from a code change.

| Piece | Where | What changed |
|---|---|---|
| DFAT automated | `scripts/aml/sanctionsParsers.mjs` | Reads the published XLSX directly via the existing `xlsx` dependency. The manual CSV export step is gone, so the Australian list is no longer the one most likely to go stale. The download link is discovered from the DFAT page rather than hardcoded, because DFAT renames the file when it republishes |
| DFAT alias grouping | same | DFAT publishes one row per name variant. Rows are now grouped by listing reference, so aliases become aliases. Previously each row was written as its own listing and they collided on `(list_code, external_id)` — whichever alias sorted last stood in as the person's primary name |
| Stale entries pruned | `load-sanctions-lists.mjs` | Upsert alone left delisted parties matching forever. Pruning is guarded by a shrink floor: a list that halves is treated as a truncated download, not a mass delisting, and nothing is deleted |
| Scheduled | `.github/workflows/aml-sanctions-refresh.yml` | Nightly. The workflow failing **is** the alert |
| Parser tests | `tests/aml/sanctions-parsers.test.mjs` | 13 tests, including CSV↔XLSX parity and a guard that the loader's normalisation word lists stay identical to `matching.ts` |
| Biometric disposal | `aml-records/index.ts` | The retention schedule existed with nothing behind it. Triggers are now derived at relationship end, biometrics are enumerated by retention scans, and disposal deletes the storage object, clears the pointer columns and writes a `dispose` row to the access log. The verification record survives — the image is what is being destroyed |
| Preflight | `scripts/aml/kyc-preflight.mjs` | `npm run aml:kyc:preflight` — one read-only command answering "would this work if I switched it on" |
| Provider rows seeded | `20260802120000_seed_selfhosted_kyc_providers.sql` | Both in **simulator** mode, priced after any existing provider, so behaviour is unchanged and go-live is a toggle |
| Secrets visible | `check-integration-secrets`, `integrations/registry.ts` | The two service variables now appear under Identity & Compliance instead of being invisible until something failed |
| List health in-product | `src/components/aml/SanctionsListHealth.tsx` | Staleness was only visible to whoever ran the script. Screening an empty list returns "clear" for everyone and looks exactly like screening that worked |

### Still not covered

DVS. Unchanged and unchangeable at zero cost — see §3. The compensating
control is certified copies or in-person sighting for higher-risk matters,
recorded through `record_document_sighting`, which now captures who certified
the copy and in what capacity.

Adverse media is not covered by list data either. The screening summary returns
`scopes_not_covered` rather than letting a "clear" imply a check that never ran.
