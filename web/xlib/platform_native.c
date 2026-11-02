/*
 * XPPAUT-Web Xlib layer: native (headless) platform for testing.
 *
 * Input comes from a script named by XPPWEB_SCRIPT. One command runs each
 * time XPP is idle (blocked waiting for an event with an empty queue), so
 * screenshots always show a fully drawn interface.
 *
 *   window "<title prefix>"   following coordinates are relative to that
 *                             top-level window ("window root" to reset,
 *                             "window *" = newest window except the main one,
 *                             for windows with random titles)
 *   move X Y                  move the pointer
 *   click X Y [BUTTON]        press and release (default button 1)
 *   press X Y [BUTTON] / release X Y [BUTTON]
 *   key NAME                  e.g. key i, key Return, key Escape, key ctrl+c
 *   type TEXT                 type the rest of the line
 *   close                     ask the current window to close (WM_DELETE)
 *   screenshot FILE.ppm       whole screen
 *   shot FILE.ppm             current window only
 *   list                      print top-level windows to stderr
 *   probe X Y                 print the window chain under a point
 *   sleep MS                  no-op here (the reference driver needs it)
 *   quit                      exit(0)
 *
 * At the end of the script XPP exits. Lines starting with # are comments.
 * XPPWEB_SCREEN=WxH sets the screen size (default 1280x1024).
 * XPPWEB_NOWM=1 turns off the built-in window manager (no placement, no
 * ConfigureNotify), to match the real XPP on a bare Xvfb in
 * scripts/compare-gui.sh. Windows are then raised before being used.
 */
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <X11/Xlib.h>
#include <X11/keysym.h>
#include "xw.h"

static FILE *script;
static int script_line;
static Window cur_win; /* None = root coordinates */
static int sw, sh;

static void screen_size(void)
{
  if (sw) return;
  xw_bare_x = getenv("XPPWEB_NOWM") != NULL;
  sw = 1280;
  sh = 1024;
  const char *s = getenv("XPPWEB_SCREEN");
  if (s) sscanf(s, "%dx%d", &sw, &sh);
}

int xw_platform_screen_width(void) { screen_size(); return sw; }
int xw_platform_screen_height(void) { screen_size(); return sh; }
void xw_platform_poll(void) {}
void xw_platform_bell(void) {}

/* A minimal window manager: windows first mapped at (0,0) after the main
   window are tiled to its right, so tests can see and click them all. */
#define MAX_PLACED 1024
static Window placed[MAX_PLACED];
static int nplaced, next_x = -1, next_y, row_h;

void xw_platform_toplevel_changed(Window w)
{
  xw_drawable *t = xw_lookup(w);
  if (!t || !t->mapped || getenv("XPPWEB_NOWM")) return;
  for (int i = 0; i < nplaced; i++)
    if (placed[i] == w) return;
  if (nplaced < MAX_PLACED) placed[nplaced++] = w;
  if (nplaced == 1 || t->x || t->y) {
    if (next_x < 0) { next_x = t->x + t->width + 8; next_y = 0; }
    return;
  }
  screen_size();
  if (next_x + t->width > sw) { next_x = 650; next_y += row_h + 8; row_h = 0; }
  xw_input_configure(w, next_x, next_y, 0, 0);
  next_x += t->width + 8;
  if (t->height > row_h) row_h = t->height;
}
void xw_platform_cursor(Window w, int shape) { (void)w; (void)shape; }

static void fail(const char *msg, const char *arg)
{
  fprintf(stderr, "xppweb script line %d: %s %s\n", script_line, msg, arg ? arg : "");
  exit(2);
}

static Window find_window(const char *prefix)
{
  Window tops[256];
  int n = xw_toplevels(tops, 256);
  if (!strcmp(prefix, "*")) { /* newest mapped window other than the first */
    Window best = None, first = None;
    for (int i = 0; i < n; i++) {
      xw_drawable *t = xw_lookup(tops[i]);
      if (!t || !t->mapped) continue;
      if (first == None || tops[i] < first) first = tops[i];
    }
    for (int i = 0; i < n; i++) {
      xw_drawable *t = xw_lookup(tops[i]);
      if (t && t->mapped && tops[i] != first && tops[i] > best) best = tops[i];
    }
    return best;
  }
  for (int i = n - 1; i >= 0; i--) { /* topmost first */
    xw_drawable *t = xw_lookup(tops[i]);
    if (t && t->mapped && !strncmp(xw_title(tops[i]), prefix, strlen(prefix))) return tops[i];
  }
  return None;
}

