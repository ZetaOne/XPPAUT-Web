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

- `xppaut/` - unmodified upstream XPPAUT 8.0 source (see `xppaut/UPSTREAM.md`)
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
