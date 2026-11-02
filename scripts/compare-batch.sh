#!/usr/bin/env bash
# Run every example .ode in silent batch mode with the native desktop build
# and with a test build, and compare their output.dat files.
#
#   scripts/compare-batch.sh <runner>
#
# <runner> is an executable called as `<runner> <file.ode> -silent` inside a
# directory holding a copy of xppaut/ode, e.g. build/headless-cc/xppaut or
# scripts/xpp-wasm-node.mjs.
#
# Result per file: SAME (byte-identical), CLOSE (numerically equal within
# tolerance, see compare-dat.py), DIFF, RCDIFF (different exit code) or
# NOOUT (the native build wrote no output.dat either).
#
# Set BASELINE=<binary> to compare against something other than the desktop
# build (build/native/xppaut).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
runner="$(realpath "$1")"
native="$(realpath "${BASELINE:-$root/build/native/xppaut}")"
[ -x "$native" ] || "$root/scripts/build-native.sh" > /dev/null
work="$root/build/compare/$(basename "$(dirname "$runner")")-$(basename "$runner")-vs-$(basename "$(dirname "$native")")"
rm -rf "$work"
mkdir -p "$work"

one() {
  local f="$1" b d bin rc
  for b in native test; do
    d="$work/$b/$f"
    mkdir -p "$d"
    cp -r "$root/xppaut/ode/." "$d/"
    rm -f "$d/output.dat"  # upstream ships a stale lecar output.dat
    bin="$native"; [ "$b" = test ] && bin="$runner"
    rc=0; (cd "$d" && timeout 60 "$bin" "$f" -silent > xpp.log 2>&1) || rc=$?
    echo "$rc" > "$d/rc"
  done
  local n="$work/native/$f" t="$work/test/$f"
  if [ "$(cat "$n/rc")" != "$(cat "$t/rc")" ]; then
    echo "RCDIFF $f native=$(cat "$n/rc") test=$(cat "$t/rc")"
  elif [ ! -f "$n/output.dat" ]; then
    echo "NOOUT $f"
  elif [ ! -f "$t/output.dat" ]; then
    echo "DIFF $f (no output.dat)"
  elif cmp -s "$n/output.dat" "$t/output.dat"; then
    echo "SAME $f"; rm -rf "$n" "$t"
  else
    echo "$(python3 -I "$root/scripts/compare-dat.py" "$n/output.dat" "$t/output.dat") $f"
  fi
}
export -f one
export root runner native work

find "$root/xppaut/ode" -maxdepth 1 -name '*.ode' -printf '%f\0' | sort -z \
  | xargs -0 -P"$(nproc)" -I{} bash -c 'one "$1"' _ {} \
  | sort > "$work/results.txt"

awk '{print $1}' "$work/results.txt" | sort | uniq -c
grep -v '^SAME' "$work/results.txt" || true
echo "Details: $work"
! grep -qE '^(DIFF|RCDIFF)' "$work/results.txt"
