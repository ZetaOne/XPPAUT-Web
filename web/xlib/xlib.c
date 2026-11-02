/*
 * XPPAUT-Web Xlib layer: display, resources, windows, events.
 * See xw.h for the design.
 */
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/Xatom.h>
#include <X11/XKBlib.h>
#include <X11/keysym.h>
#include "xw.h"

/* ------------------------------------------------------------------------ */
/* resources                                                                */

#define MAX_RES 8192
static xw_drawable *res[MAX_RES]; /* indexed by XID - XID_BASE */
#define XID_BASE 0x200000
static XID next_xid = XID_BASE + 1;

Display *xw_display;
static Screen xw_screen;
static Visual xw_visual;
static Depth xw_depth;
static xw_drawable *root;
static unsigned long serial;

static void *xcalloc(size_t n, size_t s)
{
  void *p = calloc(n ? n : 1, s);
  if (!p) { fprintf(stderr, "xlib: out of memory\n"); abort(); }
  return p;
}

static XID new_xid(void)
{
  for (int i = 0; i < MAX_RES; i++) {
    XID id = next_xid++;
    if (next_xid >= XID_BASE + MAX_RES) next_xid = XID_BASE + 1;
    if (!res[id - XID_BASE]) return id;
  }
  fprintf(stderr, "xlib: out of resource ids\n");
  abort();
}

xw_drawable *xw_lookup(XID id)
{
  if (id <= XID_BASE || id >= XID_BASE + MAX_RES) return NULL;
  return res[id - XID_BASE];
}

xw_drawable *xw_root(void) { return root; }

static xw_drawable *new_drawable(int is_window, int w, int h, int depth)
{
  xw_drawable *d = xcalloc(1, sizeof *d);
  d->id = new_xid();
  d->is_window = is_window;
  d->width = w > 0 ? w : 1;
  d->height = h > 0 ? h : 1;
  d->depth = depth;
  d->pix = xcalloc((size_t)d->width * d->height, sizeof(uint32_t));
  res[d->id - XID_BASE] = d;
  return d;
}

static void free_drawable(xw_drawable *d)
{
  res[d->id - XID_BASE] = NULL;
  free(d->pix);
  free(d->children);
  free(d->title);
  free(d->bg_tile);
  free(d);
}

static void resize_buffer(xw_drawable *d, int w, int h)
{
  if (w < 1) w = 1;
  if (h < 1) h = 1;
  if (w == d->width && h == d->height) return;
  uint32_t *p = xcalloc((size_t)w * h, sizeof(uint32_t));
  int cw = w < d->width ? w : d->width, ch = h < d->height ? h : d->height;
  for (int y = 0; y < ch; y++)
    memcpy(p + (size_t)y * w, d->pix + (size_t)y * d->width, cw * sizeof(uint32_t));
  free(d->pix);
  d->pix = p;
  d->width = w;
  d->height = h;
}

static int tracing(void)
{
  static int trace = -1;
  if (trace < 0) trace = getenv("XPPWEB_TRACE") != NULL;
  return trace;
}

/* ------------------------------------------------------------------------ */
/* window tree                                                              */

xw_drawable *xw_toplevel_of(xw_drawable *w)
{
  if (!w || !w->is_window || w == root) return NULL;
  while (w->parent && w->parent != root) w = w->parent;
  return w;
}

int xw_viewable(xw_drawable *w)
{
  for (; w && w != root; w = w->parent)
    if (!w->mapped) return 0;
  return w == root;
}

void xw_root_origin(xw_drawable *w, int *x, int *y)
{
  int ax = 0, ay = 0;
  for (; w && w != root; w = w->parent) {
    if (w->parent == root) { ax += w->x; ay += w->y; } /* WM owns top-level borders */
    else { ax += w->x + w->border_width; ay += w->y + w->border_width; }
  }
  *x = ax;
  *y = ay;
}

static int top_dirty[MAX_RES];

void xw_mark_dirty(xw_drawable *d)
{
  xw_drawable *t = xw_toplevel_of(d);
  if (t) top_dirty[t->id - XID_BASE] = 1;
}

static void add_child(xw_drawable *p, xw_drawable *c)
{
  if (p->nchildren == p->cap_children) {
    p->cap_children = p->cap_children ? 2 * p->cap_children : 8;
    p->children = realloc(p->children, p->cap_children * sizeof *p->children);
  }
  p->children[p->nchildren++] = c;
  c->parent = p;
}

static void remove_child(xw_drawable *p, xw_drawable *c)
{
  for (int i = 0; i < p->nchildren; i++)
    if (p->children[i] == c) {
      memmove(p->children + i, p->children + i + 1, (p->nchildren - i - 1) * sizeof *p->children);
      p->nchildren--;
      return;
    }
}

static int is_ancestor(xw_drawable *a, xw_drawable *w)
{
  for (; w; w = w->parent)
    if (w == a) return 1;
  return 0;
}

/* ------------------------------------------------------------------------ */
/* event queue                                                              */

#define QSIZE 4096
static XEvent queue[QSIZE];
static int qhead, qlen;

int xw_queue_length(void) { return qlen; }

static void enqueue(XEvent *ev)
{
  if (qlen == QSIZE) { /* drop oldest motion-style overflow */
    qhead = (qhead + 1) % QSIZE;
    qlen--;
  }
  ev->xany.serial = ++serial;
  ev->xany.display = xw_display;
  queue[(qhead + qlen) % QSIZE] = *ev;
  qlen++;
}

#include <time.h>
static Time now_ms(void)
{
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (Time)(ts.tv_sec * 1000 + ts.tv_nsec / 1000000);
}

static void send_expose(xw_drawable *w, int x, int y, int width, int height)
{
  if (!(w->event_mask & ExposureMask) || !xw_viewable(w)) return;
  XEvent ev;
  memset(&ev, 0, sizeof ev);
  ev.type = Expose;
  ev.xexpose.window = w->id;
  ev.xexpose.x = x;
  ev.xexpose.y = y;
  ev.xexpose.width = width;
  ev.xexpose.height = height;
  ev.xexpose.count = 0;
  enqueue(&ev);
}

static void send_structure(xw_drawable *w, int type)
{
  if (!(w->event_mask & StructureNotifyMask)) return;
  XEvent ev;
  memset(&ev, 0, sizeof ev);
  ev.type = type;
  ev.xany.window = w->id;
  if (type == ConfigureNotify) {
    ev.xconfigure.event = w->id;
    ev.xconfigure.window = w->id;
    ev.xconfigure.x = w->x;
    ev.xconfigure.y = w->y;
    ev.xconfigure.width = w->width;
    ev.xconfigure.height = w->height;
    ev.xconfigure.border_width = w->border_width;
  } else if (type == MapNotify) {
    ev.xmap.event = w->id;
    ev.xmap.window = w->id;
  } else if (type == UnmapNotify) {
    ev.xunmap.event = w->id;
    ev.xunmap.window = w->id;
  }
  enqueue(&ev);
}

/* Expose w and every mapped descendant (they just became viewable). */
static void expose_tree(xw_drawable *w)
{
  if (!w->mapped) return;
  send_expose(w, 0, 0, w->width, w->height);
  for (int i = 0; i < w->nchildren; i++) expose_tree(w->children[i]);
}

/* ------------------------------------------------------------------------ */
/* pointer, focus, grabs                                                    */

static int ptr_x, ptr_y;          /* root coordinates */
static xw_drawable *ptr_win;      /* deepest viewable window under pointer */
static xw_drawable *grab_win;     /* implicit grab after ButtonPress */
static unsigned buttons_down;
static Window focus = PointerRoot;
static Window active_top;         /* last top-level raised or mapped (WM focus) */

