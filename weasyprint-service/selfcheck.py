#!/usr/bin/env python3
"""Prove the engine, its native libraries and the brand faces work together.

Run at build time — the last layer of the runtime stage — and runnable at any
time afterwards against a deployed image:

    docker run --rm --entrypoint python weasyprint-service selfcheck.py

## Why a render and not an import

An import proves the wheels installed. It does not prove Pango is present, that
fontconfig can see `/usr/local/share/fonts/npc`, or that the faces the
stylesheet names resolve to anything — and each of those fails *silently*:
WeasyPrint substitutes a missing family without so much as a log line, so the
PDF renders, every test downstream passes, and the defect is visible only to
whoever opens the document.

This also caught its own first version. The check began life in the **builder**
stage, which installs a compiler and no Pango: WeasyPrint loads its native
libraries at import time, so `import weasyprint` failed there and the image
could not be built at all. The check belongs where the libraries are.

## What it asserts

1. The engine is the pinned version, and imports.
2. A render produces PDF bytes.
3. `pdf_tags` writes a structure tree — the option that produces `/StructTreeRoot`
   does not exist before WeasyPrint 63, and the service spent its life passing
   something the engine ignored, so every report it made was untagged.
4. Every brand family the stylesheet names is embedded in the output, by name.
   Rendered uncompressed for this: a compressed PDF hides its font descriptors
   inside object streams, where a byte search finds nothing.
5. The engine still drops what `engineSupport.pure.ts` says it drops. A capability
   that quietly changes is a stylesheet that quietly stops being true.
"""
from __future__ import annotations

import logging
import sys

from weasyprint import HTML

# Mirrors `BRAND_FAMILIES` in app.py and the `PRINT_STACK` roles it comes from.
BRAND_FAMILIES = ("Cinzel", "Playfair Display", "Inter", "IBM Plex Mono")

# One construct per class, so a warning names the declaration it came from.
# Mirrors the ids in `reportDesign/engineSupport.pure.ts`.
MUST_DROP = {
    "box-shadow": "box-shadow: 0 1pt 2pt currentColor",
    "position-sticky": "position: sticky",
}
MUST_RENDER = {
    "grid": "display: grid",
    "linear-gradient": "background: linear-gradient(currentColor, transparent)",
}


def _specimen() -> str:
    rules = "\n".join(
        f".d{i} {{ {decl}; }}" for i, decl in enumerate([*MUST_DROP.values(), *MUST_RENDER.values()])
    )
    body = "".join(
        f'<p style="font-family:\'{family}\'">{family} 0123</p>' for family in BRAND_FAMILIES
    )
    return (
        f'<html lang="en"><head><title>self check</title><style>{rules}</style></head>'
        f"<body><h1>Self check</h1>{body}</body></html>"
    )


def main() -> int:
    import weasyprint

    print(f"weasyprint {weasyprint.__version__}")

    said: list[str] = []

    class Collect(logging.Handler):
        def emit(self, record):
            said.append(record.getMessage())

    engine_log = logging.getLogger("weasyprint")
    engine_log.addHandler(Collect())
    engine_log.setLevel(logging.WARNING)

    pdf = HTML(string=_specimen()).write_pdf(pdf_tags=True, uncompressed_pdf=True)
    failures: list[str] = []

    if not pdf.startswith(b"%PDF-"):
        failures.append("the render did not produce PDF bytes")
    if b"/StructTreeRoot" not in pdf:
        failures.append("pdf_tags produced no structure tree — this engine cannot tag output")

    for family in BRAND_FAMILIES:
        # The family name travels in the font descriptor. A substituted face
        # leaves a perfectly valid PDF with somebody else's name in it.
        if family.replace(" ", "").encode() not in pdf.replace(b" ", b""):
            failures.append(f"{family} is not embedded — the engine substituted it silently")

    ignored = "\n".join(said)
    for name, decl in MUST_DROP.items():
        if decl not in ignored:
            failures.append(f"{name} is no longer dropped — move it out of UNSUPPORTED")
    for name, decl in MUST_RENDER.items():
        if decl in ignored:
            failures.append(f"{name} is load-bearing and this engine drops it")

    if failures:
        print("\nFAILED:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        if said:
            print("\nthe engine also said:", file=sys.stderr)
            for message in said:
                print(f"  {message}", file=sys.stderr)
        return 1

    print(f"ok — {len(pdf)} bytes, tagged, {len(BRAND_FAMILIES)} brand faces embedded")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
