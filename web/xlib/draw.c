/*
 * XPPAUT-Web Xlib layer: rasterising lines, rectangles, arcs and text into
 * drawable pixel buffers (0x00RRGGBB).
 */
#include <math.h>
#include <stdlib.h>
#include <X11/Xlib.h>
#include "xw.h"

static inline void plot(xw_drawable *d, GC gc, int x, int y)
{
  if (x < 0 || y < 0 || x >= d->width || y >= d->height) return;
  uint32_t *p = &d->pix[(size_t)y * d->width + x];
  uint32_t fg = (uint32_t)gc->v.foreground & 0xffffff;
  switch (gc->v.function) {
  case GXclear: *p = 0; break;
  case GXand: *p &= fg; break;
  case GXandReverse: *p = fg & ~*p; break;
  case GXandInverted: *p &= ~fg; break;
  case GXnoop: break;
  case GXxor: *p ^= fg; break;
  case GXor: *p |= fg; break;
  case GXnor: *p = ~(fg | *p); break;
  case GXequiv: *p = ~(fg ^ *p); break;
  case GXinvert: *p = ~*p; break;
  case GXorReverse: *p = fg | ~*p; break;
  case GXcopyInverted: *p = ~fg; break;
  case GXorInverted: *p |= ~fg; break;
  case GXnand: *p = ~(fg & *p); break;
  case GXset: *p = 0xffffff; break;
  default: *p = fg; break; /* GXcopy */
  }
  *p &= 0xffffff;
}

void xw_fill_rect(xw_drawable *d, GC gc, int x, int y, int w, int h)
{
  int x0 = x < 0 ? 0 : x, y0 = y < 0 ? 0 : y;
  int x1 = x + w > d->width ? d->width : x + w;
  int y1 = y + h > d->height ? d->height : y + h;
  if (gc->v.function == GXcopy) {
    uint32_t fg = (uint32_t)gc->v.foreground & 0xffffff;
    for (int j = y0; j < y1; j++) {
      uint32_t *row = d->pix + (size_t)j * d->width;
      for (int i = x0; i < x1; i++) row[i] = fg;
    }
    return;
  }
  for (int j = y0; j < y1; j++)
    for (int i = x0; i < x1; i++) plot(d, gc, i, j);
}

void xw_point(xw_drawable *d, GC gc, int x, int y) { plot(d, gc, x, y); }

/* a "pen" for wide lines: square of side line_width centred on the point */
static void pen(xw_drawable *d, GC gc, int x, int y)
{
  int w = gc->v.line_width;
  if (w <= 1) {
    plot(d, gc, x, y);
    return;
  }
  int o = w / 2;
  for (int j = 0; j < w; j++)
    for (int i = 0; i < w; i++) plot(d, gc, x - o + i, y - o + j);
}

