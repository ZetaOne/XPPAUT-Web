# Upstream source

This directory is the official XPPAUT 8.0 source release by Bard Ermentrout,
updated to XPPAUT 8.1 with the source Bard sent in November 2026 (see
"XPPAUT 8.1" below). Upstream files are kept unmodified apart from the
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
| `extra.c` | `add_export_list`: `malloc(l1)` to `malloc(l1+1)` (same for `l2`) | 1-byte heap overflow; any `.ode` using `export` aborts on Ubuntu's gcc and would corrupt the heap in WebAssembly |
| `auto_nox.c` | `auto_start_at_homoclinic`: `do_auto(opn,close,...)` to `do_auto(opn,cls,...)` | Typo passed the address of libc `close` as the save flag, so AUTO appended to `.b`/`.d` files instead of overwriting them |
| `gogoauto.c` | `dump_params` given a `void` return type | Implicit `int` is an error in clang |
| `parserslow.h`, `parserslow2.c` | `strupr`/`strlwr` return `char *` (and return their argument) | Emscripten's libc declares them returning `char *`; callers ignore the result |
| `eispack.c` | `get_qp`: `iv1`/`ier` declared `integer` (long) instead of `int` | Passed to `rg()`, which writes `long`s: a real overflow on 64-bit. Unused debug code (only caller is commented out), but newer clang refuses to compile it |
| `nullcline.c`, `diagram.c`, `auto_nox.c`, `auto_x11.c`, `auto.h`, `parserslow2.c`, `load_eqn.c` | Corrected return types in local declarations of `user_set_color_par`, `refresh_browser`, `go_go_auto`, `sleep`, `do_auto_win`, `nsrand48` | They disagreed with the definitions. Harmless natively, but in WebAssembly a call through a mismatched signature traps |


| `menudrive.c` | WebAssembly build only: `xpp_hlp` opens the bundled HTML help (`help/xpphelp.html`) in a browser tab | The desktop version needs XPPHELP/XPPBROWSER and fork/exec, which a browser cannot do |

| `init_conds.c` | WebAssembly build only: the file dialog keeps the file name when you change folder (`fs_keep_name`) | Upstream replaces the File field with just the folder, so Ok after navigating writes nothing |
| `main.c` | WebAssembly build only: `bye_bye` first calls `xw_before_quit()` (web/xlib/xpp_hooks.c), which writes the graphs and AUTO diagram (SVG, PostScript), a .set file and the data to `/xw-session-quit` | Quitting resets AUTO and closes the windows; the page's Save session after quitting needs them |
| `arrayplot.c` | `aplot_gif_note()`: set `indexn` (last column drawn) before writing the GIF note | Upstream never sets it, so the note named the last column "? (0)" |

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
