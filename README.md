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

## Web port build

`web/xlib/xstub.c` currently provides placeholder versions of the 69 Xlib
functions XPP links against. That is enough for batch mode (`-silent`), not
yet for the graphical interface.

```bash
make -C web headless                 # native, gcc   -> build/headless-cc/xppaut
make -C web CC=clang-18 headless     # native, clang -> build/headless-clang-18/xppaut
scripts/compare-batch.sh build/headless-cc/xppaut   # compare all ode/*.ode with the desktop build
```

WebAssembly (needs Emscripten; `scripts/setup-emsdk.sh` installs it into `.emsdk/`):

```bash
source .emsdk/emsdk_env.sh
make -C web wasm                              # -> build/wasm/xppaut.mjs + xppaut.wasm
scripts/compare-batch.sh scripts/xpp-wasm-node.mjs
```