static xw_drawable *window_at(xw_drawable *w, int x, int y)
{
  /* x, y relative to w's content origin; children searched top first */
  for (int i = w->nchildren - 1; i >= 0; i--) {
    xw_drawable *c = w->children[i];
    if (!c->mapped) continue;
    int bw = w == root ? 0 : c->border_width;
    int cx = c->x, cy = c->y;
    if (x >= cx && y >= cy && x < cx + c->width + 2 * bw && y < cy + c->height + 2 * bw)
      return window_at(c, x - cx - bw, y - cy - bw);
  }
  return w;
}

static void rel_coords(xw_drawable *w, int rx, int ry, int *x, int *y)
{
  int ox, oy;
  xw_root_origin(w, &ox, &oy);
  *x = rx - ox;
  *y = ry - oy;
}

static void fill_pointer_event(XEvent *ev, xw_drawable *w, unsigned state)
{
  int x, y;
  rel_coords(w, ptr_x, ptr_y, &x, &y);
  ev->xany.window = w->id;
  ev->xbutton.root = root->id;
  ev->xbutton.subwindow = None;
  ev->xbutton.time = now_ms();
  ev->xbutton.x = x;
  ev->xbutton.y = y;
  ev->xbutton.x_root = ptr_x;
  ev->xbutton.y_root = ptr_y;
  ev->xbutton.state = state;
  ev->xbutton.same_screen = True;
}

/* deliver to w or the first ancestor selecting mask; returns receiver */
static xw_drawable *propagate(XEvent *ev, xw_drawable *w, long mask, unsigned state)
{
  for (; w && w != root; w = w->parent)
    if (w->event_mask & mask) {
      fill_pointer_event(ev, w, state);
      enqueue(ev);
      return w;
    }
  return NULL;
}

static void crossing(xw_drawable *w, int type, int detail, unsigned state)
{
  if (!(w->event_mask & (type == EnterNotify ? EnterWindowMask : LeaveWindowMask))) return;
  XEvent ev;
  memset(&ev, 0, sizeof ev);
  ev.type = type;
  fill_pointer_event(&ev, w, state);
  ev.xcrossing.mode = NotifyNormal;
  ev.xcrossing.detail = detail;
  ev.xcrossing.focus = False;
  enqueue(&ev);
}

xw_drawable *xw_pointer_window(void) { return ptr_win; }

static void update_pointer_window(unsigned state)
{
  xw_drawable *nw = window_at(root, ptr_x, ptr_y);
  xw_drawable *old = ptr_win;
  if (old && !xw_lookup(old->id)) old = NULL;
  if (nw == old) return;
  ptr_win = nw;
  /* common ancestor */
  xw_drawable *ca = old;
  while (ca && !is_ancestor(ca, nw)) ca = ca->parent;
  /* leave: old up to (excluding) ca */
  for (xw_drawable *w = old; w && w != ca && w != root; w = w->parent)
    crossing(w, LeaveNotify, w == old ? NotifyAncestor : NotifyVirtual, state);
  /* enter: from below ca down to nw */
  xw_drawable *path[64];
  int n = 0;
  for (xw_drawable *w = nw; w && w != ca && w != root && n < 64; w = w->parent) path[n++] = w;
  while (n-- > 0)
    crossing(path[n], EnterNotify, path[n] == nw ? NotifyAncestor : NotifyVirtual, state);
}

void xw_input_motion(int x, int y, unsigned state)
{
  ptr_x = x;
  ptr_y = y;
  if (grab_win && !xw_lookup(grab_win->id)) grab_win = NULL;
  if (!grab_win) update_pointer_window(state);
  else ptr_win = window_at(root, x, y);
  XEvent ev;
  memset(&ev, 0, sizeof ev);
  ev.type = MotionNotify;
  long mask = PointerMotionMask;
  if (state & (Button1Mask | Button2Mask | Button3Mask))
    mask |= ButtonMotionMask | (state & Button1Mask ? Button1MotionMask : 0);
  if (grab_win) {
    if (grab_win->event_mask & mask) {
      fill_pointer_event(&ev, grab_win, state);
      enqueue(&ev);
    }
  } else if (ptr_win) {
    propagate(&ev, ptr_win, mask, state);
  }
}

void xw_input_button(int x, int y, int button, int press, unsigned state)
{
  xw_input_motion(x, y, state);
  XEvent ev;
  memset(&ev, 0, sizeof ev);
  ev.type = press ? ButtonPress : ButtonRelease;
  if (press) {
    xw_drawable *got = NULL;
    if (grab_win) {
      if (grab_win->event_mask & ButtonPressMask) {
        fill_pointer_event(&ev, grab_win, state);
        ev.xbutton.button = button;
        enqueue(&ev);
      }
    } else if (ptr_win) {
      ev.xbutton.button = button;
      got = propagate(&ev, ptr_win, ButtonPressMask, state);
      if (got) grab_win = got;
    }
    buttons_down |= 1u << button;
  } else {
    buttons_down &= ~(1u << button);
    xw_drawable *to = grab_win ? grab_win : ptr_win;
    if (to) {
      ev.xbutton.button = button;
      if (grab_win) {
        if (grab_win->event_mask & ButtonReleaseMask) {
          fill_pointer_event(&ev, grab_win, state);
          enqueue(&ev);
        }
      } else {
        propagate(&ev, to, ButtonReleaseMask, state);
      }
    }
    if (!buttons_down) {
      grab_win = NULL;
      update_pointer_window(state & ~(Button1Mask | Button2Mask | Button3Mask));
    }
  }
}

/* keycodes are assigned per keysym on first use */
#define MIN_KEYCODE 8
#define MAX_KEYCODE 255
static KeySym keycode_sym[MAX_KEYCODE + 1];
static char keycode_text[MAX_KEYCODE + 1][8];

static KeyCode keycode_for(KeySym ks, const char *text)
{
  for (int k = MIN_KEYCODE; k <= MAX_KEYCODE; k++)
    if (keycode_sym[k] == ks) return k;
  for (int k = MIN_KEYCODE; k <= MAX_KEYCODE; k++)
    if (!keycode_sym[k]) {
      keycode_sym[k] = ks;
      if (text) snprintf(keycode_text[k], sizeof keycode_text[k], "%s", text);
      return k;
    }
  return 0;
}

void xw_input_key(KeySym keysym, const char *text, int press, unsigned state)
{
  KeyCode kc = keycode_for(keysym, text);
  xw_drawable *target = ptr_win;
  if (!target || target == root) { /* click-to-focus, as a window manager does */
    xw_drawable *a = xw_lookup(active_top);
    target = a && a->mapped ? a : NULL;
  }
  if (focus != PointerRoot && focus != None) {
    xw_drawable *f = xw_lookup(focus);
    if (f && xw_viewable(f)) target = (ptr_win && is_ancestor(f, ptr_win)) ? ptr_win : f;
  }
  if (!target) return;
  XEvent ev;
  memset(&ev, 0, sizeof ev);
  ev.type = press ? KeyPress : KeyRelease;
  ev.xkey.keycode = kc; /* XKeyEvent shares XButtonEvent's layout up to here */
  propagate(&ev, target, press ? KeyPressMask : KeyReleaseMask, state);
}

