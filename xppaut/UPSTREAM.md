# Upstream source

This directory is the official XPPAUT 8.0 source release by Bard Ermentrout,
updated to XPPAUT 8.1, 8.2 and 8.4 (including its updates of 21 and 23 November) with the source Bard sent in November 2026 (see
"XPPAUT 8.1", "XPPAUT 8.2" and "XPPAUT 8.4" below). Upstream files are kept unmodified apart from the
patches listed here, so web-specific changes stay visible in git history.

- Source: https://sites.pitt.edu/~phase/bard/bardware/xpp/xppaut8.0.tgz
- Archive date: 2023-11-22
- SHA-256: d0a2d2c7a6bef9bbee879190e081d01c52ec46784085c05a43f99cca22ecc7a8
- Licence: GNU GPL v2 (see LICENSE)

Removed when importing (not source, not needed):

- macOS metadata files (`._*`) and editor backups (`*~`)
- Prebuilt binaries: `ode/a.out`, `ode/example.o`, `ode/example.so`, `ode/efmxt.so`
- Java tools: `XppBetty-1.2.6.jar`, `XppBettyGui-1.2.6.jar`

The GitHub repository github.com/Ermentrout/xppaut was last updated in
February 2016 and is older than this release, so it is not used.

## Patches

Changes to upstream files are marked with `XPPAUT-Web:` comments.

| File | Change | Why |
|---|---|---|
| `extra.c` | Gave the no-DLL stub functions proper return types and defined `MAXW` there | The no-DLL branch did not compile with clang (and `MAXW` was only defined in the DLL branch) |
| `extra.c` | ~~`add_export_list`: `malloc(l1)` to `malloc(l1+1)`~~ | Fixed upstream in the 23 November 2026 source; no longer a patch |
| `auto_nox.c` | `auto_start_at_homoclinic`: `do_auto(opn,close,...)` to `do_auto(opn,cls,...)` | Typo passed the address of libc `close` as the save flag, so AUTO appended to `.b`/`.d` files instead of overwriting them |
| `gogoauto.c` | `dump_params` given a `void` return type | Implicit `int` is an error in clang |
| `parserslow.h`, `parserslow2.c` | `strupr`/`strlwr` return `char *` (and return their argument) | Emscripten's libc declares them returning `char *`; callers ignore the result |
| `eispack.c` | `get_qp`: `iv1`/`ier` declared `integer` (long) instead of `int` | Passed to `rg()`, which writes `long`s: a real overflow on 64-bit. Unused debug code (only caller is commented out), but newer clang refuses to compile it |
| `nullcline.c`, `diagram.c`, `auto_nox.c`, `auto_x11.c`, `auto.h`, `parserslow2.c`, `load_eqn.c` | Corrected return types in local declarations of `user_set_color_par`, `refresh_browser`, `go_go_auto`, `sleep`, `do_auto_win`, `nsrand48` | They disagreed with the definitions. Harmless natively, but in WebAssembly a call through a mismatched signature traps |


| `menudrive.c` | WebAssembly build only: `xpp_hlp` opens the bundled HTML help (`help/xpphelp.html`) in a browser tab | The desktop version needs XPPHELP/XPPBROWSER and fork/exec, which a browser cannot do |