void xw_line(xw_drawable *d, GC gc, int x0, int y0, int x1, int y1)
{
  /* Bresenham, both endpoints drawn (X thin-line semantics, CapButt) */
  int dx = abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  int dy = -abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  int err = dx + dy;
  int dashed = gc->v.line_style != LineSolid && gc->ndashes > 0;
  int di = 0, dleft = dashed ? gc->dashes[0] : 0, on = 1;
  if (dashed) { /* apply dash offset */
    int off = gc->v.dash_offset;
    while (off-- > 0)
      if (--dleft <= 0) {
        di = (di + 1) % gc->ndashes;
        dleft = gc->dashes[di];
        on = !on;
      }
  }
  /* XOR lines must not touch a pixel twice (wide pens overlap) */
  if (gc->v.function == GXxor && gc->v.line_width > 1) {
    XGCValues saved = gc->v;
    gc->v.line_width = 0;
    int w = saved.line_width, o = w / 2;
    for (int k = 0; k < w; k++) {
      if (dx >= -dy) xw_line(d, gc, x0, y0 - o + k, x1, y1 - o + k);
      else xw_line(d, gc, x0 - o + k, y0, x1 - o + k, y1);
    }
    gc->v = saved;
    return;
  }
  for (;;) {
    if (!dashed || on) pen(d, gc, x0, y0);
    else if (gc->v.line_style == LineDoubleDash) {
      unsigned long fg = gc->v.foreground;
      gc->v.foreground = gc->v.background;
      pen(d, gc, x0, y0);
      gc->v.foreground = fg;
    }
    if (dashed && --dleft <= 0) {
      di = (di + 1) % gc->ndashes;
      dleft = gc->dashes[di];
      on = !on;
    }
    if (x0 == x1 && y0 == y1) break;
    int e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

static int angle_in(double a, double a1, double a2)
{
  /* is angle a (degrees) within the sweep from a1 by a2 (may be negative) */
  if (a2 >= 360 || a2 <= -360) return 1;
  if (a2 < 0) { a1 += a2; a2 = -a2; }
  double t = fmod(a - a1, 360.0);
  if (t < 0) t += 360;
  return t <= a2;
}

void xw_arc(xw_drawable *d, GC gc, int x, int y, int w, int h, int a1, int a2, int fill)
{
  double cx = x + w / 2.0, cy = y + h /2.0, rx = w / 2.0, ry = h / 2.0;
  double d1 = a1 / 64.0, d2 = a2 / 64.0;
  if (fill) {
    if (rx <= 0 || ry <= 0) return;
    for (int j = y; j < y + h; j++)
      for (int i = x; i < x + w; i++) {
        double px = (i + 0.5 - cx) / rx, py = (j + 0.5 - cy) / ry;
        if (px * px + py * py > 1.0) continue;
        double ang = atan2(-py, px) * 180.0 / M_PI;
        if (angle_in(ang, d1, d2)) plot(d, gc, i, j);
      }
    return;
  }
  if (w == 0 && h == 0) {
    plot(d, gc, x, y);
    return;
  }
  /* outline: polyline along the ellipse, ~1 pixel per segment */
  double sweep = d2;
  if (sweep > 360) sweep = 360;
  if (sweep < -360) sweep = -360;
  int n = (int)(fabs(sweep) / 360.0 * M_PI * (rx + ry)) + 4;
  int px = 0, py = 0;
  for (int k = 0; k <= n; k++) {
    double t = (d1 + sweep * k / n) * M_PI / 180.0;
    int qx = (int)lround(cx + rx * cos(t) - 0.5 * (w > 0));
    int qy = (int)lround(cy - ry * sin(t) - 0.5 * (h > 0));
    if (k > 0 && (qx != px || qy != py)) {
      int fn = gc->v.function;
      if (fn == GXxor) plot(d, gc, qx, qy); /* avoid double XOR at joints */
      else xw_line(d, gc, px, py, qx, qy);
    } else if (k == 0) {
      plot(d, gc, qx, qy);
    }
    px = qx;
    py = qy;
  }
}

void xw_text(xw_drawable *d, GC gc, int x, int y, const char *s, int n)
{
  const xw_font_data *f = xw_font_for(gc->v.font);
  int h = f->ascent + f->descent;
  for (int k = 0; k < n; k++) {
    const unsigned short *rows = f->rows + (size_t)(unsigned char)s[k] * h;
    int gx = x + k * f->width, gy = y - f->ascent;
    for (int r = 0; r < h; r++) {
      unsigned bits = rows[r];
      for (int c = 0; bits; c++, bits >>= 1)
        if (bits & 1) plot(d, gc, gx + c, gy + r);
    }
  }
}

void xw_clear_area(xw_drawable *w, int x, int y, int width, int height)
{
  if (width <= 0) width = w->width - x;
  if (height <= 0) height = w->height - y;
  int x0 = x < 0 ? 0 : x, y0 = y < 0 ? 0 : y;
  int x1 = x + width > w->width ? w->width : x + width;
  int y1 = y + height > w->height ? w->height : y + height;
  xw_mark_dirty(w);
  if (w->bg_kind == XW_BG_NONE) return;
  int tiled = w->bg_kind == XW_BG_PIXMAP && w->bg_tile;
  for (int j = y0; j < y1; j++)
    for (int i = x0; i < x1; i++)
      w->pix[(size_t)j * w->width + i] =
          tiled ? w->bg_tile[(size_t)(j % w->bg_th) * w->bg_tw + (i % w->bg_tw)]
                : (uint32_t)w->bg_pixel & 0xffffff;
}
