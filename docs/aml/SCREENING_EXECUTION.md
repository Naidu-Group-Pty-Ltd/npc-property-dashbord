# How a screening request actually executes

Read this before touching `cross-portal-outbox-worker/screeningConsumer.ts`,
the inline execution path in `aml-cases`, `_shared/aml/partyScreening.pure.ts`,
`screeningPolicy.pure.ts`, or anything that decides whether a party has been
screened.

It exists because "AML screening never starts" was reported as a UI defect,
investigated three times, and was in fact **four independent faults stacked on
top of each other**, each of which fully explained the symptom on its own and
each of which was invisible from the layer above it. Every one of them is the
same shape: *a failure that reported as normal operation.*

## The path

```
operator presses Run screening
  └─ aml-cases writes aml.party_screening_subjects (state = queued)
     └─ and an integration_outbox row, event aml.screening.requested
        └─ pg_cron: cross-portal-outbox-worker, every minute
           └─ signed envelope: cron_signed_internal_headers → verifyInternal
              └─ screeningConsumer claims the subject (conditional UPDATE)
                 └─ resolveTenantProvider + getScreeningProvider
                    └─ local_lists screens against aml.sanctions_entries
                       └─ screening_checks + screening_matches
                          └─ subject projected: cleared / matched / error
```

`aml-cases` can also run the same consumer **inline** on the request, so a
screening does not have to wait a minute. Both paths converge on the same
code; neither is a fallback for the other being broken.

## The four faults, outermost first

### 1. The signing key had diverged. Nothing scheduled ran at all.

`cron_signed_internal_headers` signs with the Vault's `internal_edge_secret`;
`verifyInternal` verifies with the Edge runtime's `INTERNAL_EDGE_SECRET`. They
are two copies of one value and nothing kept them in step. Measured on
2026-08-18:

| caller | denials | since |
| --- | ---: | --- |
| `agent_task_runner.invoke` | 7,160 | 2026-07-23 |
| `email_sync_cron.invoke` | 7,158 | 2026-07-23 |
| `cross_portal_outbox_worker.invoke` | 2,856 | 2026-08-16 |

**17,174 rejected invocations.** Every scheduled worker in the deployment was
dead, including the one that drains `aml.screening.requested`.

Nothing above this said so. `cron.job_run_details` showed 2,876 *succeeded*
runs, because what succeeded was the SQL that queued the HTTP request — not the
request. The only honest signal was `attempts = 0` on outbox rows that had been
waiting for hours, and a 403 in `net._http_response`.

Rotating both halves in one run is `.github/workflows/rotate-internal-edge-secret.yml`.
Neither copy can be read out to compare with the other, so the repair is to
issue a new value and write it to both stores — never to move a live secret
through a log, a commit or a clipboard.

### 2. The claim predicate could not be parsed. It had never once succeeded.

The consumer claims a subject with a conditional `UPDATE` so the provider runs
at most once per delivery. It was written as one PostgREST `.or()` string with
an ISO timestamp interpolated into it:

```ts
.or(`state.in.(queued,error),and(state.eq.processing,updated_at.lt.${cutoff})`)
```

PostgREST cannot parse that — a timestamp carries the `.` and `:` its filter
grammar treats as structural, so the embedded `and(...)` broke and the whole
expression was read as a column reference:

```
column party_screening_subjects.state does not exist
```

**The claim failed for every subject, every time, from the day it was written.**
Nobody had seen it because fault 1 meant the line was never reached.

It survived review because it reads correctly. It survived the test suite
because the consumer's own test double implemented `.or()` by pulling the
cutoff back out of the string with a regex — the code and its test agreed with
each other, and only the server disagreed. That double no longer emulates
`.or()` at all, and `screeningClaimPredicate.contract.test.ts` fails any filter
composed as a string or interpolating a value into a filter argument. It is the
same class as SQL string-building and has the same remedy: **never hand the
parser a sentence you assembled yourself.**

### 3. The error was discarded, so a database fault looked like a race.

The statement destructured `data` only. PostgREST returns `{ data: null, error }`
on any failure, and `data: null` is *also* what losing the claim race looks
like. So every database failure here was reported as "another worker has it,
retry" — the one outcome that converges nowhere. The inline caller swallowed
it, the worker retried for ever, and the subject sat `queued` with no
`error_category`, no `screening_check` and no case event.

That is exactly the silent stall the consumer exists to prevent, hiding inside
its own safety mechanism. The two cases are now separated: a genuine race still
retries, a database failure is recorded against the subject and named.

### 4. A configured-but-unfinished provider was reported as no provider.

There are three typed refusal codes. Two consumers collapsed them by hand:

```ts
err.code === 'provider_misconfigured' ? 'provider_misconfigured'
                                      : 'provider_not_configured'
```

which sends `simulator_blocked_in_production` to the wrong branch. Production's
row is `local_lists`, **active**, mode `simulator` — configured, and unable to
execute — so the administrator was told "No screening provider is configured
for this tenant. An administrator must configure one": a remedy asking for a
provider that already exists, while the real remedy was never named.

`technicalCategoryForRefusal` in `providerEnvironment.ts` is now the only
mapping. The distinction it protects is the reason both categories exist:
**not configured** means there is nothing there to fix; **misconfigured** means
something is there and is unfinished. Only the absence of a provider row is the
former.

## The rules that keep biting

**A green cron run is not a delivered request.** pg_cron reports on the SQL it
ran, not on the HTTP call that SQL queued. The state that tells the truth is
`integration_outbox.attempts` and `net._http_response.status_code`.

**A failure must converge, and converging means saying which failure.** Every
technical outcome goes through one `recordTechnicalFailure`: state `error`, a
named `error_category`, a case event, and `last_screened_at` **untouched** — an
error is never a clear result and never counts as having screened anybody. A
subject that cannot converge because the platform is not ready is still
converged, with the reason; a stalled subject that reaches `aml-cases` is
converged on read (`SCREENING_STALL_SECONDS`) rather than left queued.

**Production never runs the simulator.** `decideProvider` refuses it as an
unfinished configuration rather than degrading to it, in either direction: a
key of `simulator`, or a real key still in simulator mode. This is what makes
"screening is not operational" impossible to confuse with "screening found
nothing", and it must not be relaxed to make a surface green.

**Screening against an empty list is not screening.** `local_lists` is the only
wired live adapter and it screens against `aml.sanctions_entries`. Promotion out
of simulator mode is earned by entries actually being written
(`decideProviderPromotion`), never asserted; and a list past
`LIST_STALE_AFTER_DAYS` is refused as stale rather than used quietly. Loading a
list that is years old would produce confident clears against a world that has
changed — which is worse than a visible refusal, because it is indistinguishable
from a real result.

**Two copies of one secret is a defect with a long fuse.** It failed silently
for 26 days across three workers before anything surfaced it. If a third copy
is ever introduced, it needs the same one-run rotation, or this recurs.