void xw_input_configure(Window top, int x, int y, int w, int h)
{
  xw_drawable *t = xw_lookup(top);
  if (!t || t->parent != root) return;
  int resized = (w > 0 && h > 0) && (w != t->width || h != t->height);
  t->x = x;
  t->y = y;
  if (resized) {
    resize_buffer(t, w, h);
    xw_clear_area(t, 0, 0, 0, 0);
  }
  send_structure(t, ConfigureNotify);
  if (resized) send_expose(t, 0, 0, t->width, t->height);
  xw_mark_dirty(t);
}

static Atom atom_wm_protocols, atom_wm_delete;

/* the window manager raised a top-level (no events, like a real WM restack) */
void xw_input_raise(Window top)
{
  xw_drawable *t = xw_lookup(top);
  if (!t || t->parent != root) return;
  remove_child(root, t);
  add_child(root, t);
  active_top = top;
  update_pointer_window(0);
}

void xw_input_close(Window top)
{
  XEvent ev;
  memset(&ev, 0, sizeof ev);
  ev.type = ClientMessage;
  ev.xclient.window = top;
  ev.xclient.message_type = atom_wm_protocols;
  ev.xclient.format = 32;
  ev.xclient.data.l[0] = atom_wm_delete;
  ev.xclient.data.l[1] = (long)now_ms();
  enqueue(&ev);
}

/* ------------------------------------------------------------------------ */
/* rendering top-levels for the platform                                    */

int xw_toplevels(Window *out, int max)
{
  int n = 0;
  for (int i = 0; i < root->nchildren && n < max; i++) out[n++] = root->children[i]->id;
  return n;
}

int xw_toplevel_dirty(Window w)
{
  xw_drawable *t = xw_lookup(w);
  return t && top_dirty[t->id - XID_BASE];
}

const char *xw_title(Window w)
{
  xw_drawable *t = xw_lookup(w);
  return t && t->title ? t->title : "";
}

static void composite(xw_drawable *w, uint32_t *dst, int dw, int dh, int ox, int oy,
                      int cx0, int cy0, int cx1, int cy1)
{
  /* draw w's content at (ox,oy) in dst, clipped to [cx0,cx1)x[cy0,cy1) */
  int x0 = ox > cx0 ? ox : cx0, y0 = oy > cy0 ? oy : cy0;
  int x1 = ox + w->width < cx1 ? ox + w->width : cx1;
  int y1 = oy + w->height < cy1 ? oy + w->height : cy1;
  if (x0 >= x1 || y0 >= y1) return;
  if (!w->input_only)
    for (int y = y0; y < y1; y++)
      memcpy(dst + (size_t)y * dw + x0, w->pix + (size_t)(y - oy) * w->width + (x0 - ox),
             (x1 - x0) * sizeof(uint32_t));
  for (int i = 0; i < w->nchildren; i++) {
    xw_drawable *c = w->children[i];
    if (!c->mapped || c->input_only) continue;
    int bw = c->border_width;
    int bx = ox + c->x, by = oy + c->y;
    int bwid = c->width + 2 * bw, bhgt = c->height + 2 * bw;
    if (bw > 0) /* border */
      for (int y = by; y < by + bhgt; y++) {
        if (y < y0 || y >= y1) continue;
        for (int x = bx; x < bx + bwid; x++) {
          if (x < x0 || x >= x1) continue;
          if (x >= bx + bw && x < bx + bw + c->width && y >= by + bw && y < by + bw + c->height) {
            x = bx + bw + c->width - 1;
            continue;
          }
          dst[(size_t)y * dw + x] = (uint32_t)c->border_pixel;
        }
      }
    composite(c, dst, dw, dh, bx + bw, by + bw, x0, y0, x1, y1);
  }
}

static uint32_t *render_buf;
static size_t render_cap;

uint8_t *xw_render(Window w, int *width, int *height)
{
  xw_drawable *t = xw_lookup(w);
  if (!t) return NULL;
  size_t n = (size_t)t->width * t->height;
  if (n > render_cap) {
    free(render_buf);
    render_buf = xcalloc(n, sizeof(uint32_t));
    render_cap = n;
  }
  composite(t, render_buf, t->width, t->height, 0, 0, 0, 0, t->width, t->height);
  /* 0x00RRGGBB -> bytes R,G,B,255 */
  uint8_t *b = (uint8_t *)render_buf;
  for (size_t i = 0; i < n; i++) {
    uint32_t p = render_buf[i];
    b[4 * i] = (p >> 16) & 255;
    b[4 * i + 1] = (p >> 8) & 255;
    b[4 * i + 2] = p & 255;
    b[4 * i + 3] = 255;
  }
  top_dirty[t->id - XID_BASE] = 0;
  *width = t->width;
  *height = t->height;
  return b;
}

/* ------------------------------------------------------------------------ */
/* display                                                                  */

Display *XOpenDisplay(const char *name)
{
  (void)name;
  if (xw_display) return xw_display;
  _XPrivDisplay d = xcalloc(1, sizeof *d);
  int sw = xw_platform_screen_width(), sh = xw_platform_screen_height();
  root = new_drawable(1, 1, 1, 24); /* root has no pixels of its own */
  root->width = sw;
  root->height = sh;
  root->mapped = 1;
  xw_visual.visualid = 0x21;
  xw_visual.class = TrueColor;
  xw_visual.red_mask = 0xff0000;
  xw_visual.green_mask = 0x00ff00;
  xw_visual.blue_mask = 0x0000ff;
  xw_visual.bits_per_rgb = 8;
  xw_visual.map_entries = 256;
  xw_depth.depth = 24;
  xw_depth.nvisuals = 1;
  xw_depth.visuals = &xw_visual;
  xw_screen.display = (struct _XDisplay *)d;
  xw_screen.root = root->id;
  xw_screen.width = sw;
  xw_screen.height = sh;
  xw_screen.mwidth = sw * 254 / 960; /* 96 dpi */
  xw_screen.mheight = sh * 254 / 960;
  xw_screen.ndepths = 1;
  xw_screen.depths = &xw_depth;
  xw_screen.root_depth = 24;
  xw_screen.root_visual = &xw_visual;
  xw_screen.cmap = 0x20;
  xw_screen.white_pixel = 0xffffff;
  xw_screen.black_pixel = 0x000000;
  xw_screen.max_maps = xw_screen.min_maps = 1;
  d->vendor = "XPPAUT-Web";
  d->display_name = ":0";
  d->default_screen = 0;
  d->nscreens = 1;
  d->screens = &xw_screen;
  d->min_keycode = MIN_KEYCODE;
  d->max_keycode = MAX_KEYCODE;
  d->byte_order = LSBFirst;
  d->bitmap_unit = 32;
  d->bitmap_pad = 32;
  d->bitmap_bit_order = LSBFirst;
  xw_display = (Display *)d;
  xw_screen.default_gc = XCreateGC(xw_display, root->id, 0, NULL);
  atom_wm_protocols = XInternAtom(xw_display, "WM_PROTOCOLS", False);
  atom_wm_delete = XInternAtom(xw_display, "WM_DELETE_WINDOW", False);
  return xw_display;
}

int XCloseDisplay(Display *d) { (void)d; return 0; }
int XFlush(Display *d) { (void)d; xw_platform_poll(); return 1; }
int (*XSynchronize(Display *d, Bool onoff))(Display *)
{
  (void)d; (void)onoff;
  return NULL;
}

int XPending(Display *d)
{
  (void)d;
  if (!qlen) xw_platform_poll();
  return qlen;
}

int XNextEvent(Display *d, XEvent *ev)
{
  (void)d;
  while (!qlen) xw_platform_wait();
  *ev = queue[qhead];
  qhead = (qhead + 1) % QSIZE;
  qlen--;
  return 0;
}

