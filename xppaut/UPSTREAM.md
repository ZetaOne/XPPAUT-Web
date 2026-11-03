# Upstream source

This directory is the official XPPAUT 8.0 source release by Bard Ermentrout,
kept unmodified so web-specific changes stay visible in git history.

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

| `main.c`, `many_pops.c` | Handle `WM_DELETE_WINDOW` for graph windows made with Makewindow: `close_graph_window()` destroys that graph | The handler was commented out, so the window manager's close button did nothing; the web page's close button now works on every window (other windows are closed by pressing their own Close button) |

| `menudrive.c` | WebAssembly build only: `xpp_hlp` opens the bundled HTML help (`help/xpphelp.html`) in a browser tab | The desktop version needs XPPHELP/XPPBROWSER and fork/exec, which a browser cannot do |

| `init_conds.c` | WebAssembly build only: the file dialog keeps the file name when you change folder (`fs_keep_name`) | Upstream replaces the File field with just the folder, so Ok after navigating writes nothing |

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

The AUTO fix and the close handling are deliberate behaviour differences from the unpatched desktop build.
