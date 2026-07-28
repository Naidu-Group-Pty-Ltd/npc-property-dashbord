"""
API-surface tests: auth, input validation, and the honesty contract in the
liveness response. These run without the ONNX models present.
"""
import base64
import importlib
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("AML_SERVICE_TOKEN", "test-token")

from fastapi.testclient import TestClient  # noqa: E402

from app import main as main_module  # noqa: E402

client = TestClient(main_module.app)
AUTH = {"Authorization": "Bearer test-token"}

# 1x1 PNG.
TINY_PNG = base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000a49444154789c6300010000050001"
    "0d0a2db40000000049454e44ae426082"
)).decode()


def test_healthz_reports_model_presence_without_auth():
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert "models" in body and "yunet" in body["models"]
    assert body["token_configured"] is True


@pytest.mark.parametrize("path", ["/face/compare", "/face/liveness", "/doc/mrz"])
def test_endpoints_require_a_token(path):
    r = client.post(path, json={"document_image": TINY_PNG, "selfie_image": TINY_PNG})
    assert r.status_code == 401


@pytest.mark.parametrize("path", ["/face/compare", "/face/liveness", "/doc/mrz"])
def test_endpoints_reject_a_wrong_token(path):
    r = client.post(
        path,
        json={"document_image": TINY_PNG, "selfie_image": TINY_PNG},
        headers={"Authorization": "Bearer nope"},
    )
    assert r.status_code == 401


def test_service_fails_closed_when_token_unconfigured(monkeypatch):
    # An unauthenticated verification service would let anyone submit faces.
    monkeypatch.setattr(main_module, "SERVICE_TOKEN", "")
    r = client.post("/doc/mrz", json={"document_image": TINY_PNG}, headers=AUTH)
    assert r.status_code == 503


def test_rejects_non_base64_payload():
    r = client.post("/doc/mrz", json={"document_image": "!!!not base64!!!"}, headers=AUTH)
    assert r.status_code == 400


def test_rejects_undecodable_image():
    junk = base64.b64encode(b"this is not an image").decode()
    r = client.post("/doc/mrz", json={"document_image": junk}, headers=AUTH)
    assert r.status_code == 400


def test_rejects_oversized_image(monkeypatch):
    monkeypatch.setattr(main_module, "MAX_IMAGE_BYTES", 10)
    big = base64.b64encode(b"x" * 100).decode()
    r = client.post("/doc/mrz", json={"document_image": big}, headers=AUTH)
    assert r.status_code == 413


def test_missing_field_is_a_validation_error():
    r = client.post("/face/compare", json={"document_image": TINY_PNG}, headers=AUTH)
    assert r.status_code == 422


def test_liveness_response_states_its_own_limits(monkeypatch):
    """
    The advisory text is part of the contract, not decoration. A caller that
    treats this heuristic as proof of liveness would be materially misled, so
    the limitation travels with every response.
    """
    monkeypatch.setattr(main_module.m, "detect_largest_face", lambda _img: None)
    r = client.post("/face/liveness", json={"selfie_image": TINY_PNG}, headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["is_real"] is None
    assert "no_face_in_selfie" in body["problems"]


def test_compare_reports_unusable_capture_separately(monkeypatch):
    """
    A capture problem is not an identity failure. Conflating them would burn
    one of the customer's three attempts for a lighting problem.
    """
    monkeypatch.setattr(main_module.m, "detect_largest_face", lambda _img: None)
    r = client.post(
        "/face/compare",
        json={"document_image": TINY_PNG, "selfie_image": TINY_PNG},
        headers=AUTH,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["verdict"] == "unusable"
    assert body["similarity"] is None
    assert "no_face_in_document" in body["problems"]


def test_service_persists_nothing(tmp_path):
    """
    The privacy property the design depends on: no writes outside /tmp.
    A second, unaudited copy of biometric data would defeat the access log.
    """
    src = Path(main_module.__file__).parent
    text = "\n".join(p.read_text() for p in src.glob("*.py"))
    for forbidden in ["imwrite", "open(", "shutil", "boto3", "psycopg", "sqlite3"]:
        assert forbidden not in text.replace("urllib.request.urlopen(", ""), (
            f"{forbidden} suggests the service is persisting or fetching data"
        )
