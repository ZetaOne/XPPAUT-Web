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
# example models from every folder of the XPP release, with the animation,
# table and (small) data files they use, plus a grouped index for the page
rm -rf "$root/public/odes"
python3 - "$root" <<'EOF'
import json, os, shutil, sys
root = sys.argv[1]
groups = [  # folders relative to the project
    ("xpp81", "New in XPPAUT 8.1", "examples/xpp81"),
    ("ode", "XPP examples", "xppaut/ode"),
    ("tstauto", "AUTO test models", "xppaut/tstauto"),
    ("canonical", "Canonical models", "xppaut/canonical"),
    ("help", "Examples from the help pages", "xppaut/help/odes"),
]
index = []
for gid, label, src in groups:
    src = os.path.join(root, src)
    dst = os.path.join(root, "public", "odes", gid)
    os.makedirs(dst, exist_ok=True)
    odes, data = [], []
    for name in sorted(os.listdir(src), key=str.lower):
        path = os.path.join(src, name)
        if not os.path.isfile(path) or "conflicted" in name or name == "output.dat":
            continue
        ext = os.path.splitext(name)[1].lower()
        if ext == ".ode":
            odes.append(name)
        elif ext in (".ani", ".tab") or (ext == ".dat" and os.path.getsize(path) < 200_000):
            data.append(name)
        else:
            continue
        shutil.copy(path, dst)
    index.append({"id": gid, "label": label, "odes": odes, "data": data})
with open(os.path.join(root, "public", "odes", "index.json"), "w") as f:
    json.dump(index, f)
print("examples:", ", ".join("%s %d" % (g["id"], len(g["odes"])) for g in index))
EOF
# uncompressed sizes, for the loading bar (hosts may send the files compressed)
printf '{"asyncify": %d, "jspi": %d}\n' \
  "$(stat -c%s "$root/public/wasm/xppaut.wasm")" "$(stat -c%s "$root/public/wasm/jspi/xppaut.wasm")" \
  > "$root/public/wasm/sizes.json"
echo "public/wasm, public/odes and public/help updated"
