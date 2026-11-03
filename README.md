# XPPAUT-Web

**Author:** JKG-2026

XPPAUT, the dynamical-systems tool by Bard Ermentrout, running in the browser.
Same program, same interface, nothing to install.

**→ https://zetaone.github.io/XPPAUT-Web/**

<p>
  <img src="docs/nullclines.svg" width="49%" alt="Phase plane of the Morris-Lecar model: a limit cycle with the V and W nullclines">
  <img src="docs/bifurcation.svg" width="49%" alt="Bifurcation diagram of the Morris-Lecar model computed with AUTO">
</p>

*Morris-Lecar (`lecar.ode`), exported as SVG from XPPAUT-Web. Left: limit cycle
and nullclines in the V–W plane. Right: AUTO continuation in `iapp`, with
steady states (red stable, black unstable) and periodic orbits from the Hopf
point (green stable, blue unstable).*

## Features

- **The real XPPAUT 8**: its C code compiled to WebAssembly. Windows match the
  desktop pixel for pixel; results match on all 144 tested examples.
- **AUTO** for steady states, periodic orbits and bifurcation diagrams.
- **212 example models** from the XPPAUT release, or your own `.ode` with its
  `.ani`, `.tab` and `.dat` files.
- **Window panels**: drag, resize, close, save as PNG, or pop out into a
  separate browser window.
- **Exports**: PostScript, SVG, data and `.set` files download automatically,
  or go to a folder you choose.
- **Save session**: one `.zip` with all files, screenshots of every window and
  XPP's output, offered before you restart or quit.
- **Phones and tablets**: detected automatically; tap, long-press (right
  button) and drag, pinch to zoom, and keys phone keyboards lack.
- **Install as an app** (Android, Chrome, Edge): its own icon and window,
  works offline, and offers updates when a new version is published.
- **Model editor**, **XPP's terminal output**, **built-in help**, and
  **ten colour themes**.
- **Fast and private**: about 0.5 MB, near-native speed, nothing leaves your
  browser.

## Quick start

1. Choose an example (or **Open .ode file…**) and press **Run**.
2. Use XPP as on the desktop: **I G** integrates, **N N** draws nullclines,
   **F A** opens AUTO.
3. **Save session** keeps everything; **Settings** sets where exports and output go.

Link straight to a model: `https://zetaone.github.io/XPPAUT-Web/?ode=ode/lecar.ode`

## Browsers

Nothing to install: the site runs in a current desktop browser. Chrome and
Edge get the fastest build; other browsers load a compatible fallback.
Tested in Chrome.

## How it works

The XPPAUT source is compiled with Emscripten. XPP draws its own interface with
X11, so `web/xlib/` reimplements the 69 X11 calls it uses, and the page
(`src/`) shows each X window as a canvas.

## Building from source

Only needed to change the code. Tested on **Linux (Ubuntu 24.04)**; macOS
should work but is untested; on Windows use WSL (Ubuntu).

Requirements: `git`, `bash`, `make`, Python 3, and Node.js 22 or newer. The
script below downloads Emscripten (about 1 GB) into `.emsdk/` inside the project.

```bash
git clone https://github.com/ZetaOne/XPPAUT-Web.git && cd XPPAUT-Web
scripts/setup-emsdk.sh             # Emscripten, once
npm install
npm run build:wasm                 # compile XPP; copy examples and help
npm run dev                        # open http://localhost:5173/
```

`npm run build` writes the static site to `dist/`. Pushes to `master` are built
and deployed to GitHub Pages automatically.

**Tests** (Linux): compare with the desktop XPPAUT. Extra packages:
`sudo apt install build-essential libx11-dev xvfb xdotool imagemagick python3-pil`.

```bash
scripts/build-native.sh && scripts/test-native.sh   # desktop reference build
scripts/compare-batch.sh build/headless-cc/xppaut   # numerical results
scripts/compare-gui.sh tests/gui/*.txt              # screenshots vs desktop XPP
```

## Licence

**GNU General Public License v2**, the licence of XPPAUT itself
([Ermentrout/xppaut](https://github.com/Ermentrout/xppaut)); its source files
also permit any later version. See [`LICENSE`](LICENSE).

- XPPAUT © 2002–2017 Bard Ermentrout & Daniel Dougherty.
  [Homepage](https://sites.pitt.edu/~phase/bard/bardware/xpp/xpp.html).
- It includes AUTO (E. J. Doedel) and CVODE (S. D. Cohen & A. C. Hindmarsh, LLNL).
- Changes to the XPPAUT source for this port: [`xppaut/UPSTREAM.md`](xppaut/UPSTREAM.md).
- The site icon is taken from the plot in the XPPAUT homepage banner.
