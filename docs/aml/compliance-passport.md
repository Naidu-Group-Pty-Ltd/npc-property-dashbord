# Compliance Passport — one AML/CTF process, every portal

Implements the cross-portal flow in the owner's diagram: the Command Centre is
the single source of truth; a verified client's completed compliance is pushed
to the Client, Finance, Builder, Developer and Solicitor/Conveyancer portals;
and a partner organisation that wants its own assessment makes it **inside the
system**, against internally-transferred records — never by re-approaching the
client.

## Legal model

The mechanism is the AML/CTF Act 2006 (Cth) **Part 2 Division 7 (ss 37A–38)**:
a reporting entity may rely on the applicable customer identification
procedure carried out by another reporting entity, under a **written customer
due diligence arrangement** that is **regularly reviewed** — and the relying
entity **remains responsible for its own compliance**. All three statutory
conditions are enforced in code, not policy:

| Condition | Enforcement |
|---|---|
| Written arrangement | `agreement_reference` is NOT NULL; `create_agreement` refuses without it |
| Regular review | `next_review_due` NOT NULL; an overdue review **blocks new grants** (`review_overdue`) |
| Relying entity stays responsible | The independent-assessment path exists, and a partner's determination **never** writes to our case or service gate |

## The passport

An **attestation** is a versioned, SHA-256-addressed, sanitised snapshot of
*what procedures were performed*: parties verified (method, date, document
sighted, certifier capacity), consents held, screening performed with list
freshness, and a service-readiness boolean derived only from an explicitly
approved gate (same rule as the finance contract). It carries its own
`limitations` (no DVS; heuristic liveness) so honesty travels with it.

**Never in the payload:** risk rating or score, screening match content,
reviewer notes, MLRO commentary. A relying partner has no entitlement to our
investigation, and s 123 (tipping off) forbids sharing parts of it regardless.
A contract test pins the exclusion list. MLRO-only, and it refuses to issue
when no party is verified (`nothing_to_attest`).

## The flow

1. **Arrangement** (MLRO): record the written CDD agreement per partner.
2. **Client consent**: new optional `compliance_sharing` consent (APP 6.1(a)),
   published into catalogue v2026.2 so no existing client is re-asked.
   Declining costs the client nothing with us — the partner approaches them
   directly instead. The portal records optional consents **only when ticked**.
3. **Attestation** (MLRO): issue; hash-chained case event written.
4. **Grant** (MLRO): case + agreement → a bearer token, shown once, stored as
   a hash, 90-day expiry, revocable with a reason. Requires the consent
   (traceably — `consent_id` NOT NULL on the grant), an active agreement, a
   current review, and an attestation.
5. **Partner redeems** (`redeem_attestation`): gets the payload + the
   statutory notice that they remain responsible. Every access logged.
6. **Independent assessment** (`record_independent_assessment`): the partner's
   own determination — satisfied / not satisfied / records requested — pinned
   to the attestation's content hash and written to the case timeline. Their
   compliance is theirs; ours is ours; the link is evidence, not authority.

## Surfaces

- `supabase/functions/aml-reliance/` — staff ops (verifyAuth, MLRO-gated
  outward acts) + partner token ops (finance-handoff pattern).
- `src/components/aml/ReliancePassportSection.tsx` — case-workspace panel:
  arrangements, issue, grant, partner assessments at a glance.
- `scripts`/schema: `20260729090000_aml_reliance_passport.sql` (applied live).

## Commercialisation note

This is the module boundary for selling Command-Centre access: a partner
organisation's portal integration needs exactly one credential (the grant
token) and one endpoint, receives only the sanitised passport, and gets its
own compliance record out of it. Per-partner scoping, expiry, revocation and
a full access log are already the billing/entitlement seams.
