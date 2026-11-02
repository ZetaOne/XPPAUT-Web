/*
 * XPPAUT-Web Xlib layer: browser platform (Emscripten + Asyncify).
 *
 * The page (src/xpp.ts) owns a window manager: one panel with a <canvas>
 * per top-level X window. All calls between JS and C are synchronous and
 * happen while XPP is waiting:
 *
 *   C -> JS  Module.xppPresent()     repaint dirty top-levels, sync panels
 *   C -> JS  Module.xppDrainInput()  deliver queued mouse/keyboard input by
 *                                    calling the exported xw_input_* functions
 *   then     emscripten_sleep()      give the browser a turn (Asyncify)
 */
#include <emscripten.h>
#include <X11/Xlib.h>
#include "xw.h"

EM_JS(void, js_present, (void), { if (Module.xppPresent) Module.xppPresent(); });
EM_JS(void, js_drain_input, (void), { if (Module.xppDrainInput) Module.xppDrainInput(); });
EM_JS(void, js_bell, (void), { if (Module.xppBell) Module.xppBell(); });
EM_JS(void, js_busy, (int busy), { if (Module.xppBusy) Module.xppBusy(busy); });
EM_JS(void, js_open_help, (void), { if (Module.xppOpenHelp) Module.xppOpenHelp(); });

/* called by XPP's File/Help (patched xpp_hlp in menudrive.c) */
void xppweb_open_help(void) { js_open_help(); }
EM_JS(void, js_toplevel_changed, (Window w), { if (Module.xppToplevelChanged) Module.xppToplevelChanged(w); });
EM_JS(void, js_cursor, (Window w, int shape), { if (Module.xppCursor) Module.xppCursor(w, shape); });
EM_JS(int, js_screen_width, (void), { return Module.xppScreenWidth ? Module.xppScreenWidth() : 1280; });
EM_JS(int, js_screen_height, (void), { return Module.xppScreenHeight ? Module.xppScreenHeight() : 1024; });

static double last_yield;

static void yield(int ms)
{
  js_present();
  emscripten_sleep(ms);
  js_drain_input();
  last_yield = emscripten_get_now();
}

void xw_platform_wait(void)
{
  js_busy(0); /* XPP is waiting for input */
  js_drain_input();
  if (xw_queue_length()) return;
  yield(10);
}

void xw_platform_poll(void)
{
  /* XPending/XFlush are called constantly during long computations; let
     the browser paint and take input about 30 times a second */
  if (emscripten_get_now() - last_yield > 33) {
    js_busy(1); /* XPP is computing and only polling for input */
    yield(0);
  }
}

void xw_platform_bell(void) { js_bell(); }
void xw_platform_toplevel_changed(Window w) { js_toplevel_changed(w); }
void xw_platform_cursor(Window w, int shape) { js_cursor(w, shape); }
int xw_platform_screen_width(void) { return js_screen_width(); }
int xw_platform_screen_height(void) { return js_screen_height(); }

/* geometry for the page's window manager: x, y, width, height, mapped */
EMSCRIPTEN_KEEPALIVE int xw_toplevel_info(Window w, int *out)
{
  xw_drawable *t = xw_lookup(w);
  if (!t || t->parent != xw_root()) return 0;
  out[0] = t->x;
  out[1] = t->y;
  out[2] = t->width;
  out[3] = t->height;
  out[4] = t->mapped;
  return 1;
}
