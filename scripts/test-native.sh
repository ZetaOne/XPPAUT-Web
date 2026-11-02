#!/usr/bin/env bash
# Run the native build in silent batch mode on lecar.ode and compare
# its output.dat with the stored reference.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
bin="$root/build/native/xppaut"
[ -x "$bin" ] || "$root/scripts/build-native.sh"
run="$(mktemp -d)"
cp "$root/xppaut/ode/lecar.ode" "$run/"
(cd "$run" && "$bin" lecar.ode -silent > xpp.log 2>&1)
if cmp -s "$run/output.dat" "$root/tests/reference/lecar.output.dat"; then
  echo "PASS: lecar.ode output matches reference ($(wc -l < "$run/output.dat") rows)"
else
  echo "FAIL: output differs; see $run"; exit 1
fi
