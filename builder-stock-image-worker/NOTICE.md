# Third-party model attribution

This service runs the **LaMa** inpainting model ("Resolution-robust Large Mask
Inpainting with Fourier Convolutions", Suvorov et al., WACV 2022).

- Model and original code: <https://github.com/advimman/lama> —
  **Apache License 2.0**, Copyright 2021 Samsung Research.
- ONNX export used here: <https://huggingface.co/Carve/LaMa-ONNX>
  (`lama_fp32.onnx`) — **Apache License 2.0**.

The Apache License 2.0 permits commercial use, modification and
redistribution. This NOTICE file ships inside the container image, as the
license's attribution condition asks. The exact file consumed is pinned by
SHA-256 in `model_manifest.py`.