| `init_conds.c` | WebAssembly build only: the file dialog keeps the file name when you change folder (`fs_keep_name`) | Upstream replaces the File field with just the folder, so Ok after navigating writes nothing |
| `main.c` | WebAssembly build only: `bye_bye` first calls `xw_before_quit()` (web/xlib/xpp_hooks.c), which writes the graphs and AUTO diagram (SVG, PostScript), a .set file and the data to `/xw-session-quit` | Quitting resets AUTO and closes the windows; the page's Save session after quitting needs them |
| `arrayplot.c` | `aplot_gif_note()`: set `indexn` (last column drawn) before writing the GIF note | Upstream never sets it, so the note named the last column "? (0)" |
| `dde_po_xpp.c` | Declare `redraw_auto_menus()` as `void`, as `auto_x11.c` defines it | Declared `int` there: harmless on the desktop, but in WebAssembly a call through the wrong signature traps ("unreachable"), so Run -> Periodic on a delay equation crashed |
| `surface.c` | `<stdlib.h>` instead of `stdfix.h`; new `surface_export()` | `stdfix.h` declares libc without prototypes (as before); `surface_export()` lets Save session write the Surface view (web/xlib/xpp_hooks.c) |
| `pop_list.c` | WebAssembly build only: in `xpp_next_event()`, a script's timed wait calls `xppweb_script_wait(ms)` (web/xlib/platform_web.c) instead of `select()` on the X connection | There is no X connection in the browser; the page must get a turn (to draw, and to deliver the key that ends a `pause`) while a script waits |
| `xpp_script.c` | WebAssembly build only: `script_run_from_menu()` runs the script named in `xppweb_script_pick` (set by the page's Scripts menu through `xw_pick_script`) instead of opening the file selector | XPP's file selector is small on phones; the page lists the scripts and starts the chosen one through XPP's own File -> Do script |
| `xpp_script.c` | WebAssembly build only: `shot name.png` (and `shot auto name.png`) saves the graph or AUTO diagram as on screen, as PNG at twice the size (`xppweb_shot_png`, web/xlib/xpp_hooks.c) | A picture that phones show directly; .ps/.svg need another app |
| `xpp_script.c` | WebAssembly build only: `xw_script_line()` / `xw_script_name()` report the line of the command now running | The editor marks the running line of a script with an arrow |

### Fixes from Bard Ermentrout (2025)

Bard sent an updated `xppaut8.0.tgz` (files dated January 2025, SHA-256
597400ce825a8acd06670aa4301efba1430a8f89e86a4301208a66b2d98a1681). Taken from it:

| File | Change | Why |
|---|---|---|
| `gogoauto.c` | Two-parameter **restart** cases use the fold/Hopf starting routines (`stpnlp`, `stpnhb`, `stpnhw`) instead of `stpnae` | Every point of a fold or Hopf curve is itself a fold or Hopf point, so the start is recomputed there; restarted curves agree with the old start to about 6 digits (tests/gui/auto2par.txt) |
| `auto_nox.c` | `itp2=abs(itp/10)` (written as `itp2=itp/10; if(itp2<0)itp2=-itp2;`); run the homoclinic start only `if(flag>0)` | Point types can be negative (AUTO-07p also uses `ABS(ITP/10)`). Written out because GCC 13 at -O2 miscompiles `abs(itp/10)==3` with the `abs` macro from `auto_f2c.h`: on points of a two-parameter Hopf curve (type 34) XPP then skipped the Hopf menu, ran Extend and crashed |
| `init_conds.c` | No `waitasec(ClickTime)` when the Parameters window is resized | Needless pause |

Not taken from it: `#include <stdlib.h>` replaced by `#include "stdfix.h"` in
about 70 files (that header is not in the archive; GCC's unrelated
fixed-point `stdfix.h` hides this, other compilers fail), hand-written
`malloc`/`free` declarations in `simplenet.c` and `delay_handle.c`, a debug
`printf` in AUTO, and a moved `dump_params` (same as the fix above).

The AUTO fix is a deliberate behaviour difference from the unpatched desktop build.
(Until 13 November 2026 a patch here also handled the window manager's close
button on Makewindow graphs; XPPAUT 8.1 now does that itself, see below.)

### XPPAUT 8.1 (Bard Ermentrout, November 2026)

Bard sent the XPPAUT 8.1 source (`xpp8p1src.tgz`, SHA-256
450042e2cf2e88493721654c02353dfc5c028b340d2c394c1eab59a19f405194). It was merged three-way
(XPPAUT 8.0 as imported → this directory → 8.1), so the patches above stay.

New files: `periodic_ic.c` (Initialconds → Periodic), `phase_red.c`,
`phase_red.h` (phase reduction: adjoint, isostable response, Floquet
eigenfunction, correction B, H2), `hopf_l1.c` (first Lyapunov coefficient on
two-parameter Hopf curves, GH points). Changed: `adj2.c`, `menudrive.c`,
`menudrive.h`, `menus.h`, `kbs.h` (menus), `integrate.c`, `auto_nox.c`
(Hopf colouring, GH), `gogoauto.c` (`dump_params` moved up), `auto_f2c.h`
(no `abs` macro), `Makefile` (the new files; also `web/objects.txt`).

Not taken from it, as before: `#include "stdfix.h"` instead of
`<stdlib.h>` (its `stdfix.h` declares `malloc`, `abs`, `exit` without
prototypes), hand-written libc declarations in `simplenet.c` and
`delay_handle.c`, debug `printf`s (one in `auto_nox.c` printed on every AUTO
run), and comment-only changes. Where 8.1 has a 2025 fix that is already here
(`gogoauto.c` starting routines, `itp2`, `do_auto(...,cls,...)`), the annotated
version here was kept.

Checked: `scripts/compare-batch.sh` gives 144 SAME, 9 NOOUT (the batch results
are unchanged); in the browser, Periodic (T = 63.7247632515 for
`examples/xpp81/periodic-phase.ode`, as the desktop build), the adjoint and
isostable checks it prints (Z.f = 1 to 1e-7), and the Hopf curve with two GH
points for `examples/xpp81/hopf-gh.ode`.

### XPPAUT 8.1 update (Bard Ermentrout, 13 November 2026)

`update_xppsrc8.1.tgz` (SHA-256 a9adfb2c0c4e743decd6f2b93d257bec316e67740d204cf15d6bbf8dcdab3a71), merged
three-way on top of the 8.1 source above (one conflict, whitespace in an
include line of `scrngif.c`). Nine files: `scrngif.c`, `scrngif.h`,
`kinescope.c`, `aniparse.c`, `arrayplot.c` (every GIF carries the model, the
parameters, date, numerics and a note on its contents, as a GIF comment and as
text after the end marker; GIF89a; the array plot's time range includes the
transient), `browse.c`, `browse.h`, `histogram.c` (`get_browser_rows()`: the
Fourier transform and histograms use the length of the data shown in the
browser, not of the stored solution, so they work on the adjoint, H, ...),
`Makefile` (version 8.1, `extras` and `srconly` targets).

The version passed to the compiler is now `MYSTR1=8.1 MYSTR2=1` (as in
Bard's Makefile; `web/Makefile`), so windows show "XPP Ver 8.1.1" and GIFs
"XPPAUT 8.1.1".

Checked: batch 144 SAME, 9 NOOUT; in the browser a Kinescope GIF (GIF89a,
comment read by Pillow) and Fourier on the adjoint data.

### XPPAUT 8.1 source of 13 November 2026 (Bard Ermentrout)

`xppsrc11_13.tgz` (SHA-256 a8044564581b9afe2e462275727b4ad5c84a9d9d8be7585ddc74401ff5ce6e9a), merged
three-way on top of the update above. 21 files changed; one conflict in
`main.c`, where Bard's handling of the window manager's close button
replaced ours (our `close_graph_window()` patch in `main.c` and
`many_pops.c` is gone; `destroy_graph_window()` in `many_pops.c` does it).

- Close button of the window manager on every window (`pop_list.c`:
  `wm_register_close`, `xpp_next_event` in place of `XNextEvent`): it presses
  the window's own Close/Cancel button; on the main window it asks
  "Are you sure?"; on a Makewindow graph it destroys that graph.
- Buttons made with `make_button()` get a light/dark bevel and a hover
  colour; button labels "Ok"/"Okay" are now "OK", "Kill" (text viewer) and
  "Quit" (calculator) are "Close".
- An X error handler that ignores BadWindow/BadDrawable/BadPixmap
  (a request on a window that was just destroyed no longer exits XPP).
- `integrate.c`: the progress bar and the Esc check run about 50 times a
  second instead of at every output point (faster long runs).

The web Xlib layer gained `XDrawSegments`, `XSetErrorHandler` and
`XGetErrorText` for it (web/xlib/xlib.c).

Patch on top of it: `arrayplot.c` `aplot_gif_note()` sets `indexn` (the last
column drawn) before writing the note; upstream never sets it, so the GIF note
read "columns U1 (1) ... ? (0)".

### XPPAUT 8.2 (Bard Ermentrout, 15 November 2026)

`xppsrc8.2.tgz` (SHA-256 4b5dea682b00909ab2da8f1b3368d322afc3b5615b1cd9dfed9e6d5e8ca5b38a), merged
three-way on top of the 13 November source; no conflicts. Example delay
equations came with it (`deltstode.tgz`, SHA-256
38ea147a8558a07f55e49b22f778dcacbbca98a59e48836437f7f0ab9f8a1195); they are in
`examples/xpp82/` with `surface-cable.ode`.

- New files: `dde_po.c`, `dde_po.h`, `dde_po_xpp.c` (periodic orbits of delay
  equations: from a simulation or a Hopf point, Floquet multipliers, period
  doubling, two-parameter Hopf, PD, fold and torus curves), `del_spec.c`
  (spectrum of delay equations), `surface.c`, `surface.h` (Surface view of
  the array plot: rotate, zoom, GIF/PS/SVG). Also in `web/objects.txt`.
- Changed: `delay_handle.c/.h`, `del_stab.c/.h`, `odesol2.c`, `gear.c`,
  `volterra2.c`, `integrate.c` (delay handling), `auto_nox.c`, `autpp.c`,
  `autlib1.c`, `autlib3.c`, `hopf_l1.c` (AUTO on delay equations),
  `arrayplot.c` (Surface button), `do_fit.c`, `main.c`, `many_pops.c`,
  `Makefile` (version 8.2.2: `web/Makefile` passes `MYSTR1=8.2 MYSTR2=2`).
- Bard's `Makefile` lists `del_spec.o` but not `del_spec.c` among the sources
  (only matters for its `srconly` target).

The web Xlib layer gained `XFillPolygon` (a scan-line fill in
`web/xlib/draw.c`), `XDrawLines`, `XSync` and `XGetGCValues` for the surface
plot.

Delay equations are integrated differently from 8.1, so 8 batch examples,
all with delays (`dde`, `junk`, `fr`, `dlog`, `myret`, `sine-circel`,
`delay`, `vtst`), give slightly different numbers than 8.1. Against the 8.2
desktop build: 144 SAME, 9 NOOUT. Checked in the browser (both engines):
`two_delays.ode` Hopf at a = 0.633595 (exact 0.633594) and the periodic
branch from it; `mg.ode` Hopf at beta = 1.33687 and period doubling at
1.5554491 (as Bard's comment); the Surface view matches the desktop build,
rotates, and saves GIF, EPS and SVG.

### XPPAUT 8.4 (Bard Ermentrout, 19 November 2026)

`xppsrc8.4.tgz` (SHA-256 fa5f7266ef2c9f409f125e7402b88a6626de2a22d9f73cbba2bd28e891639e94),
merged three-way on top of 8.2. One conflict, in `auto_x11.c`
(`traverse_diagram`): Bard moved the Grab code into `auto_grab_point()`, and
the merge keeps his version. His manual came with it as `script_doc.html`
(in `help/`, so the site serves it).

- New files: `xpp_script.c`, `xpp_script.h` (scripting: `set`, `keys`,
  `autokeys`, `ans`/`ok`/`cancel`, `click`/`drag`, `msg`, `pause`, `wait`,
  `speed`, `shot`, `auto goto`/`auto list`, `for`/`repeat`, `try`/`else`;
  File -> Do script, `-script`, `-nopause`, `-scriptexit`). Also in
  `web/objects.txt`.
- Changed: `pop_list.c` (the script runs from `xpp_next_event()` when XPP is
  idle; dialogs ask the script for answers), `auto_x11.c` (`auto_goto_point`,
  `auto_list_points`, `auto_key_window`), `comline.c` (options), `main.c`,
  `menu.c`, `menus.h` (Do script), `dialog_box.c`, `ggets.c`, `graf_par.c`,
  `graphics.c`, `init_conds.c`, `rubber.c` (scripted answers and mouse),
  `autlib1.c`, `auto_nox.c`, `diagram.c/.h`, `dde_po_xpp.c`, `load_eqn.c`,
  `many_pops.c`, `my_ps.h`, `periodic_ic.c`, `read_dir.c`, `txtread.c`,
  `Makefile` (version 8.4.2: `web/Makefile` passes `MYSTR1=8.4 MYSTR2=2`).

The web Xlib layer gained `XLookupKeysym`. The page brings an example's
scripts (`foo.xps` and `foo-*.xps` for `foo.ode`) into XPP's folder, accepts
`.xps` files from Open/Add files, and `?script=name.xps` passes
`-script name.xps`. Examples: `examples/xpp84/` (group "8.4-scripting-xpp").

Batch outputs: against the 8.4 desktop build, 144 SAME, 9 NOOUT. Every
example script was run on the desktop build (under Xvfb, `-scriptexit`) and
in the browser (both engines, including File -> Do script and the pauses of
`lecar-tutorial.xps`); each picture they save is byte for byte the same size
as the desktop's. `hutch-try.xps` (the manual's example 6c, made visible:
each pass shown, periodic orbits from the Hopf point, the last diagram kept
and saved as SVG) gives the same messages and the same `hutch-try.svg`, byte
for byte, in Bard's unmodified 8.4 build and in the browser (both engines).

Notes for Bard: in his e-mail example the line `i g` must be `keys i g`
("unknown command"); and the manual's `keys g f a` (Auto-freeze) is `keys g f
o` (the Freeze menu's keys are `f d e r k b c o`; `a` is ignored silently).

### XPPAUT 8.4 update (Bard Ermentrout, 21 November 2026)

`newversion.zip` (SHA-256 aaab20d4c343827d61a2104a7359b713078bf4ce241b6294dd413c40aa06a8e2):
`xppsrc8.4.tgz` (SHA-256 96e069300ea4af358459b3cf9f4da75a7794d36f750ef26ac101690addef385d)
and `xpp_doc.pdf` (the manual, updated; replaces the old one here and is
served as `help/xpp_doc.pdf`). Version still 8.4.2. Merged three-way on top
of the 19 November 8.4; three conflicts, all both sides adding code:
`main.c` (`script_record_stop()` before our `xw_before_quit()`), `txtread.c`
(our `<stdlib.h>` instead of `stdfix.h`, plus his `get_key_press_nr()`
declaration, which matches the definition), `xpp_script.c` (his
`default_script_name()`, then our page-picked script).

- New file: `lyapunov.c` (Lyapunov exponents by the QR method, complete
  spectrum for N < 8, own adaptive Dormand-Prince integrator in double
  precision; Numerics -> stocHast -> Liapunov). Also in `web/objects.txt`.
- Changed: `xpp_script.c/.h` (recording: File -> recOrd script, and the
  `XPP_RECORD` environment variable), `menu.c`, `menus.h`, `main.c`,
  `pop_list.c`, `dialog_box.c`, `ggets.c`, `init_conds.c`, `auto_x11.c`,
  `browse.c`, `edit_rhs.c`, `eig_list.c`, `txtread.c`, `rubber.c`,
  `arrayplot.c`, `adj2.c`, `Makefile`.

Batch outputs: 144 SAME, 9 NOOUT. Lorenz (r=28): the browser gives lambda =
0.8617, -0.0138, -14.5145, sum -13.6667 = divergence, Kaplan-Yorke 2.0584,
the same as the desktop build (both engines). Recording in the browser gives
the same file as the desktop build driven by xdotool ("keys i g n n", the
stop keys left out). Examples: `examples/bard-renew/` (all script examples,
formerly `examples/xpp84/`; old `xpp84/...` links still work), with
`lorenz.ode` + `lorenz-lyapunov.xps` and `lecar-recorded.xps`.

### XPPAUT 8.4 update (Bard Ermentrout, 23 November 2026)

`xppsrc8.4.tgz` (SHA-256 903e2fcecf34613daaa084cc4741aedbb74c906a39615434e5e02f1f4948a326),
merged three-way on top of the 21 November source. The one conflict,
`extra.c`, is our old patch: Bard now allocates `l1+1`, `l2+1` himself, so
our patch is dropped (marked in the table above).

- AUTO labels (a fix found by the author of XPP-Lab): after Clear grab, a
  new start whose old diagram is kept numbered its labels and branches from
  1 again. `diagram_max_ids()` (`diagram.c/.h`) and `auto_nox.c` now start
  after the diagram's own, and keep the restart data of the old points.
- Saved diagrams use `%.17g` (they read back exactly); other changes in
  `aniparse.c`, `autlib1.c`, `autlib5.c`, `auto_c.h`, `cv2.c`, `form_ode.c`,
  `gogoauto.c`, `integrate.c`, `load_eqn.c`, `parserslow2.c`, `simplenet.c`,
  `volterra2.c`, `Makefile`.

Batch outputs: 144 SAME, 9 NOOUT. Checked with `lecar-two-diagrams.xps`
(two steady-state diagrams, Clear grab between, the old one kept): the second
diagram's points are labels 6 and 7 on branch 2 in the desktop build and in
the browser (both engines); the 19 November build gave labels 1 and 2 on
branch 1 again.
