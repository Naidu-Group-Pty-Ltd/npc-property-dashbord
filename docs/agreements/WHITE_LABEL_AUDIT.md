# Agreement documents — white-label audit

This product is sold to other agencies. Every name, ABN, email, phone and mark
on a generated agreement must come from **that deployment's** settings. This
records a line-by-line audit of the whole agreement path, what it found, and
the tests that now hold the line.

## Where identity actually comes from

One resolver, `loadIssuerDefaults` in `_shared/agreements/render.ts`:

| Document element | Field | Source |
|---|---|---|
| Cover wordmark, running header, email sign-off | `company_name` | `whitelabel_settings.theme_config.tradingName` → `contact_details.tradingName` → `whitelabel_settings.company_name` |
| `BETWEEN …` on the cover, Agreement Details, execution block | `ba_legal_name` | `contact_details.name` → `whitelabel_settings.company_name`, overridden by the register's `principal_legal_name` |
| `ABN / ACN` | `ba_abn_acn` | `contact_details.abn` |
| Address, email, phone, website | `ba_address`, `company_email`, … | `contact_details.*` |
| Cover mark | — | the tenant's report logo, fetched at download time |

It has no fallback of its own: an unset value resolves to `null`, and
`substitutePlain` then prints the field's own `<<INSERT>>` bracket. That is the
correct white-label behaviour — a template should show a blank to fill in, not
somebody else's company.

## What the audit found

**Nothing in the code.** No tenant literal exists in `_shared/agreements/`,
`manage-partner-agreements`, `agreement-centre-render`,
`finance-portal-agreements`, the DOCX builder or the theme. The only `NPC`
strings in the wider render chain are comments in `reportDesign/` explaining
why a hardcoded `"NPC · Investment Intelligence"` was removed from the page
furniture years ago.

**Three leaks, all database column defaults** — the one place a code audit does
not look, and none of them visible in any source file:

| Column | Was | Consequence on another tenant's deployment |
|---|---|---|
| `partner_agreements.principal_legal_name` | `'NPC Services Pty Ltd'` | **Names the wrong company as a party.** This column is behind `ba_legal_name`, which prints on the cover particulars, the Agreement Details grid and the execution block. |
| `whitelabel_settings.company_name` | `'NPC Property'` | A workspace that had not yet saved its branding issues agreements masthead "NPC Property". |
| `whitelabel_settings.email_signature_name` | `'NPC Property Services'` | Same class, in outbound mail. |

The first is the serious one, and the reason it is worth a document: the
resulting agreement is *correctly branded everywhere else*. The logo, the
header, the sign-off and the colour are all the new tenant's. One line names
somebody else's company as a contracting party, on a page nobody re-reads.

Fixed in `supabase/migrations/20260901001200_agreement_white_label_defaults.sql`
by defaulting all three to empty string. Existing rows are untouched — a
`DEFAULT` change only affects future inserts.

## What holds the line now

`src/lib/agreements/__tests__/agreementWhiteLabel.spec.ts` (17 tests):

- every module that composes an agreement is scanned for the founding tenant's
  identity in any form — including in comments, because a literal in a comment
  today is a literal in code after the next careless edit;
- the locked content of both templates is scanned the same way;
- **an unbranded build must invent no issuer** — given no brand at all, the
  generated `.docx` must contain no tenant string and must print `<<INSERT>>`;
- and the converse: a configured brand must actually reach the document.

## Checking a deployment

```sql
-- Any column default naming a company is a leak waiting to happen.
SELECT table_name, column_name, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_default IS NOT NULL
  AND column_default ~* '(pty ltd|services|property|group)';
```

Then download both templates from **Agreements → Templates** on a workspace
with empty branding. Every party field should read `<<INSERT>>`. Any company
name that appears is coming from somewhere it should not.
