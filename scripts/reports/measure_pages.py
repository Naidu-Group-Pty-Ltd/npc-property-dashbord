#!/usr/bin/env python3
"""Measure a rendered report, page by page, for `critique.pure.ts`.

The rubric is pure TypeScript and knows nothing about pixels. This is the half
that owns the pixels: it rasterises each page, works out how much of it carries
ink and how much of that ink is in the trim margin, pulls the text and the
display-size text out of the PDF, and prints one JSON `DocumentMeasurement`.

Two things are worth explaining rather than reading off the code.

**The paper colour is sampled, not assumed.** A report prints on whatever stock
its design system carries — warm ivory, porcelain, near-white, or an obsidian
field on a cover — so a hardcoded background would read a dark cover as 100%
ink. The modal pixel of the page is the paper, whatever it is.

**"Ink" is a distance, not a difference.** Anti-aliased type and a faint grid
texture both differ from the paper by a little; body copy differs by a lot. A
flat threshold on the channel distance counts the texture as content and reports
a near-empty page as full, which is precisely the failure the rubric exists to
catch. `INK_DISTANCE` is set above the texture and below the lightest type in a
real render.

Usage:
    measure_pages.py <pdf> [--dpi 72] [--images <dir>] [--claimed <n>]
"""
from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

from PIL import Image

# Millimetres, mirroring `reportDesign/page.pure.ts`. Duplicated rather than
# imported because this is Python and that is TypeScript; `test_measure_pages`
# reads the constants out of the module and fails if they drift.
PAGE_W_MM = 210.0
PAGE_H_MM = 297.0
MARGIN_MM = 18.0

# How far a pixel must sit from the paper colour to count as ink. Chosen against
# real renders: the grid texture lands at ~10, body copy at ~120, the lightest
# muted caption at ~60.
INK_DISTANCE = 32

# A page whose modal colour covers less than this is a full-bleed field — a
# cover or a closing page — rather than paper with type on it.
FULL_BLEED_MODAL = 0.55

# Points. Above this, text on a page is display type rather than body copy.
HEADING_PT = 15.0


def _run(cmd: list[str]) -> str:
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def page_text(pdf: Path, page: int) -> list[str]:
    """The page's text, one entry per line, blank lines dropped."""
    raw = _run(['pdftotext', '-f', str(page), '-l', str(page), '-layout', str(pdf), '-'])
    return [ln.strip() for ln in raw.splitlines() if ln.strip()]


def page_headings(pdf: Path, page: int) -> list[str]:
    """Text set at display size, longest first.

    Read off the PDF's own font sizes via `pdftotext -bbox-layout`, so it is what
    was actually set rather than what the HTML asked for — which is the whole
    point, since the defect being caught is a heading and a paragraph that say
    the same thing.
    """
    try:
        xml = _run(['pdftotext', '-f', str(page), '-l', str(page), '-bbox-layout', str(pdf), '-'])
    except subprocess.CalledProcessError:
        return []

    heads: list[str] = []
    for line_m in re.finditer(r'<line\b([^>]*)>(.*?)</line>', xml, re.S):
        attrs, body = line_m.group(1), line_m.group(2)
        top = re.search(r'yMin="([\d.]+)"', attrs)
        bot = re.search(r'yMax="([\d.]+)"', attrs)
        if not top or not bot:
            continue
        # The line box height in points approximates the set size closely enough
        # to separate a 34pt chapter title from 10.5pt body copy.
        if float(bot.group(1)) - float(top.group(1)) < HEADING_PT:
            continue
        words = re.findall(r'<word[^>]*>(.*?)</word>', body, re.S)
        # `-bbox-layout` is XML, so a quotation mark in a chapter dek arrives as
        # `&quot;` and would never match the same words read out of `-layout`.
        text = html.unescape(' '.join(w.strip() for w in words if w.strip()))
        if text:
            heads.append(text)
    return sorted(heads, key=len, reverse=True)


def measure_image(path: Path) -> dict:
    """Ink coverage for the whole page and for the trim margin alone."""
    img = Image.open(path).convert('RGB')
    w, h = img.size
    px = img.load()

    # The paper is whatever colour most of the page is. Sampled on a coarse grid
    # — every pixel is needless for a mode and slow at print resolution.
    step = max(1, min(w, h) // 120)
    sample = Counter()
    for y in range(0, h, step):
        for x in range(0, w, step):
            sample[px[x, y]] += 1
    paper, paper_n = sample.most_common(1)[0]
    modal_share = paper_n / max(1, sum(sample.values()))

    mx = int(round(w * MARGIN_MM / PAGE_W_MM))
    my = int(round(h * MARGIN_MM / PAGE_H_MM))

    ink = 0
    margin_ink = 0
    margin_px = 0
    total = 0
    for y in range(0, h, step):
        in_margin_y = y < my or y >= h - my
        for x in range(0, w, step):
            total += 1
            r, g, b = px[x, y]
            dist = abs(r - paper[0]) + abs(g - paper[1]) + abs(b - paper[2])
            inked = dist > INK_DISTANCE
            if inked:
                ink += 1
            if in_margin_y or x < mx or x >= w - mx:
                margin_px += 1
                if inked:
                    margin_ink += 1

    return {
        'inkCoverage': round(ink / max(1, total), 4),
        'marginInk': round(margin_ink / max(1, margin_px), 4),
        'fullBleed': modal_share < FULL_BLEED_MODAL or sum(paper) < 240,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf', type=Path)
    ap.add_argument('--dpi', type=int, default=72)
    ap.add_argument('--images', type=Path, default=None,
                    help='keep the rasterised pages here, for a person or an agent to look at')
    ap.add_argument('--claimed', type=int, default=None)
    args = ap.parse_args()

    if not args.pdf.exists():
        print(f'no such pdf: {args.pdf}', file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory() as tmp:
        out_dir = args.images or Path(tmp)
        out_dir.mkdir(parents=True, exist_ok=True)
        # A --images directory is reused between runs, and a shorter document
        # leaves the previous run's later pages behind. Measuring those reports
        # on a document that no longer exists, and asks pdftotext for a page
        # past the end — which is how this was found.
        for stale in out_dir.glob('page-*.png'):
            stale.unlink()
        stem = out_dir / 'page'
        subprocess.run(
            ['pdftoppm', '-png', '-r', str(args.dpi), str(args.pdf), str(stem)],
            check=True, capture_output=True,
        )
        images = sorted(out_dir.glob('page-*.png'))

        pages = []
        for i, image in enumerate(images, start=1):
            m = measure_image(image)
            m['page'] = i
            m['lines'] = page_text(args.pdf, i)
            m['headings'] = page_headings(args.pdf, i)
            if args.images:
                m['image'] = str(image)
            pages.append(m)

    doc = {'pages': pages}
    if args.claimed is not None:
        doc['claimedPages'] = args.claimed
    json.dump(doc, sys.stdout, indent=2)
    print()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
