# A clone's documents are its own

NPC's identity — its artwork, its name and tagline, its contact details and
its wording — belongs to the prime. On the prime, every document is drawn
exactly as it always was. A clone issues the same documents, with the same
content and the same delivery, under its own template.

The owner set the rule on 26 Sep 2026. These four points, in the owner's
words, are what the work answers to:

- NPC's artwork on the older documents should be *"a legacy, which will be
  deprecated and hidden on the clone and only available on the prime"*.
- *"I do not want any changes of the content and how the reports are being
  pushed, just the template"* — whereas *"everything from a white labeling
  component needs to be put through for the clone"*.
- Each tenant's own brand colour, and *"if they don't have any branding or
  logos, it falls back through to the Aurixa's default reporting branding"*.
- *"the Disclaimer that might be hardcoded as NPC Services or Naidu property
  consulting services"* is part of the artwork too.

Read this before touching `issuerIdentity.pure.ts`, `legacyDocumentBrand.ts`,
`legacyIssuerCover.ts`, `brandFamily.pure.ts`, `snapshot.pure.ts`
(`buildReportBrandSnapshot`, `issuerDisclaimerSetting`),
`organisationProjection.pure.ts`, `comparisonContactSection.pure.ts`, or any
PDF generator that draws a cover, a closing page or a contact block.

## 1. The deployment decides, never a name

A clone's settings rows can still hold the house's values — a seeded copy, a
restored backup, a disclaimer pasted across. So the prime is recognised by the
backend it talks to, never by a name a row can hold:

- in the browser, `isPrimeDeployment()` (`src/lib/primeDeployment.ts`);
- in an Edge Function, `deploymentKind(SUPABASE_URL)`.

Both fail closed: anything that is not the prime is a clone.

**What the prime's own build answers.** The browser reads the project ref from
`VITE_SUPABASE_URL`. The prime's Lovable `.env`, when it was last committed
(July 2026), set it to the project's own `https://dduzbchuswwbefdunfct.supabase.co`,
and the built-in fallback is the same URL, so the prime reads as the prime. One
configuration would break this: pointing the prime's build at a custom domain
for its Supabase API. The ref would then not parse, and every legacy document
would switch to the issuer's template. The same predicate already decides the
internal tooling pages and the Turnstile pairing, so a change like that would
show up there too.

**On the prime nothing is read that was not read before, and nothing is
withheld.** The prime's settings are its own. If the prime has been renamed on
its Branding or Report Settings page, it issues as that name, just as it always
did. Every `legacyDocumentBrand` loader takes the settings read as a thunk, so
the prime never makes a query it did not make before.

**On a clone the issuer is resolved once** (`resolveReportIssuer`): the report
contact's company name, then the Branding page's name, then Aurixa Systems. The
house trading under any variation of its name is passed over like a placeholder
(`isHouseTradingName`), so a clone never issues as NPC. This covers "NPC
Services Melbourne", "Naidu Property Consulting Services Group" and
`www.npcservices.com.au`. A stranger who shares the initials, such as "NPC
Realty", is not passed over.

## 2. What a clone never prints

| The house's… | Where it was | On a clone |
|---|---|---|
| Cover artwork | `npc_template.pdf`, `npc-cashflow-cover.jpg`, `npc_house_cover_art`, the cover editor's default background | The issuer's cover (`drawLegacyIssuerCover`, `investmentPdfCover.ts`): the mark, the name in tracked serif capitals, the title, the subject and a one-line standfirst, in the issuer's colours |
| Name and tagline | Closing pages, running feet, "Source: NPC projections", and the `# BRAND` / YOUR DEDICATED PROPERTY PARTNER masthead the generators write | The issuer's name. The tagline is left out (`investmentReportMasthead`, `withoutHouseMasthead`) |
| Contact details | Closing pages, the typeset letterhead, `org.*`, the Q&A letterhead, the comparison prompt's closing block | Left out. See the rule below |
| Wording | A stored disclaimer naming the house | The workspace default under the clone's own name, or the platform's statement under Aurixa Systems (`resolveReportDisclaimer`, `issuerDisclaimerSetting`) |

