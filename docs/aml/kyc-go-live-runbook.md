# KYC go-live runbook

How to take the zero-cost KYC stack from "built" to "verifying real customers".

The design and its legal reasoning are in
[`kyc-zero-cost-solution.md`](./kyc-zero-cost-solution.md). This file is only
the operational sequence.

**Everything in the repository is done.** What remains is infrastructure and two
configuration toggles, because none of it can be done from a code change: the
container has to run somewhere, the secrets have to be set against a live
project, and the decision to start verifying real people is a human one.

Nothing below changes customer-facing behaviour until **step 6**. Up to that
point the system keeps returning simulator results exactly as it does today, so
steps 1–5 can be done in working hours without a maintenance window.

---

## 0. What you need before you start

| Thing | Why |
|---|---|
| A host that can run a Docker container | The face models are Python/OpenCV and cannot run inside a Deno edge function |
| A **publicly resolvable HTTPS URL** for that container | See the warning in step 1 — this is the step people get wrong |
| Supabase project ref + CLI access (`supabase login`) | Setting function secrets |
| The `SUPABASE_SERVICE_ROLE_KEY` | Loading sanctions lists |
| An MLRO login | Provider changes are MLRO-only by policy |

---

## 1. Deploy the verification service

```sh
cd services/aml-verification-service
export AML_SERVICE_TOKEN="$(openssl rand -hex 32)"   # keep this, you need it in step 2
docker compose up --build -d
curl -s localhost:8080/healthz | jq
```

Expect:

```json
{ "status": "ok", "models": { "yunet": true, "sface": true }, "token_configured": true }
```

`"status": "degraded"` means the models are missing. They are fetched at image
**build** time, so rebuild rather than restart: `docker compose build --no-cache`.

> ### The one that catches people out
>
> `docker-compose.yml` binds to `127.0.0.1:8080` deliberately — the service
> handles biometric data and has no business being publicly routable as-is.
>
> But **Supabase Edge Functions run on Supabase's infrastructure, not yours.**
> They cannot reach `localhost` on your machine or a private VPC address. If you
> leave it on loopback, every verification will fail with
> `service_unavailable`, which the system correctly refuses to treat as a
> customer failure — attempts return to `pending` and nothing gets consumed, but
> nothing gets verified either.
>
> Pick one:
>
> 1. **Cloudflare Tunnel** (recommended; keeps the container off the public
>    internet): `cloudflared tunnel --url http://localhost:8080`, then use the
>    assigned `https://…trycloudflare.com` hostname — or a named tunnel on your
>    own domain for something stable.
> 2. **A small managed host** — Fly.io, Cloud Run, or a VPS behind HTTPS. Keep
>    it in Australia if you can; it is not required, but "processed on
>    infrastructure we control, not sent to an overseas identity verification
>    service" is what the biometric consent tells the customer, so keep that
>    statement true.
> 3. **Self-hosted Supabase functions** on the same private network.
>
> Whichever you choose, the bearer token is the access control. There is no IP
> allowlist available, because Supabase's egress addresses are not fixed.

Confirm from outside your network before continuing:

```sh
curl -s -H "Authorization: Bearer $AML_SERVICE_TOKEN" https://<your-host>/healthz | jq
```

---

## 2. Set the edge function secrets

```sh
supabase secrets set \
  AML_VERIFICATION_SERVICE_URL="https://<your-host>" \
  AML_VERIFICATION_SERVICE_TOKEN="$AML_SERVICE_TOKEN" \
  --project-ref <your-project-ref>
```

No trailing slash on the URL. The adapter strips one if present, but the
health check in step 5 is stricter than the adapter.

If either value is missing the IDV provider **throws** rather than degrading —
by design, so a misconfigured service can never be mistaken for a customer who
failed verification.

You can confirm they registered in the app under
**Settings › Integrations › Identity & Compliance › NPC Verification Service**.

---

## 3. Apply the migrations

```sh
supabase db push --project-ref <your-project-ref>
```

The four that matter here:

| Migration | What it does |
|---|---|
| `20260728120000_aml_verification_checks` | Per-party verification records, biometric consent v2026.2 |
| `20260728160000_aml_selfhosted_verification` | Sanctions tables, `aml-biometrics` bucket, access log, retention schedule |
| `20260729030000_optional_biometric_consent` | Marks biometric consent optional (APP 3.3) |
| `20260802120000_seed_selfhosted_kyc_providers` | Seeds the two provider rows **in simulator mode** |

The last one changes no behaviour. It exists so step 6 is a toggle rather than
data entry with two provider keys you have to spell correctly.

---

## 4. Load the sanctions lists

```sh
export SUPABASE_URL="https://<ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"

npm run aml:sanctions:dry-run          # parse only, writes nothing — do this first
npm run aml:sanctions:load             # DFAT + UN + OFAC
```

DFAT is now downloaded and parsed directly from the published XLSX — the manual
"export to CSV" step is gone. The download link is **discovered** from the DFAT
consolidated-list page rather than hardcoded, because DFAT renames the file when
it republishes. If the page layout changes, the loader refuses rather than
loading nothing, and tells you to pass an override:

```sh
npm run aml:sanctions:load -- --dfat-url https://www.dfat.gov.au/<path>.xlsx
npm run aml:sanctions:load -- --dfat-file ./regulation8_consolidated.xlsx   # already downloaded
```

Expect roughly 1,000 UN entries and 19,000 OFAC entries. Exact DFAT counts vary.

**Do the first DFAT run as a dry run and read the sample output.** It is the one
list whose real-world column layout could not be verified from inside this
repository, and a wrong column mapping is the kind of failure that looks like
success.

### Schedule it

A stale sanctions list is a live compliance failure, not a warning. Add two
repository secrets in GitHub → Settings → Secrets and variables → Actions:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

`.github/workflows/aml-sanctions-refresh.yml` then runs nightly (18:10 UTC ≈
04:10 Sydney) and fails the workflow if any list fails — that failure is your
alert. Without the secrets the job runs a dry run instead of going red forever.

---

## 5. Preflight

```sh
export AML_VERIFICATION_SERVICE_URL="https://<your-host>"
export AML_VERIFICATION_SERVICE_TOKEN="$AML_SERVICE_TOKEN"
npm run aml:kyc:preflight
```

Checks credentials, service reachability, model presence, token enforcement,
provider rows, list freshness, the biometrics bucket, consent state, the
retention schedule, and anything sitting in the queue. Read-only — it changes
nothing.

Exit code 0 means the stack would work if the providers were switched to live.
Warnings about providers still being in simulator mode are expected here; that
is step 6.

---

## 6. Switch the providers to live

**This is the step that starts verifying real people.** Do it as MLRO, in
**AML › Configuration › Providers**:

| Capability | Provider key | Change |
|---|---|---|
| `idv` | `selfhosted` | mode → **live** |
| `pep_sanctions` | `local_lists` | mode → **live** |

Leave `adverse_media` alone. It has no adapter, and the local lists do not cover
it — the screening result says so explicitly rather than letting a "clear" imply
a check that never ran.

If a provider is set to live and its adapter is missing, the factory throws with
a named error. That is intentional: live mode never silently falls back to
simulator results.

---

## 7. Prove it end to end

1. Open a test case, send a portal invite.
2. As the client: accept the **facial verification** consent (it is separate and
   optional), photograph a document, take a selfie.
3. As staff: case workspace → **Verification** → **Run verification**.
4. Expect `referred`, not `passed`. **That is correct.** Liveness is a heuristic
   and is never recorded as a pass, and without DVS the document's authenticity
   is explicitly unestablished, so a clean automated pass is not on offer. A
   human moves the service gate.
5. Click through to view the biometric with a reason, then check
   **biometric access** shows your view logged.
6. Run a screening against a name you know is on a list (any current OFAC SDN
   entry) and confirm it produces a match for adjudication.

Also verify the negative path: stop the container and run a verification. You
should get `service_unavailable` and the attempt should return to `pending` —
our outage must not consume one of the customer's three attempts.

---

## 8. Write down what it does not do

