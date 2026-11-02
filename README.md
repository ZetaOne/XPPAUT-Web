# XPPAUT-Web

A browser-based tool for simulating and analyzing dynamical systems, inspired by XPPAUT.

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run build    # type-check and build to dist/
npm run preview  # serve the production build
```

## Approach

The original XPPAUT C source is compiled to WebAssembly with Emscripten. Its
X11 interface (77 Xlib functions, no toolkit) is reimplemented in the browser
on an HTML canvas, so the UI looks and behaves like the desktop version. Files
XPP writes are kept in an in-memory file system and offered as downloads.

## Layout

- `xppaut/` - upstream XPPAUT 8.0 source with a few small fixes (see `xppaut/UPSTREAM.md`)
- `web/` - build for the web port: `Makefile`, X11 headers (`include/`) and our Xlib implementation (`xlib/`)
- `src/` - web front end (Vite + TypeScript)
- `scripts/` - build and test scripts
- `tests/reference/` - output from the native desktop build, used to check the web build

## Native reference build

Builds the desktop version (needs gcc, make and libX11 headers) and checks a
batch run against the stored reference output:

```bash
./scripts/build-native.sh
./scripts/test-native.sh
```

## Running the web app

```bash
source .emsdk/emsdk_env.sh   # Emscripten (install once: scripts/setup-emsdk.sh)
npm run build:wasm            # compile XPP, copy it and the example .odes into public/
npm run dev                   # open http://localhost:5173/  (or ?ode=lecar.ode)
```

## How it is built

`web/xlib/` is a small X11 implementation inside the program: the 69 Xlib
functions XPP calls, drawing into in-memory pixel buffers.

- `web/xlib/platform_web.c` + `src/xpp.ts`: in the browser, each X window
  becomes a panel with a canvas; mouse and keyboard become X events.
- `web/xlib/platform_native.c`: a native, scriptable headless build for
  tests, e.g.
  `XPPWEB_SCRIPT=script.txt build/headless-cc/xppaut lecar.ode`
  with commands like `key i`, `click X Y`, `screenshot out.ppm`.

```bash
make -C web headless                 # native, gcc   -> build/headless-cc/xppaut
make -C web CC=clang-18 headless     # native, clang -> build/headless-clang-18/xppaut
scripts/compare-batch.sh build/headless-cc/xppaut   # compare all ode/*.ode with the desktop build
scripts/build-muslm-baseline.sh               # native build with Emscripten's libm (musl)
BASELINE=build/headless-muslm/xppaut scripts/compare-batch.sh scripts/xpp-wasm-node.mjs
node scripts/browser-test.mjs "http://localhost:4173/?ode=lecar.ode" "wait 3000" "key i" "key g" "shot out.png"
```

The WebAssembly build matches the musl baseline byte for byte. Against the
glibc desktop build a few chaotic examples differ in the last digits, purely
from libm rounding.
