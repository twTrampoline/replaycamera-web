# Whole-body video memory tracker

EdgeTAM code and checkpoint: Meta Platforms, Inc., Apache-2.0.
https://github.com/facebookresearch/EdgeTAM
Revision: 7711e012a30a2402c4eaab637bdb00a521302c91
Checkpoint: checkpoints/edgetam.pt. Model input resized to 512 square.

Browser port and ONNX exporter: dither-studio contributors, Apache-2.0.
https://github.com/kcvete/dither-studio
Revision: cd2dac6f5aa4c8501b10cc22c6e8199bcb463810
Sources: web/track.js; onnxexport/export_onnx.py; onnxexport/wrappers_onnx.py;
coreml/wrappers.py; server/edgetam_util.py.
track.mjs is the upstream browser port. The application does not use polygon
prompt models, so manifest.has_mask_prompt is disabled to avoid their download.

ONNX Runtime Web 1.27.0: Microsoft, MIT. See ort/LICENSE and
ort/ThirdPartyNotices.txt. Bundled runtime and model files load from this site;
video frames are processed locally and are not uploaded.

Export environment: Python 3.11, torch 2.2.2, ONNX 1.17, ONNX Runtime 1.23.2.
Exporter compatibility: omit dynamo=False (not supported by torch 2.2), set
pretrained=False for backbone construction (checkpoint supplies all weights),
use image_size=512 and RoPE grid 32x32. Models include FP16 WebGPU and FP32
fallback. No claim of competition-grade precision or universal phone latency.
