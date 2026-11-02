#!/usr/bin/env bash
# Run a GUI script on the real desktop XPPAUT (Xvfb + xdotool) and on our
# Xlib layer (headless harness), then compare every `shot` pixel by pixel.
#
#   scripts/compare-gui.sh tests/gui/main.txt [file.ode]   (default lecar.ode)
#   scripts/compare-gui.sh tests/gui/*.txt                  (all, lecar.ode)
#
# Writes build/guicmp/<script>/{ref-*,web-*,cmp-*}.png; cmp images show
# reference | ours | differences in red. Needs Xvfb, xdotool, xwd, convert.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
[ -x "$root/build/native/xppaut" ] || "$root/scripts/build-native.sh" > /dev/null
make -s -C "$root/web" headless
ode="lecar.ode"
scripts=()
for a in "$@"; do
  case "$a" in *.ode) ode="$a" ;; *) scripts+=("$(realpath "$a")") ;; esac
done
fail=0
for s in "${scripts[@]}"; do
  name="$(basename "$s" .txt)"
  out="$root/build/guicmp/$name"
  rm -rf "$out"
  mkdir -p "$out"
  cp "$root/xppaut/ode/$ode" "$out/"
  python3 "$root/scripts/xref.py" "$root/build/native/xppaut" "$ode" "$s" "$out"
  (cd "$out" && XPPWEB_NOWM=1 XPPWEB_SCREEN=1280x1024 XPPWEB_SCRIPT="$s" \
    timeout 60 "$root/build/headless-cc/xppaut" "$ode" > web-xpp.log 2>&1) || true
  for shot in $(grep -E '^\s*shot ' "$s" | awk '{print $2}'); do
    base="${shot%.*}"
    [ -f "$out/$shot" ] && python3 -c "from PIL import Image; Image.open('$out/$shot').save('$out/web-$base.png')"
    result=$(python3 "$root/scripts/compare-images.py" "$out/ref-$base.png" "$out/web-$base.png" "$out/cmp-$base.png")
    echo "$name/$base: $result"
    case "$result" in "identical"*) ;; *) fail=1 ;; esac
  done
done
exit $fail
