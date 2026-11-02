# Project status

Last updated: 2026-11-02 (project lives at /data/hdrive/XPPAUT-Web)

## Goal

Port XPPAUT to run as a web application in the user's browser, keeping the
original desktop UI as close as possible, and letting users download plots,
.ode files and all data XPP creates. Based on the "Idea 1: Web port"
project at https://sites.pitt.edu/~phase/bard/bardware/xpp/gsoc_ideas.html.

## Chosen approach (A)

Compile the real XPPAUT C source to WebAssembly with Emscripten and
reimplement the Xlib functions it uses on an HTML canvas.

Why: XPP's UI uses raw Xlib with no toolkit (it draws its own buttons, menus
and dialogs), so a canvas Xlib layer reproduces the UI pixel for pixel, and
the numerics (ODE solvers, CVODE, AUTO) are reused unchanged. Files XPP
writes go to Emscripten's in-memory file system and can be offered as
downloads.

Rejected: a Linux VM in the browser (huge, slow), streaming from a server
(not in-browser), rewriting the UI in HTML (largest effort, drifts from the
original).

## Done

1. **Source imported.** Official XPPAUT 8.0 tarball in `xppaut/` (the
   GitHub repo is from 2016 and outdated). Provenance and checksum in
   `xppaut/UPSTREAM.md`. Desktop reference build: `scripts/build-native.sh`,
   `scripts/test-native.sh`.
2. **Builds without libX11.** `web/Makefile` builds against bundled
   X11 headers and placeholder Xlib functions (`web/xlib/xstub.c`, 69
   functions). Batch-mode output is byte-identical to the desktop build on
   all 144 example .ode files that produce output (gcc and clang).
3. **Compiles to WebAssembly and runs.** Emscripten 6.0.13 in `.emsdk/`.
   `make -C web wasm` gives `build/wasm/xppaut.wasm` (~1 MB) +
   `xppaut.mjs`; `scripts/xpp-wasm-node.mjs` runs it under Node.
   - vs a native build using musl's libm (`scripts/build-muslm-baseline.sh`):
     **byte-identical on all 144** examples.
   - vs the glibc desktop build: 129 identical, 15 differ only from last-digit
     libm rounding (exp/sin/pow) amplified in chaotic/stiff/adaptive-step
     runs. Accepted: desktop XPP on macOS differs from Linux the same way.

   Source fixes needed so far (11 files) are listed in the Patches table
   in `xppaut/UPSTREAM.md`.

## Next

- **Step 3:** replace the stubs with a real Xlib on canvas, roughly in order
  of use: windows + text, lines/colours/input events, pixmaps/cursors.
  XPP's event loop blocks on `XNextEvent`, so it needs Asyncify or JSPI.
- **Step 4:** file upload into the virtual file system, and a downloads
  panel for every file XPP writes (plus PNG export of plots).

## Open decisions

- Licence: XPPAUT is GPL v2, so the distributed web app must use a
  GPL-compatible licence.
- User-compiled C functions (`dlopen`, HAVEDLL) cannot work in the browser
  and are disabled.

## Setting up on a new machine

Needs git, gcc, make, Node and (for the desktop reference build) libX11
headers, e.g. `sudo apt install build-essential libx11-dev`.

```bash
npm install                  # web front end dependencies
scripts/build-native.sh      # desktop reference build
scripts/test-native.sh       # should print PASS
make -C web headless
scripts/compare-batch.sh build/headless-cc/xppaut   # 144 SAME, 9 NOOUT

source .emsdk/emsdk_env.sh           # Emscripten (install: scripts/setup-emsdk.sh)
make -C web wasm
scripts/build-muslm-baseline.sh
BASELINE=build/headless-muslm/xppaut scripts/compare-batch.sh scripts/xpp-wasm-node.mjs   # 144 SAME, 9 NOOUT
```
