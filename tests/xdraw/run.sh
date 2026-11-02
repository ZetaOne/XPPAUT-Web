#!/usr/bin/env bash
# Draw tests/xdraw/drawtest.c with the real X server (Xvfb) and with our
# Xlib layer, and compare. Output in build/xdraw/.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/xdraw"
mkdir -p "$out"
make -s -C "$root/web" headless
gcc -O2 -o "$out/drawtest-x11" "$root/tests/xdraw/drawtest.c" -lX11 -lm
objs=()
for o in xlib.o draw.o fonts_data.o colors_data.o platform_native.o; do objs+=("$root/build/headless-cc/$o"); done
gcc -O2 -I"$root/web/include" -o "$out/drawtest-web" "$root/tests/xdraw/drawtest.c" "${objs[@]}" -lm

# real X
disp=":$((80 + RANDOM % 9))"
Xvfb "$disp" -screen 0 1280x1024x24 -nolisten tcp > /dev/null 2>&1 &
xv=$!
sleep 1
DISPLAY="$disp" "$out/drawtest-x11" &
app=$!
sleep 1
DISPLAY="$disp" xwd -silent -id "$(DISPLAY="$disp" xdotool search --name drawtest | head -1)" -out "$out/ref.xwd"
kill $app $xv
convert "$out/ref.xwd" "$out/ref-drawtest.png"

# ours
printf 'window "drawtest"\nshot %s/web.ppm\n' "$out" > "$out/script.txt"
XPPWEB_NOWM=1 XPPWEB_SCRIPT="$out/script.txt" "$out/drawtest-web" || true
python3 -c "from PIL import Image; Image.open('$out/web.ppm').save('$out/web-drawtest.png')"
python3 "$root/scripts/compare-images.py" "$out/ref-drawtest.png" "$out/web-drawtest.png" "$out/cmp-drawtest.png"