**The contact rule has two halves, and the second is what makes it hold.**

- A field that names the house is left out. That covers its mailbox and its
  website.
- Every field of a row that is the house's own is left out too
  (`isHouseContactRow`: the row's own company name is the house's).

The house's phone line, its office address and its ABN are digits and a street.
They name nobody, so no reading of the value can recognise them.

When a seeded row was first rendered, it printed NPC's landline, office and ABN
under "Aurixa Systems". Only the mailbox and website had been withheld. A
document that says less is recoverable: the clone sets its own company name and
its details print. A document that names another business's ABN is not
recoverable. The Report Settings, white-label and brand-config sources each
apply the same rule, per source (`organisationProjection.pure.ts` judges each
field by the row that supplied it).

## 3. Which surfaces, and where each one decides

| Document | Decided in | Prime | Clone |
|---|---|---|---|
| Standard Investment presentation (pdf-lib) | `standardPresentationBrand.ts`, `investmentPdfCover.ts`, `investmentPdfIssuerPage.ts` | NPC artwork | Issuer cover, brand family, issuer closing page |
| Borrowing Capacity Snapshot (jsPDF) | `BorrowingCapacityPDFReport.tsx` + `borrowingCapacityPdfSections.ts` | Unchanged | Issuer cover, palette, closing page |
| Strategy Rationale brief | `StrategyRationalePDF.ts` | Unchanged | Same |
| Cash Flow legacy export | `CashFlowAnalysisModal.tsx` | Unchanged | Same |
| Portfolio analysis (pdf-lib) | `PortfolioAnalysisPDFGenerator.tsx` + `borrowingCapacityPdfLibSections.ts` | Unchanged | Same |
| Formara client form | `FormaraPDFGenerator.tsx` | Unchanged | Same |
| Report Q&A editors | `ConversationReportEditor.tsx`, `MessageReportEditor.tsx` | Unchanged | Same |
| Market Intelligence (jsPDF) | `MarketIntelligencePDFGenerator.ts` | Unchanged | Issuer palette; the Why/Contact boxes only where a business is named |
| Overview snapshot | `OverviewSnapshotPDF.ts` | Unchanged | Issuer palette and closing page |
| Cover editor preview | `cover-editor/types.ts` (`defaultCoverBackground`) | NPC cover | No house artwork |
| The ten typeset routes (WeasyPrint) | `buildReportBrandSnapshot` + `issuerDisclaimerSetting` | Unchanged | House names and house rows left out |
| `org.*` bound by a chosen template | `applyOrganisationProjection(…, deployment)` | Unchanged | Issuer's name, house rows left out |
| The Q&A PDF the server emails | `documentLetterhead` (`report-qa`) | Unchanged | Issuer's name, house line left out |
| Formatted comparison — closing block the model is told to write | `comparisonContactSection` | The block it always carried, verbatim | The clone's own details, or no section where nobody can be contacted |
| Legacy Investment HTML route (no current caller) | `render-investment-report-pdf` | Unchanged | No house artwork; issuer's name, contact and disclaimer; "Source: <issuer> projections" |
| The narrative masthead the generators write | `investmentReportMasthead` | The block it always wrote | Issuer's name, no tagline |
| The report viewer | `withoutHouseMasthead` | Unchanged | Tagline and a heading naming the house left out of the opening block |

The typeset routes never fetch a logo from outside their own project's storage
(`fetchBrandAssets.ts`). A logo URL copied from the prime's rows is therefore
refused on a clone, before this work and still.

**An issuer's cover keeps its typography.** The covers and running heads drawn
for an issuer set their text through `winAnsiTypographic`. It keeps what
WinAnsi carries (the en and em dash, the curly quotes, the bullet, the
ellipsis) and maps or drops only what the standard fonts cannot encode. The
first clone render set the Strategy Rationale's "Scenario — Finance Hand-off"
with a hyphen, because the shared `winAnsiSafe` flattens every dash to ASCII.
That function still draws the prime's own artwork cover, unchanged.

