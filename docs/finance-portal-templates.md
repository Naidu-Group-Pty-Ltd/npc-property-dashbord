# Finance Portal templates

White-label document pack served from `public/templates/finance-portal/`. Every
file is generated from source — edit the builder and regenerate, never hand-edit
the `.docx` / `.xlsx` in the repo, or the next build will overwrite the change.

| File | Format | Purpose |
| --- | --- | --- |
| `Aurixa_Strategic_Property_Referral_Agreement.docx` | Word, A4, 12 pp | Buyer's agency issues to a finance partner. Referral relationship, commercial schedule, registration form. |
| `Aurixa_Finance_Referral_and_Commission_Agreement.docx` | Word, A4, 16 pp | Buyer's agency refers to a finance partner. Commission share, clawbacks, consent form, loan-writer undertaking, banking details. |
| `Aurixa_White_Label_Client_Fact_Find.xlsx` | Excel, 6 sheets | Client-facing intake form plus a print-ready summary. |

## Regenerating

```bash
python3 scripts/finance-portal-templates/build_all.py      # writes to public/templates/finance-portal
python3 scripts/finance-portal-templates/verify_templates.py
```

Requires `python-docx` and `openpyxl` (`pip install python-docx openpyxl`).

`verify_templates.py` is the regression net. It re-opens each artefact and
asserts that every section is present, that the merge tokens survived, and —
most importantly — that the workbook's summary sheet still reads the fact-find
rows it claims to. The first draft of the workbook drifted by three rows and
printed the start date under "Employer"; the binding check exists so that
cannot happen again silently.

## Source layout

```
scripts/finance-portal-templates/
  aurixa_brand.py     Palette, typography, layout metrics, BrandProfile
  docx_kit.py         Word primitives + visual blocks (cover, bands, grids, clauses)
  xlsx_kit.py         Excel equivalents (banners, field rows, KPI tiles, print setup)
  build_buyers_agent_agreement.py
  build_finance_referral_agreement.py
  build_client_fact_find.py
  build_all.py        Orchestrator; --out and --brand flags
  verify_templates.py Structural regression checks
  example-brand.json  Sample partner override file
```

## Design system

The documents mirror `src/styles/tokens.css` so printed collateral and the
dashboard read as one system. `aurixa_brand.py` documents the token → hex
mapping and ships `hsl_to_hex()` for re-deriving values if the tokens move.

| Role | Token | Hex | Used for |
| --- | --- | --- | --- |
| Primary | `--aurixa-obsidian` | `#251F18` | Cover panel, section bands, table headers, footers |
| Accent | `--brand` | `#D9A520` | Section numbers, rules, chips, field underlines |
| Accent deep / dark | `--brand-700` / `--brand-900` | `#A98019` / `#7C5E13` | Small caps labels, guidance headings |
| Accent tint / pale | `--brand-100` / `--brand-light` | `#F8EED3` / `#FCF5E3` | Guidance cards, total rows |
| Ink | `--foreground` | `#312A21` | Body copy |
| Ink soft / faint | `--muted-foreground` | `#6E6253` / `#9A8D7C` | Captions, placeholder text |
| Surfaces | `--card` / `--background` / `--muted` | `#FFFDFA` / `#FAF7EF` / `#F2EBDE` | Panels, zebra rows, label cells |
| Field | — | `#FFFBEE` | Every cell a user is meant to fill in |
| Success / Info / Alert | `--success` / `--info` / `--destructive` | `#21C45D` / `#0284C5` / `#C2410C` | Semantic callouts |

**Semantic colours are fixed.** Green means confirmed, blue means informational,
red means legal caution. They stay put when a partner re-skins the pack, so a
warning never stops looking like a warning.

Typography is Georgia for display (cover, section numbers, clause headings) and
Calibri for body, labels and tables. Both ship with Office on Windows and macOS
and substitute predictably elsewhere, so pagination holds on any machine that
opens the file. Change them in one place: `Typography` in `aurixa_brand.py`.

## White-labelling

Three routes, in increasing order of automation.

### 1. Find and replace (no tooling)

Every partner-specific value is a `<<TOKEN>>`. Open the document, press
`Ctrl+H` / `Cmd+H`, replace each token once. The **Brand & Customisation Panel**
page inside each document lists every token and where it appears.

| Token | Appears in |
| --- | --- |
| `<<COMPANY NAME>>` | Cover, running header, e-mail sign-off, contact strip |
| `<<TRADING NAME>>` | Agreement details grid |
| `<<PHONE>>` `<<EMAIL>>` `<<WEBSITE>>` `<<BUSINESS ADDRESS>>` | Cover contact strip, e-mail sign-off |
| `<<DATE>>` | Cover metadata, agreement details, forms |
| `<<STATE OR TERRITORY>>` | Agreement details, governing-law clause |
| `<<DISCLAIMER>>` | Page footer |
| `<<INSERT>>` | Every blank field cell |
| `<<NUMBER>>` `<<TIMEFRAME>>` `<<INSERT %>>` | Negotiated terms in the schedules |
| `<<RECIPIENT ORGANISATION>>` `<<SENDER NAME>>` `<<TITLE>>` `<<REF>>` | Cover issue-control strip and e-mail template |

