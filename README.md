# XPPAUT-Web

**Author:** Jeevan Kumar Gochhayat

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

## Video tour

<p>
  <a href="https://zetaone.github.io/XPPAUT-Web/videos/tour.mp4"><img src="docs/tour-preview.gif" width="69%" alt="Preview of the XPPAUT-Web tour on a computer: integrating, nullclines and a direction field with keyboard commands"></a>
  <a href="https://zetaone.github.io/XPPAUT-Web/videos/tour-phone.mp4"><img src="docs/tour-phone-preview.gif" width="26%" alt="Preview of XPPAUT-Web on a phone: the Cmd panel, integrating and continuing an orbit"></a>
</p>

*Left: on a computer. Right: on a phone (the Cmd panel, then Integrate and
Last). Click a preview to play the full 2-minute video.*

## Features

- **The real XPPAUT 8**: its C code compiled to WebAssembly. Windows match the
  desktop version pixel for pixel.
- **AUTO** for steady states, periodic orbits and bifurcation diagrams.
- **212 example models** from the XPPAUT release, or your own `.ode` file with
  its `.ani`, `.tab` and `.dat` files.
- **Window panels**: drag, resize, close, save as PNG, or pop out into a
  separate browser window. Windows are also easier to close than on the desktop.
- **Exports**: PostScript, SVG, data and `.set` files download automatically,
  or go to a folder you choose.
- **Save session**: one `.zip` with all files, screenshots of every window and
  XPP's output, offered before you restart or quit.
- **Phones**: detected automatically, with touch controls
  (see [below](#phones)).
- **Install as an app**: its own icon and window, works offline, and offers
  updates when a new version is published (see [below](#install-as-an-app)).
- **Model editor**, **XPP's terminal output**, **built-in help**, and
  **ten colour themes**.
- **Fast and private**: about 0.5 MB, near-native speed, and nothing leaves
  your browser.

## Quick start

1. Choose an example (or **Open .ode file…**) and press **Run**.
2. Use XPP as on the desktop: **I G** integrates, **N N** draws nullclines,
   **F A** opens AUTO.
3. **Save session** keeps everything; **Settings** sets where exports and output go.

Link straight to a model: `https://zetaone.github.io/XPPAUT-Web/?ode=ode/lecar.ode`

## Browsers

Nothing to install at all: the site runs in any current desktop browser.
Chrome and Edge get the fastest build; other browsers load a compatible
fallback. Tested in Chrome, Edge, Firefox and Brave.

> **Separate windows:** XPP windows opened in their own browser windows
> (**Settings → Separate windows**, or ⧉ on a window) are pop-ups. Allow
> pop-ups for this site in your browser for seamless use.

## Phones

The phone layout is chosen automatically (switch it under **Settings → View**).

- **Touch**: tap = click, drag = drag, long-press = right click. Pinch to zoom,
  two fingers to pan; **Fit** fits the window to the screen.
- **Cmd**: XPP's common commands (Integrate, Nullclines, Direction field,
  AUTO, …), one tap each.
- **⌨** opens the keyboard together with the keys phones lack: Esc, Tab, Ctrl
  and the arrows. For XPP's keyboard commands, **Gboard** (Google's keyboard)
  gives the best results; other keyboards may miss or delay keys.
- **Esc** without a keyboard: a two-finger tap, or Android's Back gesture.
- Each XPP window gets a **tab** in the toolbar; **☰** holds Files, Edit .ode,
  Settings, Save session and Restart.

> **Note: heavy simulations are not tested on phones.** Phones have less memory
> and slower processors than computers, and mobile browsers may reload a page
> that uses too much memory, losing unsaved work. Long integrations (large
> `total`, small `dt`), stiff or large systems (hundreds of variables, e.g.
> networks and arrays), large storage (`maxstor`) and long AUTO continuations
> (large `NMAX` or `NTST`) may be slow or fail. Use **Save session** often, or
> run such models on a computer.

## Install as an app

Installed, XPPAUT-Web opens in its own window from an icon, works offline, and
shows **Update** when a new version is published.

- **Android** (Chrome): tap **Install** in the toolbar, or Chrome's menu **⋮ →
  Install app** (or **Add to Home screen**).
- **Computer** (Chrome, Edge): **Install** in the toolbar, or the install icon
  in the address bar.
- **iPhone and iPad** (Safari): **Share → Add to Home Screen**. *Not tested
  yet.*

## Report a bug or give feedback

Email **jeevancodes8580@gmail.com**, or
[open an issue](https://github.com/ZetaOne/XPPAUT-Web/issues) on GitHub.
Please mention your device and browser, and attach the `.ode` file if a model
misbehaves.

## How it works

The XPPAUT source is compiled with Emscripten. XPP draws its own interface with
X11, so `web/xlib/` reimplements the 69 X11 calls it uses, and the page
(`src/`) shows each X window as a canvas. For more details, with diagrams, see
[**How XPPAUT-Web works** (PDF)](docs/how-it-works.pdf).

## Building from source

Only needed to change the code. Tested on **Linux (Ubuntu 24.04)**; macOS
should work but is untested; on Windows, use WSL (Ubuntu).

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

**GNU General Public License v2**
([Ermentrout/xppaut](https://github.com/Ermentrout/xppaut)); its source files
also permit any later version. See [`LICENSE`](LICENSE).

- XPPAUT © 2002–2017 Bard Ermentrout & Daniel Dougherty.
  [Homepage](https://sites.pitt.edu/~phase/bard/bardware/xpp/xpp.html).
- It includes AUTO (E. J. Doedel) and CVODE (S. D. Cohen & A. C. Hindmarsh, LLNL).
- Changes to the XPPAUT source for this port: [`xppaut/UPSTREAM.md`](xppaut/UPSTREAM.md).
- The site icon is taken from the plot in the XPPAUT homepage banner.