## 4. The brand family — "additional colours as part of the variations"

The drawn documents were composed around NPC's house pair: a gold and a navy,
plus a set of washes. One tenant colour cannot stand in for all of those roles.
Poured into the navy's place, a light brand makes every heading unreadable.
Poured into the washes, it floods them.

So `resolveBrandFamily` expands the brand colour into the roles a drawn
document needs:

- `accent`
- `accentInk` — type on paper, 7:1
- `accentOnField` — type and rules on the dark field, 7:1
- `deep` — the brand's own hue darkened for headings and table heads, 10:1
- `onDeep`
- `wash` and `stripe` — pale tints for callouts and alternate rows
- `hairline`

The semantic reds and greens, the dark field and the inks stay the palette's.
A tenant cannot make risk green.

- **No brand colour:** the family is Aurixa's platform gold on obsidian,
  matching every design-system document an unbranded deployment prints.
- **Where the colour comes from:** `whitelabelBrandColour`, which reads
  `theme_config.brandColour` and falls back to `primary_color`. This is the
  same reading the typeset routes use.
- **Portfolio and Formara grow their gold ramp from the same colour**
  (`highlightColourFor`, 26 Sep 2026). Both documents grow a ramp — the
  highlight, a lighter and a deeper shade, and a pale tint — from ONE colour
  (`getBrandPdfPalette`). It used to be the app's accent everywhere, so on a
  clone the highlights followed the app's accent while the deep shade, the
  cover and the closing page followed the Branding page: one document, two
  brand colours. On a clone the ramp now grows from the family's own source
  (the Branding page's colour, or Aurixa's gold where none is set). Only the
  source changes; the ramp is grown exactly as before. On the prime it is still
  the app's accent, applied with the same value before anything is drawn.

## 5. What does not change

- **Content.** Every figure, sentence, section and table is the same on the
  prime and on every clone. Rendered page counts are equal across the prime and
  all three clone modes for every document measured.
- **Delivery.** Exits, storage objects and the portal are untouched.
- **The model's persona follows the issuer (§9).** This bullet used to read
  "not changed": the owner then asked for it as a commercial-readiness item.
  On the prime every prompt is byte-identical to what it was.

## 6. Verified

- **The prime is object-identical to the pre-work tree for the jsPDF
  documents.** Borrowing Capacity, Strategy Rationale, Market Intelligence and
  Overview were rendered from the same fixtures on `c27bdc60a` and on this
  change, then compared object by object (streams decoded, timestamps
  normalised): all four IDENTICAL. The comparator does see a change: prime
  against a clone render differs in 64 to 2,348 objects.
- **The standard presentation was already compared the same way** when its
  cover became the issuer's (`PROPERTY_PHOTOGRAPHS.md` §10).
- **Clone renders were inspected page by page** in three modes: own brand with
  a mark and a teal colour, rows seeded from the prime, and nothing configured.
  Each showed the issuer's cover, palette and closing page; Aurixa Systems with
  the platform's statement where no business is named; and no NPC name, contact
  value or wording.
- **The component generators, audited hunk by hunk.** Cash Flow, Portfolio,
  Formara, the two Q&A editors and the two borrowing-capacity section modules
  were each diffed against `c27bdc60a` by a separate review pass. Every hunk
  runs only on a clone, reproduces the original value exactly, or is a type or
  comment. None changes what the prime draws. The review rests on one
  precondition: `loadLegacyDocumentBrand` answers "house" before it reads
  anything, so the settings reads added for clones never run on the prime.
  The two section modules were also byte-compared against the baseline for
  three datasets each, and both matched: the jsPDF module with a fixed date
  and file id, and the pdf-lib module. Passing the pdf-lib module a clone
  palette changed its output, which shows the comparison can detect a
  difference.