Replace the dashed **`[ INSERT PARTNER LOGO ]`** box on the cover with the
partner's mark, keeping it inside the box so the cover grid stays aligned.

### 2. Pre-branded build

```bash
python3 scripts/finance-portal-templates/build_all.py \
  --brand scripts/finance-portal-templates/example-brand.json \
  --out /tmp/northbridge
```

The JSON accepts any subset of `BrandProfile` fields — see
`example-brand.json`. `primary` and `accent` re-skin every band, chip, rule and
underline in one pass; `platform_note: ""` removes the Aurixa footer
attribution for a fully unbranded partner copy.

### 3. Platform generation

The Finance Portal's branding settings (`whitelabel_settings`, see
[`WHITE_LABEL_TOKEN_CONTRACT.md`](./WHITE_LABEL_TOKEN_CONTRACT.md)) map onto
`BrandProfile` one-to-one: `primary_color` → `primary`, the brand accent →
`accent`, logo slots → the cover logo box. Build a profile from the tenant's
settings and call `build_all.main()` with it.

## Document anatomy

Both agreements use the same block vocabulary, so a reader who learns one knows
the other:

- **Cover panel** — obsidian, gold-ruled, logo slot, title, status chips,
  version/date metadata, then the legal caveat band and an issue-control strip.
  No running header on page 1.
- **Document map** — contents table keyed to the section numbers.
- **Brand & customisation panel** — the white-label control sheet. Marked
  *delete before issue*.
- **Section band** — gold number chip + obsidian title bar. Opens every section.
- **Guidance card** — pale gold, heavy gold left rule. Advisory, removable.
- **Note card** — closing principle for a section; tone carries the meaning
  (brand / info / success / alert).
- **Field grid** — sand label cell, pale-gold input cell with a gold underline.
  `Tab` moves between cells, which is what makes the documents completable
  on screen without content controls.
- **Clause block** — obsidian left rule, serif heading, hanging-indent
  sub-clauses with gold numbers.
- **Workflow ladder** — numbered stage rows (referral workflow).
- **Signature panel** — gold top rule, ruled signature lines, side-by-side.

Section bands are set `keepNext`, and every table row is `cantSplit`, so a
heading never lands alone at the foot of a page and a field row never breaks
across pages.

## Workbook structure

| Sheet | Contents |
| --- | --- |
| `Start Here` | Tab guide, completion checklist, data-handling note |
| `White Label Setup` | Organisation identity + document settings; every other sheet reads from it |
| `Client Fact Find` | Two applicants: personal, address history, employment & income, assets, other liabilities |
| `Living Expenses` | 50 expense lines with an auto-calculated annual column and a category roll-up |
| `Client Form Output` | Print-ready summary: KPI tiles, personal, employment, position roll-up, declaration |
| `Lists` | Hidden. Drives every dropdown; edit here to change the options |

Row anchors are constants in `build_client_fact_find.py` (`ASSET_FIRST`,
`INCOME_FIRST`, …) and the summary sheet is generated from the same constants,
so the two can no longer disagree.

Conventions:

- **Pale gold cells are inputs**; grey cells are calculated. Nothing calculated
  is ever an input.
- Blank inputs print blank — every pass-through is wrapped in
  `IF(ref="","",ref)` so an unfilled field does not render as `0` or 30/12/1899.
- Required fields (surname, first name, organisation name) tint amber while
  empty.
- A negative net position renders in red.
- Every sheet is A4, fit-to-one-page-wide, with repeated header rows and a
  branded print header/footer, so `File → Export → PDF` is print-ready as is.
- Input cells are unlocked and calculated cells are locked, so
  `Review → Protect Sheet` gives tab-through data entry immediately. Protection
  is left off by default.

## Defects corrected from the first draft

Carried over from the initial ChatGPT-generated workbook and fixed here:

| Defect | Effect | Fix |
| --- | --- | --- |
| Summary read the employment block three rows low | "Employer" printed the start date, "Role" printed the base salary, "Employment Type" printed the employer address, "Start Date" printed the commission | Bound to named row constants; asserted by `verify_templates.py` |
| Income total summed `C35:C39` | Missed base salary, bonus and commission; included the assets header row | Sums `C32:C36`, the five income rows |
| Living-situation dropdown attached to row 16 | Dropdown sat on the e-mail field; living situation had none | Moved to row 20 |
| Summary cover printed `'White Label Setup'!B8` | Displayed the hex string `#12345B` where the tagline belonged | Reads the tagline cell |
| `Living Expenses` shipped with `600` in Registration | A blank template arrived pre-populated with one arbitrary figure | All lines seeded at zero |
| Setup sheet said "Orixa" | Platform misspelled in the client-facing note | Corrected to Aurixa |
| Clause 7 heading read "Reciept Created Tax Invoices" | Misspelling in an executed legal document | Corrected to "Recipient Created Tax Invoices" |

## Content scope

The legal and commercial wording is carried over from the source templates
unchanged apart from the two spelling corrections above. The additions are
structural — document map, brand panel, activation checklists, completion
guidance, totals rows and the category roll-up. Nothing in the operative clauses
or the commercial schedules was rewritten.

These remain templates. They still require legal, licensing, privacy and
aggregator review before use, as the cover of each document states.