Status XSendEvent(Display *d, Window w, Bool propagate_, long mask, XEvent *ev)
{
  (void)d; (void)propagate_; (void)mask;
  XEvent e = *ev;
  e.xany.window = w;
  e.xany.send_event = True;
  enqueue(&e);
  return 1;
}

int XBell(Display *d, int percent) { (void)d; (void)percent; xw_platform_bell(); return 0; }
Bool XkbBell(Display *d, Window w, int percent, Atom name)
{
  (void)d; (void)w; (void)percent; (void)name;
  xw_platform_bell();
  return True;
}

/* ------------------------------------------------------------------------ */
/* atoms                                                                    */

static char *atom_names[256];
static int natoms;

Atom XInternAtom(Display *d, const char *name, Bool only_if_exists)
{
  (void)d;
  (void)only_if_exists;
  for (int i = 0; i < natoms; i++)
    if (!strcmp(atom_names[i], name)) return 100 + i;
  if (natoms == 256) return None;
  atom_names[natoms] = strdup(name);
  return 100 + natoms++;
}

/* ------------------------------------------------------------------------ */
/* windows                                                                  */

Window XCreateSimpleWindow(Display *d, Window parent, int x, int y, unsigned int width,
                           unsigned int height, unsigned int border_width,
                           unsigned long border, unsigned long background)
{
  (void)d;
  xw_drawable *p = xw_lookup(parent);
  if (!p) p = root;
  xw_drawable *w = new_drawable(1, width, height, 24);
  w->x = x;
  w->y = y;
  w->border_width = border_width;
  w->border_pixel = border;
  w->bg_kind = XW_BG_PIXEL;
  w->bg_pixel = background;
  for (int i = 0; i < w->width * w->height; i++) w->pix[i] = (uint32_t)background;
  add_child(p, w);
  return w->id;
}

static void destroy_tree(xw_drawable *w)
{
  while (w->nchildren) {
    xw_drawable *c = w->children[w->nchildren - 1];
    w->nchildren--;
    destroy_tree(c);
  }
  if (ptr_win == w) ptr_win = NULL;
  if (grab_win == w) grab_win = NULL;
  if (focus == w->id) focus = PointerRoot;
  top_dirty[w->id - XID_BASE] = 0;
  if (w->event_mask & StructureNotifyMask) {
    XEvent ev;
    memset(&ev, 0, sizeof ev);
    ev.type = DestroyNotify;
    ev.xdestroywindow.event = w->id;
    ev.xdestroywindow.window = w->id;
    enqueue(&ev);
  }
  free_drawable(w);
}

int XDestroyWindow(Display *d, Window win)
{
  (void)d;
  xw_drawable *w = xw_lookup(win);
  if (!w || !w->is_window || w == root) return 0;
  xw_drawable *p = w->parent;
  int was_top = p == root;
  remove_child(p, w);
  xw_mark_dirty(p);
  destroy_tree(w);
  if (was_top) xw_platform_toplevel_changed(win);
  update_pointer_window(0);
  return 1;
}

int XDestroySubwindows(Display *d, Window win)
{
  xw_drawable *w = xw_lookup(win);
  if (!w) return 0;
  while (w->nchildren) XDestroyWindow(d, w->children[w->nchildren - 1]->id);
  return 1;
}

static void map_window(xw_drawable *w)
{
  if (w->mapped) return;
  w->mapped = 1;
  send_structure(w, MapNotify);
  if (xw_viewable(w)) expose_tree(w);
  xw_mark_dirty(w);
  if (w->parent == root) {
    active_top = w->id;
    xw_platform_toplevel_changed(w->id);
  }
  update_pointer_window(0);
}

int XMapWindow(Display *d, Window win)
{
  (void)d;
  xw_drawable *w = xw_lookup(win);
  if (w && w->is_window && w != root) map_window(w);
  return 1;
}

static void raise_window(xw_drawable *w)
{
  xw_drawable *p = w->parent;
  if (!p) return;
  remove_child(p, w);
  add_child(p, w);
  xw_mark_dirty(p);
  if (p == root) xw_platform_toplevel_changed(w->id);
}

int XRaiseWindow(Display *d, Window win)
{
  (void)d;
  xw_drawable *w = xw_lookup(win);
  if (w && w->is_window && w != root) raise_window(w);
  update_pointer_window(0);
  return 1;
}

int XLowerWindow(Display *d, Window win)
{
  (void)d;
  xw_drawable *w = xw_lookup(win);
  if (!w || !w->is_window || w == root) return 1;
  xw_drawable *p = w->parent;
  remove_child(p, w);
  add_child(p, w);
  memmove(p->children + 1, p->children, (p->nchildren - 1) * sizeof *p->children);
  p->children[0] = w;
  xw_mark_dirty(p);
  if (p == root) xw_platform_toplevel_changed(win);
  update_pointer_window(0);
  return 1;
}

int XMapRaised(Display *d, Window win)
{
  XRaiseWindow(d, win);
  return XMapWindow(d, win);
}

int XMapSubwindows(Display *d, Window win)
{
  (void)d;
  xw_drawable *w = xw_lookup(win);
  if (!w) return 0;
  for (int i = 0; i < w->nchildren; i++) map_window(w->children[i]);
  return 1;
}

static void unmap_window(xw_drawable *w)
{
  if (!w->mapped) return;
  w->mapped = 0;
  send_structure(w, UnmapNotify);
  if (w->parent) xw_mark_dirty(w->parent);
  if (w->parent == root) xw_platform_toplevel_changed(w->id);
  if (grab_win && is_ancestor(w, grab_win)) grab_win = NULL;
  update_pointer_window(0);
}

int XUnmapWindow(Display *d, Window win)
{
  (void)d;
  xw_drawable *w = xw_lookup(win);
  if (w && w->is_window && w != root) unmap_window(w);
  return 1;
}

int XUnmapSubwindows(Display *d, Window win)
{
  (void)d;
  xw_drawable *w = xw_lookup(win);
  if (!w) return 0;
  for (int i = 0; i < w->nchildren; i++) unmap_window(w->children[i]);
  return 1;
}

Status XIconifyWindow(Display *d, Window win, int screen)
{
  (void)screen;
  return XUnmapWindow(d, win);
}

static void configure(xw_drawable *w, int x, int y, int width, int height, int move, int size)
{
  int resized = size && (width != w->width || height != w->height);
  if (move) { w->x = x; w->y = y; }
  if (resized) {
    resize_buffer(w, width, height);
    xw_clear_area(w, 0, 0, 0, 0);
  }
  send_structure(w, ConfigureNotify);
  if (resized) send_expose(w, 0, 0, w->width, w->height);
  if (w->parent) xw_mark_dirty(w->parent);
  xw_mark_dirty(w);
  if (w->parent == root) xw_platform_toplevel_changed(w->id);
  update_pointer_window(0);
}

int XMoveResizeWindow(Display *d, Window win, int x, int y, unsigned int width, unsigned int height)
{
  (void)d;
  xw_drawable *w = xw_lookup(win);
  if (w && w->is_window && w != root) configure(w, x, y, width, height, 1, 1);
  return 1;
}

int XResizeWindow(Display *d, Window win, unsigned int width, unsigned int height)
{
  (void)d;
  xw_drawable *w = xw_lookup(win);
  if (w && w->is_window && w != root) configure(w, 0, 0, width, height, 0, 1);
  return 1;
}

