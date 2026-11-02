#!/usr/bin/env bash
# Build the WebAssembly module and copy it, with the example .ode files,
# into public/ for the Vite front end. Then: npm run dev  (or npm run build)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$root/.emsdk/emsdk_env.sh" > /dev/null 2>&1
make -C "$root/web" -j"$(nproc)" wasm
mkdir -p "$root/public/wasm" "$root/public/odes"
cp "$root/build/wasm/xppaut.mjs" "$root/build/wasm/xppaut.wasm" "$root/public/wasm/"
rm -rf "$root/public/help"
cp -r "$root/xppaut/help" "$root/public/help"
mkdir -p "$root/public/wasm/jspi"
cp "$root/build/wasm-jspi/xppaut.mjs" "$root/build/wasm-jspi/xppaut.wasm" "$root/public/wasm/jspi/"
rm -f "$root/public/odes/"*
# examples, plus the animation/table/data files they use (data files only if small)
find "$root/xppaut/ode" -maxdepth 1 \( -name '*.ode' -o -name '*.ani' -o -name '*.tab' -o \( -name '*.dat' -size -200k \) \) \
  ! -name '*conflicted*' ! -name 'output.dat' -exec cp {} "$root/public/odes/" \;
(cd "$root/public/odes" && ls | grep -v '^index.json$' | python3 -c 'import json,sys; print(json.dumps(sorted(l.strip() for l in sys.stdin)))' > index.json)
echo "public/wasm and public/odes updated ($(ls "$root/public/odes" | wc -l) files)"
