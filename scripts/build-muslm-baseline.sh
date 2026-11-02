#!/usr/bin/env bash
# Build a native headless XPPAUT that uses musl's libm (the math library
# Emscripten uses) instead of glibc's. The WebAssembly build should match it
# byte for byte:
#
#   scripts/build-muslm-baseline.sh
#   BASELINE=build/headless-muslm/xppaut scripts/compare-batch.sh scripts/xpp-wasm-node.mjs
#
# Against the glibc desktop build, a few chaotic or stiff examples differ in
# the last printed digits only because exp/sin/pow round differently.
# Needs Emscripten installed in .emsdk/ (for the musl sources).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
musl="$root/.emsdk/upstream/emscripten/system/lib/libc/musl"
out="$root/build/muslm"
[ -d "$musl/src/math" ] || { echo "musl sources not found; run scripts/setup-emsdk.sh"; exit 1; }

make -s -C "$root/web" -j"$(nproc)" headless

rm -rf "$out"
mkdir -p "$out/inc/bits"
# Compile against musl's own math.h, not glibc's (which declares musl's
# internal __sin/__cos/__tan with different signatures).
cp "$musl/include/math.h" "$out/inc/math.h"
cat > "$out/inc/bits/alltypes.h" <<'EOF'
#if defined(__NEED_float_t) && !defined(__DEFINED_float_t)
typedef float float_t;
#define __DEFINED_float_t
#endif
#if defined(__NEED_double_t) && !defined(__DEFINED_double_t)
typedef double double_t;
#define __DEFINED_double_t
#endif
EOF

# Double-precision functions only (skip float/long double variants; erf is
# double despite ending in f; fma needs headers we do not provide).
for f in "$musl"/src/math/*.c; do
  b="$(basename "$f" .c)"
  case "$b" in
    erf) ;;
    fma|*f|*l|*fl|*f_r|*l_r|*f_data) continue ;;
  esac
  gcc -O2 -w -fno-builtin -ffp-contract=off -Dhidden= \
    -I"$out/inc" -I"$musl/src/internal" -I"$musl/arch/generic" \
    -c "$f" -o "$out/$b.o"
done

mkdir -p "$root/build/headless-muslm"
gcc -fcommon -o "$root/build/headless-muslm/xppaut" \
  "$root"/build/headless-cc/*.o "$out"/*.o -lm
echo "Built $root/build/headless-muslm/xppaut"