int XSetWindowBorderWidth(Display *d, Window win, unsigned int width)
{
  (void)d;
  xw_drawable *w = xw_lookup(win);
  if (w && w->is_window) {
    w->border_width = width;
    if (w->parent) xw_mark_dirty(w->parent);
  }
  return 1;
}

int XSetWindowBorder(Display *d, Window win, unsigned long pixel)
{
  (void)d;
  xw_drawable *w = xw_lookup(win);
  if (w && w->is_window) {
    w->border_pixel = pixel;
    if (w->parent) xw_mark_dirty(w->parent);
  }
  return 1;
}

int XSetWindowBackground(Display *d, Window win, unsigned long pixel)
{
  (void)d;
  xw_drawable *w = xw_lookup(win);
  if (w && w->is_window) {
    w->bg_kind = XW_BG_PIXEL;
    w->bg_pixel = pixel;
  }
  return 1;
}

int XSetWindowBackgroundPixmap(Display *d, Window win, Pixmap pm)
{
  if (tracing()) fprintf(stderr, "xlib: XSetWindowBackgroundPixmap 0x%lx 0x%lx\n", win, pm);
  (void)d;
  xw_drawable *w = xw_lookup(win);
  if (!w || !w->is_window) return 1;
  const uint32_t *src = NULL;
  int tw = 0, th = 0;
  if (pm == None) {
    w->bg_kind = XW_BG_NONE;
  } else if (pm == ParentRelative) {
    xw_drawable *p = w->parent;
    w->bg_kind = p ? p->bg_kind : XW_BG_PIXEL;
    w->bg_pixel = p ? p->bg_pixel : 0;
    if (p && p->bg_kind == XW_BG_PIXMAP) { src = p->bg_tile; tw = p->bg_tw; th = p->bg_th; }
  } else {
    xw_drawable *p = xw_lookup(pm);
    if (!p) return 1;
    w->bg_kind = XW_BG_PIXMAP;
    src = p->pix; tw = p->width; th = p->height;
  }
  free(w->bg_tile);
  w->bg_tile = NULL;
  if (src) {
    w->bg_tile = xcalloc((size_t)tw * th, sizeof(uint32_t));
    memcpy(w->bg_tile, src, (size_t)tw * th * sizeof(uint32_t));
    w->bg_tw = tw;
    w->bg_th = th;
  } else if (w->bg_kind == XW_BG_PIXMAP) {
    w->bg_kind = XW_BG_PIXEL;
  }
  return 1;
}

int XChangeWindowAttributes(Display *d, Window win, unsigned long mask, XSetWindowAttributes *a)
{
  xw_drawable *w = xw_lookup(win);
  if (!w || !w->is_window) return 1;
  if (mask & CWBackPixmap) XSetWindowBackgroundPixmap(d, win, a->background_pixmap);
  if (mask & CWBackPixel) XSetWindowBackground(d, win, a->background_pixel);
  if (mask & CWBorderPixel) XSetWindowBorder(d, win, a->border_pixel);
  if (mask & CWEventMask) w->event_mask = a->event_mask;
  if (mask & CWOverrideRedirect) w->override_redirect = a->override_redirect;
  if (mask & CWCursor) XDefineCursor(d, win, a->cursor);
  return 1;
}

int XSelectInput(Display *d, Window win, long mask)
{
  (void)d;
  xw_drawable *w = xw_lookup(win);
  if (w && w->is_window) w->event_mask = mask;
  return 1;
}

int XClearWindow(Display *d, Window win)
{
  if (tracing()) fprintf(stderr, "xlib: XClearWindow 0x%lx\n", win);
  (void)d;
  xw_drawable *w = xw_lookup(win);
  if (w && w->is_window) xw_clear_area(w, 0, 0, 0, 0);
  return 1;
}

int XClearArea(Display *d, Window win, int x, int y, unsigned int width, unsigned int height,
               Bool exposures)
{
  if (tracing()) fprintf(stderr, "xlib: XClearArea 0x%lx %d,%d %ux%u\n", win, x, y, width, height);
  (void)d;
  xw_drawable *w = xw_lookup(win);
  if (!w || !w->is_window) return 1;
  xw_clear_area(w, x, y, width, height);
  if (exposures) {
    int ww = width ? (int)width : w->width - x, hh = height ? (int)height : w->height - y;
    send_expose(w, x, y, ww, hh);
  }
  return 1;
}

Status XGetGeometry(Display *d, Drawable dr, Window *root_ret, int *x, int *y,
                    unsigned int *width, unsigned int *height, unsigned int *bw,
                    unsigned int *depth)
{
  (void)d;
  xw_drawable *w = xw_lookup(dr);
  if (!w) return 0;
  if (root_ret) *root_ret = root->id;
  if (x) *x = w->is_window ? w->x : 0;
  if (y) *y = w->is_window ? w->y : 0;
  if (width) *width = w->width;
  if (height) *height = w->height;
  if (bw) *bw = w->is_window ? w->border_width : 0;
  if (depth) *depth = w->depth;
  return 1;
}

Status XGetWindowAttributes(Display *d, Window win, XWindowAttributes *a)
{
  (void)d;
  xw_drawable *w = xw_lookup(win);
  if (!w || !a) return 0;
  memset(a, 0, sizeof *a);
  a->x = w->x;
  a->y = w->y;
  a->width = w->width;
  a->height = w->height;
  a->border_width = w->border_width;
  a->depth = w->depth;
  a->visual = &xw_visual;
  a->root = root->id;
  a->class = w->input_only ? InputOnly : InputOutput;
  a->colormap = xw_screen.cmap;
  a->map_installed = True;
  a->map_state = !w->mapped ? IsUnmapped : xw_viewable(w) ? IsViewable : IsUnviewable;
  a->all_event_masks = a->your_event_mask = w->event_mask;
  a->override_redirect = w->override_redirect;
  a->screen = &xw_screen;
  return 1;
}

int XSetInputFocus(Display *d, Window win, int revert_to, Time t)
{
  (void)d; (void)revert_to; (void)t;
  focus = win;
  return 1;
}

int XGetInputFocus(Display *d, Window *win, int *revert_to)
{
  (void)d;
  if (win) *win = focus;
  if (revert_to) *revert_to = RevertToParent;
  return 1;
}

int XDefineCursor(Display *d, Window win, Cursor c)
{
  (void)d;
  xw_drawable *w = xw_lookup(win);
  if (w && w->is_window) {
    w->cursor = c;
    xw_platform_cursor(win, (int)c);
  }
  return 1;
}

Cursor XCreateFontCursor(Display *d, unsigned int shape)
{
  (void)d;
  return (Cursor)(shape + 1); /* cursor id = shape+1; platform maps to CSS */
}

/* ---- window manager properties ------------------------------------------- */

static void set_title(Window win, const char *s)
{
  xw_drawable *w = xw_lookup(win);
  if (!w || !s) return;
  free(w->title);
  w->title = strdup(s);
  if (w->parent == root) xw_platform_toplevel_changed(win);
}

Status XStringListToTextProperty(char **list, int count, XTextProperty *tp)
{
  size_t n = 0;
  for (int i = 0; i < count; i++) n += strlen(list[i]) + 1;
  char *buf = xcalloc(n + 1, 1);
  char *p = buf;
  for (int i = 0; i < count; i++) {
    strcpy(p, list[i]);
    p += strlen(list[i]) + 1;
  }
  tp->value = (unsigned char *)buf;
  tp->encoding = XA_STRING;
  tp->format = 8;
  tp->nitems = n ? n - 1 : 0;
  return 1;
}

int XFree(void *p) { free(p); return 1; }

