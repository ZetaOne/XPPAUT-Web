#!/usr/bin/env bash
# Install the Emscripten SDK into .emsdk/ inside this repository (git-ignored,
# about 1 GB, nothing system-wide). Downloads from
# https://github.com/emscripten-core/emsdk.
#
# Afterwards, in each new shell:   source .emsdk/emsdk_env.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
[ -d .emsdk ] || git clone --depth 1 https://github.com/emscripten-core/emsdk.git .emsdk
cd .emsdk
./emsdk install latest
./emsdk activate latest
echo
echo "Done. Run:  source .emsdk/emsdk_env.sh  &&  make -C web wasm"