static void to_root(int *x, int *y)
{
  if (cur_win == None) return;
  xw_drawable *t = xw_lookup(cur_win);
  if (!t) fail("window no longer exists", NULL);
  int ox, oy;
  xw_root_origin(t, &ox, &oy);
  *x += ox;
  *y += oy;
}

static void write_ppm(const char *path, const uint8_t *rgba, int w, int h)
{
  FILE *f = fopen(path, "wb");
  if (!f) fail("cannot write", path);
  fprintf(f, "P6\n%d %d\n255\n", w, h);
  for (int i = 0; i < w * h; i++) fwrite(rgba + 4 * i, 1, 3, f);
  fclose(f);
}

static void screenshot(const char *path)
{
  screen_size();
  uint8_t *screen = malloc((size_t)sw * sh * 4);
  for (int i = 0; i < sw * sh; i++) { /* desktop background */
    screen[4 * i] = 0x30;
    screen[4 * i + 1] = 0x38;
    screen[4 * i + 2] = 0x48;
    screen[4 * i + 3] = 255;
  }
  Window tops[256];
  int n = xw_toplevels(tops, 256);
  for (int k = 0; k < n; k++) {
    xw_drawable *t = xw_lookup(tops[k]);
    if (!t || !t->mapped) continue;
    int w, h, ox, oy;
    uint8_t *img = xw_render(tops[k], &w, &h);
    xw_root_origin(t, &ox, &oy);
    for (int y = 0; y < h; y++)
      for (int x = 0; x < w; x++) {
        int X = ox + x, Y = oy + y;
        if (X < 0 || Y < 0 || X >= sw || Y >= sh) continue;
        memcpy(screen + 4 * ((size_t)Y * sw + X), img + 4 * ((size_t)y * w + x), 4);
      }
  }
  write_ppm(path, screen, sw, sh);
  free(screen);
}

static void list_windows(void)
{
  Window tops[256];
  int n = xw_toplevels(tops, 256);
  for (int k = 0; k < n; k++) {
    xw_drawable *t = xw_lookup(tops[k]);
    fprintf(stderr, "  0x%lx %s %dx%d+%d+%d \"%s\"\n", tops[k], t->mapped ? "mapped  " : "unmapped",
            t->width, t->height, t->x, t->y, xw_title(tops[k]));
  }
}

static struct { const char *name; KeySym sym; } keynames[] = {
  {"Return", XK_Return}, {"Escape", XK_Escape}, {"Tab", XK_Tab}, {"BackSpace", XK_BackSpace},
  {"Delete", XK_Delete}, {"Up", XK_Up}, {"Down", XK_Down}, {"Left", XK_Left}, {"Right", XK_Right},
  {"Home", XK_Home}, {"End", XK_End}, {"Page_Up", XK_Page_Up}, {"Page_Down", XK_Page_Down},
  {"space", XK_space}, {"F1", XK_F1}, {"F2", XK_F2}, {"Insert", XK_Insert}, {NULL, 0}};

static void key(const char *spec)
{
  unsigned state = 0;
  for (;;) {
    if (!strncmp(spec, "ctrl+", 5)) { state |= ControlMask; spec += 5; }
    else if (!strncmp(spec, "shift+", 6)) { state |= ShiftMask; spec += 6; }
    else break;
  }
  KeySym ks = NoSymbol;
  char text[8] = "";
  if (strlen(spec) == 1) {
    ks = (unsigned char)spec[0];
    text[0] = spec[0];
    if (isupper((unsigned char)spec[0])) state |= ShiftMask;
  } else {
    for (int i = 0; keynames[i].name; i++)
      if (!strcmp(keynames[i].name, spec)) ks = keynames[i].sym;
    if (ks == NoSymbol) fail("unknown key", spec);
    if (ks == XK_Return) strcpy(text, "\r");
    else if (ks == XK_Tab) strcpy(text, "\t");
    else if (ks == XK_BackSpace) strcpy(text, "\b");
    else if (ks == XK_Escape) strcpy(text, "\033");
    else if (ks == XK_Delete) strcpy(text, "\177");
    else if (ks == XK_space) strcpy(text, " ");
  }
  xw_input_key(ks, text, 1, state);
  xw_input_key(ks, text, 0, state);
}