- **Unit tests:** `houseIdentity.spec.ts`, `cloneServerIdentity.spec.ts`,
  `legacyDocumentBrand.spec.ts` and `brandFamily.spec.ts` hold both halves of
  every rule — the prime reads as stored, a clone withholds.

## 7. Not verified — PENDING

- **Cash Flow, Portfolio, Formara and the two Q&A editors were not rendered
  whole.** Their generators live inside React components; the Cash Flow modal
  alone is 6,000 lines that no unit harness mounts. Their prime path was
  audited instead (§6). PENDING a browser render of each, prime and clone.
- **The prime's live bundle was not read.** Its domain answers a Cloudflare
  challenge, which this work does not get past. PENDING a check after publish
  that the prime still prints NPC's artwork on each legacy document.
- **No real clone has drawn any of these documents.** PENDING a clone deploy.
- **The white-label Edge Function changes are deployed.** #2775 merged on
  26 Sep 2026 and all eighteen functions it changed were redeployed between
  03:24 and 03:35 UTC. The follow-up (§9–§11) is PENDING merge and deploy,
  which need the owner's approval.

## 8. The uploaded PDF's words (a separate fix, same change)

The report form's PDF path read `data.pdfContent` from `parse-property-pdf`, a
field that function has never returned. It reads pages as images and answers
fields. So a report made from an uploaded brochure was written as though the
document had no words in it.

The browser now reads the text layer (`readUploadedDocumentText`) and bounds it
(`uploadedDocumentText.pure.ts`):

- **The front of the document, never its end.** A brochure ends on the
  builder's other estates.
- **8,000 characters**, cut at a paragraph.
- **Nothing from a scan.**

The generator bounds an uploaded document from its front
(`UPLOADED_DOCUMENT_MAX_BYTES`, `head`). A listing page is still cut as before.
Every section now reads the words, not only the first invocation's (§10).

## 9. Who the writer works for

Every report writer opens its prompt with a persona: "You are an expert
Australian property investment analyst for `<company>`", "a trusted property
investment advisor at `<company>`". Every one took `<company>` from Report
Settings (`getBrandConfig`). On a clone whose row was seeded from the prime's,
the model was told it worked for NPC. Market Intelligence then printed that
name in the document itself: a heading "How `<company>` Would Approach This",
"`<company>` is a strategic property advisory", and its call to action. A clone
that had named nobody got the placeholder "Property Consulting".

The writer now works for the business the document is issued under
(`writerFirm.pure.ts`, read at the edge by `writerIdentity.ts`):

- **On the prime nothing changes.** The writer is told exactly the name it was
  always told, and nothing new is read. Proven by running main's and this
  change's Market Intelligence prompt builders under Deno with the prime's name
  (26,831 bytes each, byte-identical across four builders and three report
  types), and by substituting the prime's name into the old and new sources of
  the other writers, where only the lines that compute the name differ.
- **On a clone the writer works for the clone's own business:** its report
  contact name, then its Branding page name (`resolveReportIssuer`). Never the
  house, however a row spells it.
- **Where a clone has named nobody, the writer works for no business.** The
  document is then issued under the platform, and the platform's disclaimer,
  printed on that same document, says the analysis was not prepared by Aurixa
  Systems and that Aurixa Systems is not a buyer's agent. A persona "advisor at
  Aurixa Systems" would have the prose say the opposite. So every persona drops
  its "for `<company>`" clause instead: "You are an expert Australian property
  investment analyst." A prompt-library template has the firm taken out the way
  each sentence can lose it (`withoutFirmToken`), and every built-in template
  is held to reading cleanly by a test that reads the catalogue's own source.

It covers the five report writers (`generate-investment-report`,
`regenerate-report-qualitative`, `condense-investment-report`, `report-qa`,
`generate-market-intelligence-report`), the masthead the Investment generators
write, and the template AI author, whose cover designs were told they were "for
NPC Property Services investment reports". Q&A's summary no longer asks the
model to print "Prepared by: `<company>`" where the platform issues it.

