# The complete execution route, resolved before anything is provisioned

*Measured 18 September 2026 from this session. The instruction it answers:
"Do not request branch creation while leaving the subsequent invocation route
unresolved."*

## 1. The finding, first

**One leg of the route is closed, and no credential or branch opens it.** The
sandbox's egress is a fixed proxy policy that denies `CONNECT` to every web
host, and the headless browser sits behind the same proxy as everything else.
So the frontend half of the journey — R1 to R11, selection, editing, saving,
reopening, previewing, exporting, history and permissions — **cannot be
exercised from this session against any deployment**, production, branch or
otherwise.

Measured, with Playwright's own Chromium:

```
https://example.com/                                  ERR_TUNNEL_CONNECTION_FAILED
https://dduzbchuswwbefdunfct.supabase.co/functions/v1/ ERR_TUNNEL_CONNECTION_FAILED
https://api.perplexity.ai/                            ERR_TUNNEL_CONNECTION_FAILED
https://ai.gateway.lovable.dev/                       ERR_TUNNEL_CONNECTION_FAILED
```

`example.com` is the one that settles it. This is not a vendor policy, a key,
a CORS rule or a Supabase setting — it is the sandbox, and it refuses an
ordinary public page. The proxy says so in its own words:

```
curl -sS "$HTTPS_PROXY/__agentproxy/status"
  "enabled": true, "selective": false, "toolScoped": false,
  "noProxy": "localhost,…,registry.npmjs.org,jsr.io,npm.jsr.io,pypi.org,
              files.pythonhosted.org,index.crates.io,proxy.golang.org,…"
  "recentRelayFailures": [
    { "kind": "connect_rejected",
      "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
      "host": "esm.sh:443" }, …
  ]
```

The exemptions are package registries and internal ranges. Nothing else.

**Why the MCP tools still work.** They are not in the sandbox. The Supabase,
GitHub, Lovable and Airtable MCP servers run outside it and relay; that is why
`execute_sql` answers while `curl https://dduzbchuswwbefdunfct.supabase.co`
does not. Any route that runs *through an MCP server* or *inside the Supabase
project* is open; any route that requires this container to open a socket to
the internet is closed.

## 2. The route, leg by leg

| Leg | Route | Status |
| --- | --- | --- |
| Provision an isolated project | `mcp__Supabase__create_branch` | **Broken.** It rejects `confirm_cost_id` with a Zod error although its own schema requires that field, and times out without it. Neither attempt produced a resource, so there is nothing to reconcile and nothing was charged. Established in a previous session; not re-tested today, because a retry risks creating a chargeable resource. |
| Set secrets on it | Supabase Management API | **Closed from here.** No MCP tool sets a function secret, and `api.supabase.com` is behind the same 403. |
| Deploy candidate functions | `mcp__Supabase__deploy_edge_function` | **Open.** Runs through the MCP server. |
| Invoke the authenticated handlers | `execute_sql` + `pg_net` | **Open.** `pg_net 0.14.0` is installed on the project and the HTTP call is made *by the database*, outside this sandbox. Every request id is recorded in `net._http_response` and disclosed. |
| Exercise the frontend | headless Chromium | **Closed.** §1. |
| Retrieve evidence | `execute_sql`, `query_logs` | **Open.** |

## 3. What that means for the ask

The isolated environment would buy the **server half** and not the frontend
half. Specifically:

**It would close** — S5-D (the real Briefing and Snapshot condensation through
`condense-investment-report`, replacing the named stand-in), S5-G (CGR and the
financial cascade protected through a real run rather than compared on
persisted children), the server-side cases in S5-H, the fresh-generation
verification every content item is waiting on (the subject-price correction in
narrative, the composed strategy sections beside model prose, the market chart
guard firing on real output), and S5-K's ten PDFs.

**It would not close** — R1 to R11. Those need a browser that can reach the
deployment. Three ways exist and each is the owner's call rather than mine:

1. **The owner drives them**, against the branch or against production with
   the candidate build, and reports what they see. No new infrastructure.
2. **A CI job drives them** — GitHub Actions runners have ordinary egress, so
   a Playwright job on the branch can exercise the journey and upload traces,
   screenshots and a report as artefacts. This is the only route that produces
   machine-checkable evidence without a person watching, and it is a workflow
   file plus the branch's URL and an approved test login.
3. **They stay open**, declared, into S6.

Route 2 is the one I would build, because it is the only one that survives
this sandbox and produces evidence rather than assertion. It needs no
credential in this repository: the branch URL and anon key are public values,
and the test login would be a repository secret the workflow reads.

## 4. Per provider, what is actually needed

**Perplexity.** A test key is a normal API key minted by the account holder in
their own Perplexity account. I have not verified the settings URL from here
and will not assert one — the destination is the account holder's own
Perplexity API settings page. It would be set as a function secret on the
isolated project, which is the leg that is closed from this session, so it is
the owner or a CI job that sets it.

**Lovable.** `LOVABLE_API_KEY` is the AI-gateway credential Lovable provisions
into the Supabase project that a Lovable project is connected to. Verified
today: this repository's app is Lovable project
`7976d60b-c277-4851-889b-c170285f4be2` in workspace `JqcsuFgT71nlgYSNsEMB`,
and **the Lovable MCP surface available here exposes no operation that reads,
mints, rotates or copies an API key** — there is no such tool among the sixty
it offers. So the assumption that it can be copied to a second project is not
one this session can support. Two consequences:

- A Supabase **branch** is not a Lovable project, so Lovable will not
  provision a key into it.
- The condense path (`callLLMRaw` → `llmRouter` route `gateway` →
  `ai.gateway.lovable.dev`, model `google/gemini-2.5-flash` from
  `agent_model_assignments`) therefore has no credential on an isolated
  project unless one is supplied another way.

That is a real constraint on S5-D, and it is worth stating plainly before
anyone provisions anything: **the Briefing and the Snapshot are the two
outputs whose credential path a branch does not obviously reproduce.**

## 5. What was verified, and what was not

Verified today, in this session: the browser's network position (four hosts,
including `example.com`); the proxy's own policy statement; the Lovable
workspace, project and the absence of any key operation on its MCP surface;
that `pg_net` is installed on the production project and that `execute_sql`
answers.

Not verified today: `create_branch`'s two failure modes, which are carried
from a previous session and were not re-tested because a retry risks creating
a chargeable resource; the Perplexity settings URL, which is not reachable
from here and which this document therefore does not name.