/* run commands until one produces events; returns when the queue is non-empty */
void xw_platform_wait(void)
{
  if (!script) {
    const char *path = getenv("XPPWEB_SCRIPT");
    if (!path) {
      fprintf(stderr, "xppweb: no input (set XPPWEB_SCRIPT to drive the interface)\n");
      exit(1);
    }
    script = fopen(path, "r");
    if (!script) fail("cannot open script", path);
  }
  char line[1024];
  while (xw_queue_length() == 0) {
    if (!fgets(line, sizeof line, script)) {
      fflush(stdout);
      exit(0);
    }
    script_line++;
    line[strcspn(line, "\r\n")] = 0;
    char *p = line;
    while (isspace((unsigned char)*p)) p++;
    if (!*p || *p == '#') continue;
    char cmd[32];
    int x = 0, y = 0, b = 1, used = 0;
    if (sscanf(p, "%31s%n", cmd, &used) != 1) continue;
    char *rest = p + used;
    while (isspace((unsigned char)*rest)) rest++;
    if (!strcmp(cmd, "window")) {
      char *q = rest;
      if (*q == '"') {
        q++;
        char *e = strchr(q, '"');
        if (e) *e = 0;
      }
      if (!strcmp(q, "root")) cur_win = None;
      else if ((cur_win = find_window(q)) == None) {
        list_windows();
        fail("no mapped window titled", q);
      } else xw_input_raise(cur_win);
    } else if (!strcmp(cmd, "move") || !strcmp(cmd, "click") || !strcmp(cmd, "press") ||
               !strcmp(cmd, "release")) {
      if (sscanf(rest, "%d %d %d", &x, &y, &b) < 2) fail("expected X Y", NULL);
      to_root(&x, &y);
      if (cur_win != None) xw_input_raise(cur_win);
      unsigned bmask = Button1Mask << (b - 1);
      if (!strcmp(cmd, "move")) xw_input_motion(x, y, 0);
      if (!strcmp(cmd, "click") || !strcmp(cmd, "press")) xw_input_button(x, y, b, 1, 0);
      if (!strcmp(cmd, "click") || !strcmp(cmd, "release")) xw_input_button(x, y, b, 0, bmask);
    } else if (!strcmp(cmd, "key")) {
      key(rest);
    } else if (!strcmp(cmd, "type")) {
      for (char *c = rest; *c; c++) {
        char one[2] = {*c, 0};
        if (*c == ' ') key("space");
        else key(one);
      }
    } else if (!strcmp(cmd, "close")) {
      if (cur_win == None) fail("close needs a window", NULL);
      xw_input_close(cur_win);
    } else if (!strcmp(cmd, "screenshot")) {
      screenshot(rest);
    } else if (!strcmp(cmd, "shot")) {
      if (cur_win == None) fail("shot needs a window", NULL);
      int w, h;
      uint8_t *img = xw_render(cur_win, &w, &h);
      write_ppm(rest, img, w, h);
    } else if (!strcmp(cmd, "probe")) {
      if (sscanf(rest, "%d %d", &x, &y) < 2) fail("expected X Y", NULL);
      to_root(&x, &y);
      xw_input_motion(x, y, 0);
      extern xw_drawable *xw_pointer_window(void);
      for (xw_drawable *w = xw_pointer_window(); w; w = w->parent)
        fprintf(stderr, "  probe 0x%lx %dx%d+%d+%d bw=%d bg=%d/%06lx mask=%lx\n", w->id, w->width,
                w->height, w->x, w->y, w->border_width, w->bg_kind, w->bg_pixel, w->event_mask);
    } else if (!strcmp(cmd, "list")) {
      list_windows();
    } else if (!strcmp(cmd, "sleep")) {
      /* we always run at idle; only scripts/xref.py needs to wait */
    } else if (!strcmp(cmd, "quit")) {
      exit(0);
    } else {
      fail("unknown command", cmd);
    }
  }
}