**The typeset Market Intelligence close had the same fault.** It printed "Why
`<issuer>`? `<issuer>` is a strategic property advisory …" and "Contact
`<issuer>` …" on every document, so an unbranded clone's read "Aurixa Systems
is a strategic property advisory" above a disclaimer saying the opposite. The
older browser generator already left that close out for the platform. The
typeset route now does too (`brandCloseCallouts`), and its page budget counts
the callouts it actually prints, so no empty "Your Next Steps" chapter is drawn.

**Not changed, and the same class:** `email-copilot` drafts replies signed
"`<company>` Team", and `ai-dashboard-agent` and `user-guide-assistant` name the
company in their personas. All three read Report Settings. They are not report
writers, and a drafted email belongs to the email identity
(`CLONE_EMAIL_IDENTITY.md`), not the report issuer. `market-updates-qa` still
calls itself "the NPC Australian property-market intelligence analyst" on every
deployment.

## 10. The document's words, for every section

A report made from an uploaded brochure or a listing link carries the
document's words into its prompt. Only the first invocation of a generation
receives them: they arrive in `propertyDetails`, and a continuation — every
invocation after the first — is sent `{ reportId, propertyAddress,
continueFrom }`. A Compass is written across several invocations, so the first
batch of sections was written from the brochure and every later one as though
there had been no document.

The first invocation now keeps the context it composed, and every later
invocation handed no document of its own reads it back
(`reportDocumentContext.pure.ts`). The stored copy holds the words (already
bounded), the extracted specifications and where the words came from.

- **It lives in the private `listing-images` bucket**, at
  `report-sources/<reportId>/document.json`, beside the report's photographs
  but under its own prefix. No migration, and nothing that lists a photograph
  folder sees it.
- **A kept copy stands in only for the same report at the same address.** A
  document about another property is worse than none.
- **Only a record this module wrote is read.** Anything malformed, of another
  version or larger than anything written here is ignored.
- **Keeping and reading never fail a report.** Both give up after five
  seconds, and a copy that cannot be kept costs the later sections the
  document, which is what they had before.
- **A continuation composes exactly what the first invocation composed.** The
  prompt section is built from the kept fields alone (a test holds the block
  to reading nothing from the request). Main's inline code and the new block
  were evaluated on the same inputs, and the section is byte-identical, for an
  uploaded PDF and for listings with and without a URL, with the new side fed a
  record that has been through JSON.

A regeneration of the same report without a document reads the kept copy too,
so it is written from the same evidence as the first generation.

Two things it does not do:

- **Deleting a report does not delete it.** `manage-investment-reports`
  deletes the row and nothing in storage. The report's photographs have
  always stayed behind, and the kept document now stays beside them.
- **It cannot keep what has no bucket.** `listing-images` is created by a
  migration, and rows a migration inserts do not always reach a clone
  (`CLONE_PROVISIONING_GAPS.md`). Where the bucket is missing, the log says
  `NOT kept` and the report is written exactly as it was before this change.

## 11. Verified and not verified (the follow-up)

- Unit tests: `writerFirm.spec.ts`, `reportDocumentContext.spec.ts`,
  `legacyDocumentBrand.spec.ts` (the highlight ramp), and the Market
  Intelligence `render` and `sections` specs. Three standing guards now pin
  the change too. `compassDocumentContract.spec.ts` pins the contract's new
  argument. The Investment single-source guard requires the new module's
  bridge. The Market Intelligence guard keeps its import allow-list closed:
  the close compares against `FALLBACK_COMPANY_NAME`, the name the masthead
  itself falls back to, which lives in the design system it may import.
- Each rule was broken on purpose, one at a time, and the spec that holds it
  failed every time.
- **PENDING:** a real clone generating a report with the new persona, and a
  real brochure report written across several invocations. Both need the
  functions deployed and spend model calls.
- **PENDING:** a browser render of Portfolio and Formara on a clone. The change
  is one argument, and the prime path passes the same value it always did.