void XSetWMName(Display *d, Window w, XTextProperty *tp)
{
  (void)d;
  if (tp && tp->value) set_title(w, (char *)tp->value);
}

static void apply_size_hints(Window win, XSizeHints *h)
{
  xw_drawable *w = xw_lookup(win);
  if (!w || !h) return;
  if (h->flags & PMinSize) {
    w->min_width = h->min_width;
    w->min_height = h->min_height;
  }
  if (h->flags & (USPosition | PPosition)) w->pos_hint = 1;
}

void XSetWMProperties(Display *d, Window w, XTextProperty *window_name, XTextProperty *icon_name,
                      char **argv, int argc, XSizeHints *normal_hints, XWMHints *wm_hints,
                      XClassHint *class_hints)
{
  (void)icon_name; (void)argv; (void)argc; (void)wm_hints; (void)class_hints;
  if (window_name) XSetWMName(d, w, window_name);
  apply_size_hints(w, normal_hints);
}

int XSetStandardProperties(Display *d, Window w, const char *window_name, const char *icon_name,
                           Pixmap icon, char **argv, int argc, XSizeHints *hints)
{
  (void)d; (void)icon_name; (void)icon; (void)argv; (void)argc;
  set_title(w, window_name);
  apply_size_hints(w, hints);
  return 1;
}

Status XSetWMProtocols(Display *d, Window w, Atom *protocols, int count)
{
  (void)d; (void)w; (void)protocols; (void)count;
  return 1;
}

Status XGetIconSizes(Display *d, Window w, XIconSize **list, int *count)
{
  (void)d; (void)w;
  *list = NULL;
  *count = 0;
  return 0;
}

/* ------------------------------------------------------------------------ */
/* pixmaps and bitmaps                                                      */

Pixmap XCreatePixmap(Display *d, Drawable dr, unsigned int width, unsigned int height,
                     unsigned int depth)
{
  if (tracing()) fprintf(stderr, "xlib: XCreatePixmap %ux%u (next id 0x%lx)\n", width, height, next_xid);
  (void)d; (void)dr;
  return new_drawable(0, width, height, depth)->id;
}

int XFreePixmap(Display *d, Pixmap pm)
{
  if (tracing()) fprintf(stderr, "xlib: XFreePixmap 0x%lx\n", pm);
  (void)d;
  xw_drawable *p = xw_lookup(pm);
  if (p && !p->is_window) free_drawable(p);
  return 1;
}

static Pixmap bitmap_pixmap(const char *data, unsigned int width, unsigned int height,
                            unsigned long fg, unsigned long bg, unsigned int depth)
{
  xw_drawable *p = new_drawable(0, width, height, depth);
  int stride = (width + 7) / 8;
  for (unsigned y = 0; y < height; y++)
    for (unsigned x = 0; x < width; x++) {
      int bit = (data[y * stride + x / 8] >> (x % 8)) & 1; /* XBM: LSB first */
      p->pix[y * width + x] = (uint32_t)(bit ? fg : bg);
    }
  return p->id;
}

Pixmap XCreateBitmapFromData(Display *d, Drawable dr, const char *data, unsigned int width,
                             unsigned int height)
{
  (void)d; (void)dr;
  return bitmap_pixmap(data, width, height, 1, 0, 1);
}

Pixmap XCreatePixmapFromBitmapData(Display *d, Drawable dr, char *data, unsigned int width,
                                   unsigned int height, unsigned long fg, unsigned long bg,
                                   unsigned int depth)
{
  (void)d; (void)dr;
  return bitmap_pixmap(data, width, height, fg, bg, depth);
}

/* Minimal XBM reader: "#define name_width N", "#define name_height N",
   then hex bytes. */
int XReadBitmapFileData(const char *filename, unsigned int *width_ret, unsigned int *height_ret,
                        unsigned char **data_ret, int *x_hot, int *y_hot)
{
  FILE *f = fopen(filename, "r");
  if (!f) return BitmapOpenFailed;
  char line[512];
  int w = 0, h = 0, n = 0, cap = 0;
  unsigned char *data = NULL;
  if (x_hot) *x_hot = -1;
  if (y_hot) *y_hot = -1;
  while (fgets(line, sizeof line, f)) {
    char name[256];
    int v;
    if (sscanf(line, "#define %255s %d", name, &v) == 2) {
      size_t l = strlen(name);
      if (l >= 6 && !strcmp(name + l - 6, "_width")) w = v;
      else if (l >= 7 && !strcmp(name + l - 7, "_height")) h = v;
      else if (l >= 4 && !strcmp(name + l - 4, "_x_hot") && x_hot) *x_hot = v;
      else if (l >= 4 && !strcmp(name + l - 4, "_y_hot") && y_hot) *y_hot = v;
      continue;
    }
    for (char *p = line; (p = strstr(p, "0x")) || (p && (p = strstr(p, "0X")));) {
      unsigned int b;
      if (sscanf(p, "%x", &b) != 1) break;
      if (n == cap) {
        cap = cap ? 2 * cap : 256;
        data = realloc(data, cap);
      }
      data[n++] = (unsigned char)b;
      p += 2;
    }
  }
  fclose(f);
  if (w <= 0 || h <= 0 || n < ((w + 7) / 8) * h) {
    free(data);
    return BitmapFileInvalid;
  }
  *width_ret = w;
  *height_ret = h;
  *data_ret = data;
  return BitmapSuccess;
}

/* ------------------------------------------------------------------------ */
/* GCs                                                                      */

GC XCreateGC(Display *d, Drawable dr, unsigned long mask, XGCValues *v)
{
  (void)d; (void)dr;
  GC gc = xcalloc(1, sizeof *gc);
  gc->v.function = GXcopy;
  gc->v.plane_mask = ~0UL;
  gc->v.foreground = 0;
  gc->v.background = 1;
  gc->v.line_width = 0;
  gc->v.line_style = LineSolid;
  gc->v.cap_style = CapButt;
  gc->v.join_style = JoinMiter;
  gc->v.fill_style = FillSolid;
  gc->v.graphics_exposures = True;
  gc->v.font = None;
  gc->dashes[0] = gc->dashes[1] = 4;
  gc->ndashes = 2;
  if (v) {
    if (mask & GCFunction) gc->v.function = v->function;
    if (mask & GCForeground) gc->v.foreground = v->foreground;
    if (mask & GCBackground) gc->v.background = v->background;
    if (mask & GCLineWidth) gc->v.line_width = v->line_width;
    if (mask & GCLineStyle) gc->v.line_style = v->line_style;
    if (mask & GCCapStyle) gc->v.cap_style = v->cap_style;
    if (mask & GCJoinStyle) gc->v.join_style = v->join_style;
    if (mask & GCFillStyle) gc->v.fill_style = v->fill_style;
    if (mask & GCFont) gc->v.font = v->font;
    if (mask & GCTile) gc->v.tile = v->tile;
    if (mask & GCStipple) gc->v.stipple = v->stipple;
    if (mask & GCGraphicsExposures) gc->v.graphics_exposures = v->graphics_exposures;
    if (mask & GCDashList) {
      gc->dashes[0] = gc->dashes[1] = v->dashes;
      gc->ndashes = 2;
    }
  }
  return gc;
}

