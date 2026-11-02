/*
 * XPPAUT-Web Xlib layer: internal definitions.
 *
 * A small single-client X server inside the process. Every window and
 * pixmap has its own pixel buffer (pixels are X TrueColor values
 * 0x00RRGGBB). A top-level window's image is its own buffer with its mapped
 * children composited on top, so drawing is never lost and windows never
 * need to be repainted after being covered.
 *
 * The platform layer (platform_native.c / platform_web.c) supplies input
 * and shows top-level images; see the xw_platform_* and xw_input_*
 * functions below.
 */
#ifndef XW_H
#define XW_H

#include <stdint.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>

/* ---- fonts (fonts_data.c, generated) ----------------------------------- */
typedef struct {
  const char *name;
  int width, ascent, descent;
  const unsigned short *rows; /* 256 glyphs x (ascent+descent) rows; bit x = pixel x */
} xw_font_data;
extern const xw_font_data xw_fonts[];

/* ---- colour names (colors_data.c, generated from rgb.txt) -------------- */
typedef struct {
  const char *name;
  unsigned char r, g, b;
} xw_color_name;
extern const xw_color_name xw_color_names[];

/* ---- drawables ---------------------------------------------------------- */
enum { XW_BG_PIXEL, XW_BG_PIXMAP, XW_BG_NONE };

typedef struct xw_drawable xw_drawable;
struct xw_drawable {
  XID id;
  int is_window;
  int width, height, depth;
  uint32_t *pix; /* width*height pixels */

  /* windows only */
  xw_drawable *parent;
  xw_drawable **children; /* stacking order, bottom first */
  int nchildren, cap_children;
  int x, y, border_width;
  unsigned long border_pixel;
  int bg_kind;
  unsigned long bg_pixel;
  uint32_t *bg_tile; /* private copy: X keeps a background pixmap alive after
                        XFreePixmap, and XPP frees it immediately */
  int bg_tw, bg_th;
  int mapped;
  long event_mask;
  int override_redirect;
  int input_only;
  Cursor cursor;
  char *title;
  int min_width, min_height;
  int pos_hint; /* program supplied a position */
};

/* ---- GC ------------------------------------------------------------------ */
struct _XGC {
  XExtData *ext_data;
  GContext gid;
  XGCValues v;
  char dashes[16];
  int ndashes;
};

/* ---- core (xlib.c) ------------------------------------------------------- */
extern Display *xw_display;
extern int xw_bare_x; /* set by the platform; see xlib.c */
xw_drawable *xw_lookup(XID id);
xw_drawable *xw_root(void);
xw_drawable *xw_toplevel_of(xw_drawable *w);
int xw_viewable(xw_drawable *w);
void xw_mark_dirty(xw_drawable *d);
void xw_root_origin(xw_drawable *w, int *x, int *y); /* content origin in root coords */

/* top-levels, for the platform: children of the root, bottom first */
int xw_toplevels(Window *out, int max);
int xw_toplevel_dirty(Window w);
/* composite a top-level into an RGBA (bytes R,G,B,A) buffer owned by the
   library; valid until the next call for the same window */
uint8_t *xw_render(Window w, int *width, int *height);
const char *xw_title(Window w);

/* input from the platform; coordinates are root coordinates */
void xw_input_motion(int x, int y, unsigned state);
void xw_input_button(int x, int y, int button, int press, unsigned state);
void xw_input_key(KeySym keysym, const char *text, int press, unsigned state);
void xw_input_configure(Window top, int x, int y, int w, int h);
void xw_input_close(Window top);
void xw_input_raise(Window top);
int xw_queue_length(void);

/* ---- drawing (draw.c) ---------------------------------------------------- */
void xw_fill_rect(xw_drawable *d, GC gc, int x, int y, int w, int h);
void xw_line(xw_drawable *d, GC gc, int x0, int y0, int x1, int y1);
void xw_point(xw_drawable *d, GC gc, int x, int y);
void xw_arc(xw_drawable *d, GC gc, int x, int y, int w, int h, int a1, int a2, int fill);
void xw_text(xw_drawable *d, GC gc, int x, int y, const char *s, int n);
void xw_clear_area(xw_drawable *w, int x, int y, int width, int height);
const xw_font_data *xw_font_for(Font fid);

/* ---- platform (platform_*.c) --------------------------------------------- */
/* Called when XPP waits for input and the queue is empty. Must eventually
   queue an event, or return so the caller can poll again. */
void xw_platform_wait(void);
/* Called from XPending/XFlush: a chance to show progress during long runs. */
void xw_platform_poll(void);
void xw_platform_bell(void);
/* A top-level was mapped, unmapped, raised, moved/resized or retitled. */
void xw_platform_toplevel_changed(Window w);
void xw_platform_cursor(Window w, int shape);
int xw_platform_screen_width(void);
int xw_platform_screen_height(void);

#endif
