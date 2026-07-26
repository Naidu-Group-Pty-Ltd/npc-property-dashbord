"""Regression coverage for the Docling/EasyOCR language defaults."""

import json
import os
import subprocess
import sys


def test_default_ocr_languages_are_a_compatible_easyocr_group():
    env = os.environ.copy()
    env.pop("DOCLING_OCR_LANGS", None)
    result = subprocess.run(
        [sys.executable, "-c", "import app, json; print(json.dumps(app.OCR_LANGS))"],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )

    assert json.loads(result.stdout.strip()) == ["en", "fr", "de", "es"]
