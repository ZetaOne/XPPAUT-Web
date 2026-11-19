#!/usr/bin/env bash
# Puts the voice engines' models and runtime in public/voice/ (not in git):
#   public/voice/vosk/model.tar.gz             Vosk's small English model (41 MB)
#   public/voice/whisper/whisper-tiny.en/...   Whisper tiny.en, quantized ONNX (42 MB)
#   public/voice/ort/ort-wasm-simd-threaded.*  ONNX Runtime for Whisper (14 MB, from node_modules)
# Files come from $VOICE_DL (a folder of downloads, if present) or are
# downloaded; every one is checked against the SHA-256 below. The page
# downloads them only when a user picks that engine (Settings -> Voice).
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
dl=${VOICE_DL:-$HOME/Downloads/XPPAUT-voice-downloads}
out=$root/public/voice
mkdir -p "$out/vosk" "$out/whisper/whisper-tiny.en/onnx" "$out/ort"

VOSK_URL=https://github.com/ZetaOne/XPPAUT-Web/releases/download/voice-model/vosk-model-small-en-us-0.15.zip
VOSK_SHA=30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498
WHISPER_URL=https://huggingface.co/Xenova/whisper-tiny.en/resolve/main
WHISPER_FILES=(
  "config.json 37a1073be00d19118c06557896c7c148598f4d8277edc0f5bc07c9f5554839f1"
  "generation_config.json 132c95ba9db45f4498f2eab3fea7c1d6a174005010f8f6b7d20cfd5e9795996b"
  "preprocessor_config.json a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d"
  "tokenizer.json c6ee8f089220a5b1188f6426456772572671c6141ae007eecb83c6a8349f5deb"
  "tokenizer_config.json e082c1ad251541bf277967a703252cddd4bb37a71a43737e03d050c22ec08238"
  "onnx/encoder_model_quantized.onnx 8cc3c6f8563d1b3fbd2c5af9f64c2bed8b020bc593c402d1ef53b9f08fbf1b90"
  "onnx/decoder_model_merged_quantized.onnx dbb2e063b7fbc41d9803b9698f93ecb035c50cbb3fb87b56cb131e4a5eb99059"
)

check() { # file sha
  echo "$2  $1" | sha256sum -c --quiet - || { echo "checksum mismatch: $1" >&2; exit 1; }
}
get() { # local-path url dest sha
  if [ -f "$3" ] && echo "$4  $3" | sha256sum -c --quiet - 2>/dev/null; then return; fi
  if [ -f "$1" ]; then cp "$1" "$3"; else curl -sfL --retry 3 -A "xppaut-web-build" -o "$3" "$2"; fi
  check "$3" "$4"
}

# Vosk: the release's zip, repacked as the .tar.gz that vosk-browser reads
if [ ! -f "$out/vosk/model.tar.gz" ]; then
  tmp=$(mktemp -d)
  get "$dl/vosk/vosk-model-small-en-us-0.15.zip" "$VOSK_URL" "$tmp/model.zip" "$VOSK_SHA"
  (cd "$tmp" && unzip -q model.zip && tar -czf "$out/vosk/model.tar.gz" vosk-model-small-en-us-0.15)
  rm -rf "${tmp:?}"
fi

# Whisper tiny.en
for entry in "${WHISPER_FILES[@]}"; do
  set -- $entry
  get "$dl/whisper/model/$1" "$WHISPER_URL/$1" "$out/whisper/whisper-tiny.en/$1" "$2"
done

# ONNX Runtime (plain WebAssembly build), the version transformers.js was installed with
for f in ort-wasm-simd-threaded.mjs ort-wasm-simd-threaded.wasm; do
  cp "$root/node_modules/onnxruntime-web/dist/$f" "$out/ort/$f"
done

du -sh "$out/vosk" "$out/whisper" "$out/ort"