This is a compliance step, not a technical one, and the risk-based defence
depends on it. Record in the AML/CTF program, before you verify a real customer:

1. **Electronic verification is not performed against the issuing authority.**
   There is no DVS connection. Documents are checked for internal consistency,
   MRZ check digits, and face match — a good forgery of a real document can pass
   all three.
2. **The compensating control**: certified copies or in-person sighting for
   higher-risk matters, tied to the existing risk rating and recorded through
   **record document sighting**, which captures who certified the copy and in
   what capacity.
3. **Liveness is a heuristic**, unmaintained upstream since 2020, and never
   decides an outcome alone.
4. **The screening threshold is 0.72 and deliberately low**, with the rationale
   stored alongside it in the provider config. Nothing auto-clears; every match
   above the threshold is adjudicated by a person.
5. **No vendor indemnity.** The accuracy risk sits with us.

---

## Rollback

Fastest first:

1. **Provider mode → simulator** (AML › Configuration › Providers). Immediate,
   no deploy, stops all external calls. This is the real kill switch.
2. Unset the secrets to hard-fail instead of degrade:
   `supabase secrets unset AML_VERIFICATION_SERVICE_URL AML_VERIFICATION_SERVICE_TOKEN`
3. `docker compose down` on the service host.
4. Each migration carries a `ROLLBACK:` block in its header comment. The
   provider seed rolls back with
   `DELETE FROM aml.provider_configs WHERE provider_key IN ('selfhosted', 'local_lists');`

In-flight `pending` checks stay pending and can be adjudicated later or
completed as document sightings. No customer loses an attempt to a rollback.

---

## Running it

| Cadence | Task |
|---|---|
| Nightly (automated) | Sanctions refresh workflow. A red run means the lists are stale — treat it as a compliance incident, not a CI flake |
| Daily | Clear `pending` / `referred` verification checks; they are customers waiting |
| Weekly | `npm run aml:kyc:preflight` |
| On relationship end | Record the retention trigger so biometrics get a disposal clock — `sync_case_triggers` derives it from `relationship_ended_at` |
| Quarterly | Confirm biometric disposals are actually executing (Records › retention scans) |
| On any model change | Re-read the licence note in the service README. Do not substitute InsightFace/ArcFace weights — non-commercial only, and using them would make this deployment a licence breach |

---

## If something breaks

| Symptom | Cause | Fix |
|---|---|---|
| Every verification `service_unavailable` | Edge functions cannot reach the container | Step 1's warning — it is almost always loopback binding |
| `provider "selfhosted" is set to live mode but no adapter is wired` | Provider key typo | It must be exactly `selfhosted` |
| Everyone screens clear | Lists empty or never loaded | `npm run aml:kyc:preflight`, then step 4 |
| Verification returns `pending` repeatedly, no error | Capture unusable — no face found, or too small | A capture problem, not an identity failure. Ask for a retake in better light |
| Client cannot get past consent | Biometric consent marked required | Apply `20260729030000_optional_biometric_consent.sql` |
| `parser produced 0 entries` | Publisher changed the file layout | Dry-run it and read the output; use `--dfat-url` / `--dfat-file` if it is DFAT |

---

## Phase 9 release-candidate status (controlled rollout)

The partner/reliance domain (Phases 1–8 + pre-rollout remediation) is
**source implemented and locally tested** on branch
`claude/aml-ctf-remediation-and-controlled-rollout`: record classifications
corrected (raw ID copy P3, legal hold P4, SMR P5 seeded), controlled
expiring audited P3 evidence access completed, action-level write flags
added (all default false; service/settlement blocking reserved and
enforced nowhere). The 60-migration chain, behaviour battery, rollback
rehearsal and flag dependency order were proven on a disposable local
Postgres (`supabase/tests/aml-local-rehearsal/`). **Staging is not
deployed, staging is not verified, production is not deployed** — no
statement in this document may be read as claiming otherwise. The rollout
sequence, evidence sheets, UAT plan, sign-off register (no sign-offs
obtained) and open legal/MLRO decisions live in `docs/aml/rollout/`.
