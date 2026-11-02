#!/usr/bin/env bash
# Build the unmodified desktop XPPAUT (X11) out-of-tree, as a reference
# to compare the web build against. Needs gcc, make and libX11 headers.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/build/native"
rm -rf "$out"
mkdir -p "$out"
cp -r "$root/xppaut/." "$out/"
make -C "$out" -j"$(nproc)" > "$out/build.log" 2>&1 || { tail -40 "$out/build.log"; exit 1; }
echo "Built $out/xppaut"