int XFreeGC(Display *d, GC gc) { (void)d; free(gc); return 1; }
int XSetForeground(Display *d, GC gc, unsigned long p) { (void)d; gc->v.foreground = p; return 1; }
int XSetBackground(Display *d, GC gc, unsigned long p) { (void)d; gc->v.background = p; return 1; }
int XSetFunction(Display *d, GC gc, int f) { (void)d; gc->v.function = f; return 1; }
int XSetFillStyle(Display *d, GC gc, int s) { (void)d; gc->v.fill_style = s; return 1; }
int XSetFont(Display *d, GC gc, Font f) { (void)d; gc->v.font = f; return 1; }

int XSetLineAttributes(Display *d, GC gc, unsigned int width, int style, int cap, int join)
{
  (void)d;
  gc->v.line_width = width;
  gc->v.line_style = style;
  gc->v.cap_style = cap;
  gc->v.join_style = join;
  return 1;
}

int XSetDashes(Display *d, GC gc, int offset, const char *list, int n)
{
  (void)d;
  gc->v.dash_offset = offset;
  if (n > 16) n = 16;
  int k = 0;
  for (int i = 0; i < n; i++)
    if (list[i] > 0) gc->dashes[k++] = list[i];
  if (k == 0) gc->dashes[k++] = 4;
  if (k % 2) gc->dashes[k] = gc->dashes[k - 1], k++; /* odd lists repeat */
  gc->ndashes = k;
  return 1;
}

/* ------------------------------------------------------------------------ */
/* fonts                                                                    */

#define MAX_FONTS 32
static XFontStruct *loaded_fonts[MAX_FONTS];
static const xw_font_data *loaded_data[MAX_FONTS];
#define FONT_BASE 0x100

const xw_font_data *xw_font_for(Font fid)
{
  if (fid >= FONT_BASE && fid < FONT_BASE + MAX_FONTS && loaded_data[fid - FONT_BASE])
    return loaded_data[fid - FONT_BASE];
  for (int i = 0; xw_fonts[i].name; i++)
    if (!strcmp(xw_fonts[i].name, "fixed")) return &xw_fonts[i];
  return &xw_fonts[0];
}

static const xw_font_data *find_font(const char *name)
{
  char lower[256];
  int i;
  for (i = 0; name[i] && i < 255; i++) lower[i] = tolower((unsigned char)name[i]);
  lower[i] = 0;
  for (int k = 0; xw_fonts[k].name; k++)
    if (!strcmp(xw_fonts[k].name, lower)) return &xw_fonts[k];
  /* XLFD names like -misc-fixed-medium-r-normal--13-...: match pixel size */
  if (lower[0] == '-') {
    int field = 0, px = 0;
    int bold = strstr(lower, "-bold-") != NULL;
    for (const char *p = lower; *p; p++)
      if (*p == '-' && ++field == 7) { px = atoi(p + 1); break; }
    const xw_font_data *best = NULL;
    for (int k = 0; xw_fonts[k].name; k++) {
      const xw_font_data *f = &xw_fonts[k];
      if ((strstr(f->name, "bold") != NULL) != bold) continue;
      if (f->ascent + f->descent == px) { best = f; break; }
    }
    if (best) return best;
  }
  return NULL;
}

XFontStruct *XLoadQueryFont(Display *d, const char *name)
{
  (void)d;
  const xw_font_data *fd = find_font(name);
  if (!fd) return NULL;
  for (int i = 0; i < MAX_FONTS; i++)
    if (loaded_data[i] == fd && loaded_fonts[i]) return loaded_fonts[i];
  for (int i = 0; i < MAX_FONTS; i++)
    if (!loaded_fonts[i]) {
      XFontStruct *f = xcalloc(1, sizeof *f);
      f->fid = FONT_BASE + i;
      f->direction = FontLeftToRight;
      f->min_char_or_byte2 = 0;
      f->max_char_or_byte2 = 255;
      f->default_char = ' ';
      f->all_chars_exist = True;
      f->ascent = fd->ascent;
      f->descent = fd->descent;
      XCharStruct cs = {0, (short)fd->width, (short)fd->width, (short)fd->ascent,
                        (short)fd->descent, 0};
      f->min_bounds = cs;
      f->max_bounds = cs;
      loaded_fonts[i] = f;
      loaded_data[i] = fd;
      return f;
    }
  return NULL;
}

int XUnloadFont(Display *d, Font fid)
{
  (void)d; (void)fid; /* fonts are shared and kept */
  return 1;
}

int XTextWidth(XFontStruct *f, const char *s, int n)
{
  (void)s;
  return f ? f->max_bounds.width * n : 0;
}

/* ------------------------------------------------------------------------ */
/* colours: TrueColor, pixel = 0xRRGGBB                                      */

Status XAllocColor(Display *d, Colormap cm, XColor *c)
{
  (void)d; (void)cm;
  unsigned r = c->red >> 8, g = c->green >> 8, b = c->blue >> 8;
  c->pixel = (r << 16) | (g << 8) | b;
  c->red = r * 257;
  c->green = g * 257;
  c->blue = b * 257;
  return 1;
}

static int hexval(const char *s, int n, unsigned *out)
{
  unsigned v = 0;
  for (int i = 0; i < n; i++) {
    if (!isxdigit((unsigned char)s[i])) return 0;
    v = v * 16 + (isdigit((unsigned char)s[i]) ? s[i] - '0' : tolower((unsigned char)s[i]) - 'a' + 10);
  }
  /* scale n hex digits to 16 bits */
  unsigned max = (1u << (4 * n)) - 1;
  *out = (unsigned)((v * 65535ul + max / 2) / max);
  return 1;
}

Status XParseColor(Display *d, Colormap cm, const char *spec, XColor *c)
{
  (void)d; (void)cm;
  if (!spec) return 0;
  c->flags = DoRed | DoGreen | DoBlue;
  if (spec[0] == '#') {
    size_t l = strlen(spec + 1);
    if (l == 0 || l % 3 || l > 12) return 0;
    int n = (int)l / 3;
    unsigned r, g, b;
    if (!hexval(spec + 1, n, &r) || !hexval(spec + 1 + n, n, &g) || !hexval(spec + 1 + 2 * n, n, &b))
      return 0;
    c->red = r;
    c->green = g;
    c->blue = b;
    return 1;
  }
  for (int i = 0; xw_color_names[i].name; i++)
    if (!strcasecmp(xw_color_names[i].name, spec)) {
      c->red = xw_color_names[i].r * 257;
      c->green = xw_color_names[i].g * 257;
      c->blue = xw_color_names[i].b * 257;
      return 1;
    }
  return 0;
}

int XQueryColors(Display *d, Colormap cm, XColor *defs, int n)
{
  (void)d; (void)cm;
  for (int i = 0; i < n; i++) {
    unsigned long p = defs[i].pixel;
    defs[i].red = ((p >> 16) & 255) * 257;
    defs[i].green = ((p >> 8) & 255) * 257;
    defs[i].blue = (p & 255) * 257;
    defs[i].flags = DoRed | DoGreen | DoBlue;
  }
  return 1;
}

/* ------------------------------------------------------------------------ */
/* keyboard                                                                 */

int XLookupString(XKeyEvent *ev, char *buf, int n, KeySym *ks, XComposeStatus *st)
{
  (void)st;
  unsigned int kc = ev->keycode;
  KeySym sym = kc <= MAX_KEYCODE ? keycode_sym[kc] : NoSymbol;
  if (ks) *ks = sym;
  const char *text = kc <= MAX_KEYCODE ? keycode_text[kc] : "";
  char tmp[8];
  snprintf(tmp, sizeof tmp, "%s", text);
  /* Control + letter -> control character, as Xlib does */
  if ((ev->state & ControlMask) && strlen(tmp) == 1 && isalpha((unsigned char)tmp[0]))
    tmp[0] = (char)(toupper((unsigned char)tmp[0]) - '@');
  int len = (int)strlen(tmp);
  if (len > n) len = n;
  memcpy(buf, tmp, len);
  return len;
}

