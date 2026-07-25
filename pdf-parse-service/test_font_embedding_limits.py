"""Regression coverage for the document-wide embedded-font payload budget."""

import base64

import app


class _Page:
    def get_fonts(self, full=True):
        assert full
        return [
            (1, "ttf", "Type0", "FirstFont", "F1", "", 0),
            (2, "ttf", "Type0", "SecondFont", "F2", "", 0),
        ]


class _Document:
    page_count = 1

    def load_page(self, page_number):
        assert page_number == 0
        return _Page()

    def extract_font(self, xref):
        return ("font", "ttf", "Type0", b"abcd" if xref == 1 else b"efgh")

    def close(self):
        pass


class _Font:
    glyph_count = 128

    def __init__(self, **_kwargs):
        pass

    def has_glyph(self, _codepoint):
        return True


class _Fitz:
    Font = _Font

    @staticmethod
    def open(**_kwargs):
        return _Document()


def test_extract_fitz_fonts_caps_aggregate_embedded_bytes(monkeypatch):
    monkeypatch.setattr(app, "fitz", _Fitz)
    monkeypatch.setattr(app, "_FITZ_AVAILABLE", True)
    monkeypatch.setattr(app, "ENABLE_FITZ_LAYERS", True)
    monkeypatch.setattr(app, "MAX_FONT_BYTES", 4)
    monkeypatch.setattr(app, "MAX_EMBEDDED_FONT_BYTES", 6)

    fonts = app._extract_fitz_fonts(b"%PDF-fake")

    assert [font["basename"] for font in fonts] == ["FirstFont", "SecondFont"]
    assert fonts[0]["base64"] == base64.b64encode(b"abcd").decode("ascii")
    assert "base64" not in fonts[1]
    assert fonts[1]["bytes"] == 4
