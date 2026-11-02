/*
 * Rasterisation test: draws lines (several widths, all directions), arcs,
 * filled arcs and rectangles, dashes, XOR and text into one window, then
 * waits. Built against the real libX11 (run on Xvfb) and against our Xlib
 * layer (headless harness), the two images should match pixel for pixel.
 * See tests/xdraw/run.sh.
 */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>

#define W 760
#define H 560

static Display *dpy;
static Window win;
static GC gc;

static void draw(void)
{
  XSetForeground(dpy, gc, 0xffffff);
  XFillRectangle(dpy, win, gc, 0, 0, W, H);
  XSetForeground(dpy, gc, 0x000000);

  /* stars of lines: widths 0..3, 24 directions, two lengths */
  int widths[] = {0, 1, 2, 3};
  for (int k = 0; k < 4; k++) {
    int cx = 90 + k * 180, cy = 90;
    XSetLineAttributes(dpy, gc, widths[k], LineSolid, CapButt, JoinMiter);
    for (int i = 0; i < 24; i++) {
      double a = i * M_PI / 12 + 0.1;
      int r = i % 2 ? 70 : 45;
      XDrawLine(dpy, win, gc, cx, cy, cx + (int)lround(r * cos(a)), cy + (int)lround(r * sin(a)));
    }
  }
  /* polylines of short segments (like XPP trajectories), widths 0..2 */
  for (int k = 0; k < 3; k++) {
    XSetLineAttributes(dpy, gc, k, LineSolid, CapButt, JoinBevel);
    XSetForeground(dpy, gc, k == 2 ? 0xff0000 : 0x000000);
    int px = 20 + k * 250, py = 260;
    for (int i = 1; i <= 60; i++) {
      double t = i / 60.0;
      int x = 20 + k * 250 + (int)(200 * t), y = 260 - (int)(60 * sin(6 * t)) + (int)(20 * t);
      XDrawLine(dpy, win, gc, px, py, x, y);
      px = x;
      py = y;
    }
  }
  XSetForeground(dpy, gc, 0x000000);
  /* arcs and circles, thin and wide, odd and even sizes */
  int sizes[] = {6, 7, 10, 13, 20, 25, 36, 41};
  for (int i = 0; i < 8; i++) {
    XSetLineAttributes(dpy, gc, 0, LineSolid, CapButt, JoinMiter);
    XDrawArc(dpy, win, gc, 20 + i * 60, 340, sizes[i], sizes[i], 0, 360 * 64);
    XDrawArc(dpy, win, gc, 20 + i * 60, 390, sizes[i] + 10, sizes[i], 30 * 64, 200 * 64);
    XFillArc(dpy, win, gc, 20 + i * 60, 440, sizes[i], sizes[i], 0, 360 * 64);
    XSetLineAttributes(dpy, gc, 2, LineSolid, CapButt, JoinMiter);
    XDrawArc(dpy, win, gc, 20 + i * 60, 490, sizes[i], sizes[i], 0, 360 * 64);
  }
  /* dashes and rectangles */
  XSetLineAttributes(dpy, gc, 0, LineOnOffDash, CapButt, JoinMiter);
  XDrawLine(dpy, win, gc, 520, 340, 740, 340);
  XDrawLine(dpy, win, gc, 520, 350, 740, 420);
  char dl[] = {3, 2};
  XSetDashes(dpy, gc, 0, dl, 2);
  XDrawLine(dpy, win, gc, 520, 360, 740, 360);
  XSetLineAttributes(dpy, gc, 0, LineSolid, CapButt, JoinMiter);
  XDrawRectangle(dpy, win, gc, 520, 430, 40, 20);
  XFillRectangle(dpy, win, gc, 570, 430, 40, 20);
  /* XOR */
  XSetFunction(dpy, gc, GXxor);
  XSetForeground(dpy, gc, 0xffffff);
  XFillRectangle(dpy, win, gc, 600, 440, 40, 20);
  XSetLineAttributes(dpy, gc, 2, LineSolid, CapButt, JoinMiter);
  XDrawLine(dpy, win, gc, 520, 470, 740, 500);
  XSetFunction(dpy, gc, GXcopy);
  XSetForeground(dpy, gc, 0x000000);
  /* text */
  XFontStruct *f = XLoadQueryFont(dpy, "fixed");
  if (f) {
    XSetFont(dpy, gc, f->fid);
    XDrawString(dpy, win, gc, 520, 530, "XPP 0.123 (G)o", 14);
  }
  XFlush(dpy);
}

int main(void)
{
  dpy = XOpenDisplay(NULL);
  if (!dpy) { fprintf(stderr, "no display\n"); return 1; }
  int scr = DefaultScreen(dpy);
  win = XCreateSimpleWindow(dpy, RootWindow(dpy, scr), 0, 0, W, H, 0, 0, 0xffffff);
  XStoreName(dpy, win, "drawtest");
  XSelectInput(dpy, win, ExposureMask);
  gc = XCreateGC(dpy, win, 0, NULL);
  XMapWindow(dpy, win);
  for (;;) {
    XEvent ev;
    XNextEvent(dpy, &ev);
    if (ev.type == Expose && ev.xexpose.count == 0) draw();
  }
}
