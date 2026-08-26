"""Fetch the pinned model at BUILD time, and refuse anything else.

Run by the Dockerfile, never at request time: a service that downloads its
model on first use is a service whose behaviour depends on somebody else's
CDN being up at 3am, and whose bytes nobody pinned. The manifest is the
authority — URL, size and SHA-256 — and a mismatch fails the BUILD, which is
the cheapest place this can possibly fail.
"""

import hashlib
import os
import sys
import urllib.request

from model_manifest import MODEL_BYTES, MODEL_FILENAME, MODEL_SHA256, MODEL_URL


def main() -> int:
    target_dir = sys.argv[1] if len(sys.argv) > 1 else "models"
    os.makedirs(target_dir, exist_ok=True)
    target = os.path.join(target_dir, MODEL_FILENAME)

    if os.path.exists(target) and _sha256(target) == MODEL_SHA256:
        print(f"model already present and verified: {target}")
        return 0

    print(f"downloading {MODEL_URL} ({MODEL_BYTES} bytes) ...")
    request = urllib.request.Request(
        MODEL_URL, headers={"User-Agent": "builder-stock-image-worker/build"})
    with urllib.request.urlopen(request, timeout=600) as response, \
            open(target, "wb") as out:
        digest = hashlib.sha256()
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            digest.update(chunk)
            out.write(chunk)

    actual = digest.hexdigest()
    size = os.path.getsize(target)
    if actual != MODEL_SHA256 or size != MODEL_BYTES:
        os.remove(target)
        print(
            "FATAL: downloaded model does not match the manifest "
            f"(sha256 {actual}, {size} bytes); refusing to build with it",
            file=sys.stderr,
        )
        return 1

    print(f"verified {MODEL_FILENAME}: sha256 {actual}, {size} bytes")
    return 0


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    sys.exit(main())