KeyCode XKeysymToKeycode(Display *d, KeySym ks)
{
  (void)d;
  char t[2] = {0, 0};
  if (ks >= 0x20 && ks < 0x7f) t[0] = (char)ks;
  return keycode_for(ks, t);
}

/* ------------------------------------------------------------------------ */
/* images                                                                   */

static unsigned long img_get_pixel(XImage *im, int x, int y)
{
  if (x < 0 || y < 0 || x >= im->width || y >= im->height) return 0;
  return ((uint32_t *)im->data)[(size_t)y * im->width + x];
}

static int img_put_pixel(XImage *im, int x, int y, unsigned long p)
{
  if (x < 0 || y < 0 || x >= im->width || y >= im->height) return 0;
  ((uint32_t *)im->data)[(size_t)y * im->width + x] = (uint32_t)p;
  return 1;
}

static int img_destroy(XImage *im)
{
  free(im->data);
  free(im);
  return 1;
}

XImage *XGetImage(Display *d, Drawable dr, int x, int y, unsigned int width, unsigned int height,
                  unsigned long plane_mask, int format)
{
  (void)d; (void)plane_mask;
  xw_drawable *src = xw_lookup(dr);
  if (!src || !width || !height) return NULL;
  XImage *im = xcalloc(1, sizeof *im);
  im->width = width;
  im->height = height;
  im->format = format;
  im->byte_order = LSBFirst;
  im->bitmap_unit = 32;
  im->bitmap_bit_order = LSBFirst;
  im->bitmap_pad = 32;
  im->depth = src->depth;
  im->bytes_per_line = width * 4;
  im->bits_per_pixel = 32;
  im->red_mask = 0xff0000;
  im->green_mask = 0xff00;
  im->blue_mask = 0xff;
  uint32_t *data = xcalloc((size_t)width * height, sizeof(uint32_t));
  /* windows: read the composited image so children are included */
  const uint32_t *pix = src->pix;
  int sw = src->width, sh = src->height;
  uint32_t *tmp = NULL;
  if (src->is_window && src->nchildren) {
    tmp = xcalloc((size_t)sw * sh, sizeof(uint32_t));
    composite(src, tmp, sw, sh, 0, 0, 0, 0, sw, sh);
    pix = tmp;
  }
  for (unsigned j = 0; j < height; j++)
    for (unsigned i = 0; i < width; i++) {
      int sx = x + (int)i, sy = y + (int)j;
      if (sx >= 0 && sy >= 0 && sx < sw && sy < sh) data[j * width + i] = pix[(size_t)sy * sw + sx];
    }
  free(tmp);
  im->data = (char *)data;
  im->f.get_pixel = img_get_pixel;
  im->f.put_pixel = img_put_pixel;
  im->f.destroy_image = img_destroy;
  return im;
}

/* ------------------------------------------------------------------------ */
/* drawing entry points (rasterising in draw.c)                             */

#define DRAWABLE(dr)                     \
  xw_drawable *dd = xw_lookup(dr);      \
  if (!dd || dd == root || dd->input_only) return 1; \
  xw_mark_dirty(dd)

int XDrawLine(Display *d, Drawable dr, GC gc, int x1, int y1, int x2, int y2)
{
  (void)d;
  DRAWABLE(dr);
  if (tracing())
    fprintf(stderr, "xlib: XDrawLine 0x%lx (%d,%d)-(%d,%d) fn=%d lw=%d ls=%d\n", dr, x1, y1, x2, y2,
            gc->v.function, gc->v.line_width, gc->v.line_style);
  xw_line(dd, gc, x1, y1, x2, y2);
  return 1;
}

int XDrawPoint(Display *d, Drawable dr, GC gc, int x, int y)
{
  if (tracing()) fprintf(stderr, "xlib: XDrawPoint 0x%lx %d,%d\n", dr, x, y);
  (void)d;
  DRAWABLE(dr);
  xw_point(dd, gc, x, y);
  return 1;
}

int XDrawRectangle(Display *d, Drawable dr, GC gc, int x, int y, unsigned int w, unsigned int h)
{
  (void)d;
  DRAWABLE(dr);
  xw_line(dd, gc, x, y, x + w, y);
  xw_line(dd, gc, x + w, y, x + w, y + h);
  xw_line(dd, gc, x + w, y + h, x, y + h);
  xw_line(dd, gc, x, y + h, x, y);
  return 1;
}

int XFillRectangle(Display *d, Drawable dr, GC gc, int x, int y, unsigned int w, unsigned int h)
{
  if (tracing()) fprintf(stderr, "xlib: XFillRectangle 0x%lx %d,%d %ux%u fn=%d fg=%06lx\n", dr, x, y, w, h, gc->v.function, gc->v.foreground);
  (void)d;
  DRAWABLE(dr);
  xw_fill_rect(dd, gc, x, y, w, h);
  return 1;
}

int XDrawArc(Display *d, Drawable dr, GC gc, int x, int y, unsigned int w, unsigned int h, int a1,
             int a2)
{
  (void)d;
  DRAWABLE(dr);
  xw_arc(dd, gc, x, y, w, h, a1, a2, 0);
  return 1;
}

int XFillArc(Display *d, Drawable dr, GC gc, int x, int y, unsigned int w, unsigned int h, int a1,
             int a2)
{
  (void)d;
  DRAWABLE(dr);
  xw_arc(dd, gc, x, y, w, h, a1, a2, 1);
  return 1;
}

int XDrawString(Display *d, Drawable dr, GC gc, int x, int y, const char *s, int n)
{
  (void)d;
  DRAWABLE(dr);
  if (tracing())
    fprintf(stderr, "xlib: XDrawString 0x%lx (%d,%d) fn=%d \"%.*s\"\n", dr, x, y, gc->v.function, n, s);
  xw_text(dd, gc, x, y, s, n);
  return 1;
}

int XCopyArea(Display *d, Drawable src, Drawable dst, GC gc, int sx, int sy, unsigned int w,
              unsigned int h, int dx, int dy)
{
  if (tracing()) fprintf(stderr, "xlib: XCopyArea 0x%lx->0x%lx %d,%d %ux%u -> %d,%d\n", src, dst, sx, sy, w, h, dx, dy);
  (void)d;
  xw_drawable *s = xw_lookup(src), *t = xw_lookup(dst);
  if (!s || !t || s == root || t == root || t->input_only) return 1;
  xw_mark_dirty(t);
  uint32_t *tmp = xcalloc((size_t)w * h, sizeof(uint32_t));
  for (unsigned j = 0; j < h; j++)
    for (unsigned i = 0; i < w; i++) {
      int x = sx + (int)i, y = sy + (int)j;
      tmp[j * w + i] = (x >= 0 && y >= 0 && x < s->width && y < s->height)
                           ? s->pix[(size_t)y * s->width + x]
                           : 0;
    }
  for (unsigned j = 0; j < h; j++)
    for (unsigned i = 0; i < w; i++) {
      int x = dx + (int)i, y = dy + (int)j;
      if (x < 0 || y < 0 || x >= t->width || y >= t->height) continue;
      uint32_t *p = &t->pix[(size_t)y * t->width + x];
      uint32_t v = tmp[j * w + i];
      *p = gc && gc->v.function == GXxor ? (*p ^ v) & 0xffffff : v;
    }
  free(tmp);
  return 1;
}
