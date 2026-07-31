#!/usr/bin/env python3
"""Structural checks on the generated Finance Portal templates.

Guards the things that are easy to break silently when the builders change:
the Word files must still open, every section must still be present, and the
workbook's cross-sheet formulas must still point at the rows they describe.

    python3 scripts/finance-portal-templates/verify_templates.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from docx import Document
from docx.oxml.ns import qn
from openpyxl import load_workbook

OUT = Path(__file__).resolve().parents[2] / "public" / "templates" / "finance-portal"

DOCX_EXPECTATIONS: dict[str, list[str]] = {
    "Aurixa_Strategic_Property_Referral_Agreement.docx": [
        "DOCUMENT MAP", "BRAND & CUSTOMISATION PANEL", "PARTNER EMAIL TEMPLATE",
        "AGREEMENT DETAILS", "PURPOSE & SCOPE", "PURPOSE & SERVICES",
        "REFERRAL WORKFLOW", "COMMERCIAL SCHEDULE",
        "CLIENT CONSENT, PRIVACY & COMMUNICATIONS",
        "RELATIONSHIP PROTECTIONS & RISK ALLOCATION",
        "TERM, TERMINATION & GENERAL PROVISIONS", "EXECUTION",
        "REFERRAL REGISTRATION FORM",
    ],
    "Aurixa_Finance_Referral_and_Commission_Agreement.docx": [
        "DOCUMENT MAP", "BRAND & CUSTOMISATION PANEL", "PARTNER EMAIL TEMPLATE",
        "AGREEMENT DETAILS", "PURPOSE & PROFESSIONAL BOUNDARIES",
        "PURPOSE & FINANCE PARTNER SERVICES", "REFERRAL REQUIREMENTS",
        "COMMISSION & PAYMENT SCHEDULE",
        "COMMISSION ADMINISTRATION, CLAWBACKS & TAX",
        "COMPLIANCE, PRIVACY & RELATIONSHIP PROTECTIONS",
        "TERM, TERMINATION & GENERAL PROVISIONS", "EXECUTION",
        "CLIENT REFERRAL & CONSENT FORM",
        "LOAN WRITER / AUTHORISED REPRESENTATIVE UNDERTAKING",
        "REFERRER ENTITY & PAYMENT DETAILS",
    ],
}

XLSX_FILE = "Aurixa_White_Label_Client_Fact_Find.xlsx"
EXPECTED_SHEETS = ["Start Here", "White Label Setup", "Client Fact Find",
                   "Living Expenses", "Client Form Output", "Lists"]

#: The summary sheet must read the fact find at these rows. Each entry is
#: (summary cell, label the summary prints, fact-find row it must reference).
OUTPUT_BINDINGS = [
    ("C27", "Employer / Business", 28),
    ("C28", "Role / Position", 29),
    ("C29", "Employment Type", 27),
    ("C30", "Start Date", 31),
]

failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def all_text(document: Document) -> str:
    return "\n".join(node.text or "" for node in document.element.body.iter(qn("w:t")))


def verify_docx() -> None:
    for filename, sections in DOCX_EXPECTATIONS.items():
        path = OUT / filename
        check(path.exists(), f"{filename}: missing")
        if not path.exists():
            continue
        document = Document(path)
        text = all_text(document)
        for section in sections:
            check(section in text, f"{filename}: section '{section}' not found")
        check(document.sections[0].different_first_page_header_footer,
              f"{filename}: cover page should suppress the running header")
        check(len(document.tables) > 30,
              f"{filename}: only {len(document.tables)} tables — layout blocks missing")
        # Merge tokens must survive so find-and-replace branding still works.
        check("<<COMPANY NAME>>" in text, f"{filename}: <<COMPANY NAME>> token missing")
        check("<<INSERT>>" in text, f"{filename}: <<INSERT>> token missing")
        print(f"  ✓ {filename} — {len(sections)} sections, {len(document.tables)} tables")


def verify_xlsx() -> None:
    path = OUT / XLSX_FILE
    check(path.exists(), f"{XLSX_FILE}: missing")
    if not path.exists():
        return
    wb = load_workbook(path)
    check(wb.sheetnames == EXPECTED_SHEETS,
          f"{XLSX_FILE}: sheets are {wb.sheetnames}, expected {EXPECTED_SHEETS}")

    fact = wb["Client Fact Find"]
    output = wb["Client Form Output"]
    expenses = wb["Living Expenses"]

    # Employment labels on the fact find must sit where the summary expects.
    for cell, label, source_row in OUTPUT_BINDINGS:
        actual_label = fact[f"A{source_row}"].value
        check(actual_label == label,
              f"{XLSX_FILE}: fact find A{source_row} is '{actual_label}', expected '{label}'")
        formula = output[cell].value or ""
        check(f"C{source_row}" in str(formula),
              f"{XLSX_FILE}: summary {cell} does not read fact find row {source_row} "
              f"(got {formula!r})")

    # Income total must span exactly the five income rows.
    check("SUM('Client Fact Find'!C32:C36)" in str(output["C31"].value),
          f"{XLSX_FILE}: income total does not sum rows 32–36 (got {output['C31'].value!r})")
    for row, label in ((32, "Base Salary (Annual)"), (36, "Other Taxable Income")):
        check(fact[f"A{row}"].value == label,
              f"{XLSX_FILE}: fact find A{row} is {fact[f'A{row}'].value!r}, expected {label!r}")

    # Living-situation dropdown must be on the living-situation row, not e-mail.
    living_targets = [
        str(dv.sqref) for dv in fact.data_validations.dataValidation
        if dv.formula1 and "$E$2:$E$" in str(dv.formula1)
    ]
    joined = " ".join(living_targets)
    check("C20" in joined and "H20" in joined,
          f"{XLSX_FILE}: living-situation dropdown is on {joined or 'no row'}, expected row 20")
    check("C16" not in joined,
          f"{XLSX_FILE}: living-situation dropdown is still attached to the e-mail row")

    # The summary cover must show the tagline, never the brand hex.
    check("C8" in str(output["A4"].value),
          f"{XLSX_FILE}: summary tagline reads {output['A4'].value!r}, expected setup C8")

    # Living expenses must ship at zero across the board.
    stray = [
        f"C{row}={expenses[f'C{row}'].value}"
        for row in range(5, 55)
        if expenses[f"C{row}"].value not in (0, None)
    ]
    check(not stray, f"{XLSX_FILE}: living expenses seeded with non-zero values: {stray}")

    check("Orixa" not in str(wb["White Label Setup"]["F12"].value or ""),
          f"{XLSX_FILE}: 'Orixa' typo still present")

    for sheet in ("Client Fact Find", "Living Expenses", "Client Form Output"):
        check(wb[sheet].page_setup.fitToWidth == 1,
              f"{XLSX_FILE}: {sheet} is not set to fit one page wide")
    check(wb["Lists"].sheet_state == "hidden", f"{XLSX_FILE}: Lists sheet should be hidden")

    print(f"  ✓ {XLSX_FILE} — {len(wb.sheetnames)} sheets, bindings verified")


def main() -> int:
    print("Verifying Finance Portal templates…")
    verify_docx()
    verify_xlsx()
    if failures:
        print(f"\n{len(failures)} problem(s):")
        for failure in failures:
            print(f"  ✗ {failure}")
        return 1
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
