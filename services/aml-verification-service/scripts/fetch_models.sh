#!/usr/bin/env sh
# Fetch the Apache-2.0 licensed models from opencv/opencv_zoo.
#
# These two files are the entire reason this stack is free AND lawful. Do not
# replace them with InsightFace/ArcFace weights (including indirectly, via
# CompreFace or DeepFace defaults) — those are non-commercial research only.
set -eu

MODEL_DIR="${AML_MODEL_DIR:-/models}"
ZOO="https://raw.githubusercontent.com/opencv/opencv_zoo/main/models"

mkdir -p "$MODEL_DIR"

fetch() {
  url="$1"; out="$2"
  if [ -f "$out" ]; then echo "present: $out"; return; fi
  echo "fetching: $out"
  curl -fsSL "$url" -o "$out"
}

fetch "$ZOO/face_detection_yunet/face_detection_yunet_2023mar.onnx" \
      "$MODEL_DIR/face_detection_yunet_2023mar.onnx"
fetch "$ZOO/face_recognition_sface/face_recognition_sface_2021dec.onnx" \
      "$MODEL_DIR/face_recognition_sface_2021dec.onnx"

# Apache-2.0 requires the licence and attribution travel with the model.
fetch "$ZOO/face_recognition_sface/LICENSE" "$MODEL_DIR/LICENSE.sface"
fetch "$ZOO/face_detection_yunet/LICENSE"   "$MODEL_DIR/LICENSE.yunet" || true

echo "done. models in $MODEL_DIR"
