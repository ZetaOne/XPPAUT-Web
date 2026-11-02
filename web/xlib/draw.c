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

static int dash_on(GC gc, double along)
{
  /* is the dash pattern "on" at this distance along the line */
  int total = 0;
  for (int i = 0; i < gc->ndashes; i++) total += gc->dashes[i];
  if (total <= 0) return 1;
  double t = fmod(along + gc->v.dash_offset, (double)total);
  for (int i = 0; i < gc->ndashes; i++) {
    if (t < gc->dashes[i]) return i % 2 == 0;
    t -= gc->dashes[i];
  }
  return 1;
}

/* Wide line (any width >= 1) as the X server draws it: the rectangle of
   half-width w/2 around the segment (extended by w/2 for CapProjecting),
   filled by the X polygon rule. Coordinates are pixel centres; a pixel
   whose centre lies exactly on an edge is drawn only if the inside is to
   its right (or, for a horizontal edge, below it). */
static int on_inside(double ex, double ey, double e)
{
  /* edge direction (ex,ey), edge function e (>0 inside) */
  if (e > 1e-9) return 1;
  if (e < -1e-9) return 0;
  return ey < 0 || (ey == 0 && ex > 0); /* left edge, or top edge */
}

static void wide_line(xw_drawable *d, GC gc, int x0, int y0, int x1, int y1)
{
  double w = gc->v.line_width, hw = w / 2.0;
  double dx = x1 - x0, dy = y1 - y0, len = sqrt(dx * dx + dy * dy);
  if (len == 0) {
    if (gc->v.cap_style == CapProjecting)
      xw_fill_rect(d, gc, (int)ceil(x0 - hw), (int)ceil(y0 - hw), (int)w, (int)w);
    return;
  }
  double ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  double ext = gc->v.cap_style == CapProjecting ? hw : 0;
  /* corners, clockwise in screen coordinates (y down) */
  double px[4], py[4];
  double sx = x0 - ux * ext, sy = y0 - uy * ext, ex_ = x1 + ux * ext, ey_ = y1 + uy * ext;
  px[0] = sx + nx * hw; py[0] = sy + ny * hw;
  px[1] = ex_ + nx * hw; py[1] = ey_ + ny * hw;
  px[2] = ex_ - nx * hw; py[2] = ey_ - ny * hw;
  px[3] = sx - nx * hw; py[3] = sy - ny * hw;
  /* orient so that the inside has a positive edge function */
  double area = 0;
  for (int i = 0; i < 4; i++) area += px[i] * py[(i + 1) % 4] - px[(i + 1) % 4] * py[i];
  int dir = area > 0 ? 1 : -1;
  int bx0 = (int)floor(fmin(fmin(px[0], px[1]), fmin(px[2], px[3]))) - 1;
  int bx1 = (int)ceil(fmax(fmax(px[0], px[1]), fmax(px[2], px[3]))) + 1;
  int by0 = (int)floor(fmin(fmin(py[0], py[1]), fmin(py[2], py[3]))) - 1;
  int by1 = (int)ceil(fmax(fmax(py[0], py[1]), fmax(py[2], py[3]))) + 1;
  int dashed = gc->v.line_style != LineSolid && gc->ndashes > 0;
  for (int y = by0; y <= by1; y++)
    for (int x = bx0; x <= bx1; x++) {
      int in = 1;
      for (int i = 0; i < 4 && in; i++) {
        int j = (i + 1) % 4;
        double ex = (px[j] - px[i]) * dir, ey = (py[j] - py[i]) * dir;
        double e = ex * (y - py[i]) - ey * (x - px[i]);
        in = on_inside(ex, ey, e);
      }
      if (!in) continue;
      if (dashed && !dash_on(gc, (x - x0) * ux + (y - y0) * uy)) continue;
      plot(d, gc, x, y);
    }
  if (gc->v.cap_style == CapRound) {
    xw_arc(d, gc, (int)lround(x0 - hw), (int)lround(y0 - hw), (int)w, (int)w, 0, 360 * 64, 1);
    xw_arc(d, gc, (int)lround(x1 - hw), (int)lround(y1 - hw), (int)w, (int)w, 0, 360 * 64, 1);
  }
}

void xw_line(xw_drawable *d, GC gc, int x0, int y0, int x1, int y1)
{
  if (gc->v.line_width >= 1) { /* X: only width 0 is a "thin" line */
    wide_line(d, gc, x0, y0, x1, y1);
    return;
  }
  /* zero-width: Bresenham, both endpoints drawn */
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
  for (;;) {
    if (!dashed || on) plot(d, gc, x0, y0);
    else if (gc->v.line_style == LineDoubleDash) {
      unsigned long fg = gc->v.foreground;
      gc->v.foreground = gc->v.background;
      plot(d, gc, x0, y0);
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

/* plot the (up to 4) symmetric points of a quadrant point, each once */
static void ellipse_points(xw_drawable *d, GC gc, int cx, int cy, int px, int py, double a1, double a2)
{
  int pts[4][2] = {{cx + px, cy - py}, {cx - px, cy - py}, {cx - px, cy + py}, {cx + px, cy + py}};
  int n = (px == 0 || py == 0) ? 2 : 4;
  if (px == 0 && py == 0) n = 1;
  for (int k = 0; k < 4; k++) {
    if (n == 2 && ((px == 0 && (k == 1 || k == 2)) || (py == 0 && (k == 2 || k == 3)))) continue;
    if (n == 1 && k > 0) break;
    int qx = pts[k][0], qy = pts[k][1];
    if (!(a2 >= 360 || a2 <= -360)) {
      double ang = atan2(-(double)(qy - cy), (double)(qx - cx)) * 180.0 / M_PI;
      if (!angle_in(ang, a1, a2)) continue;
    }
    plot(d, gc, qx, qy);
  }
}

/* zero-width ellipse with integer centre and semi-axes, both edges of the
   bounding box included, as the X server draws it (midpoint algorithm) */
static void thin_ellipse(xw_drawable *d, GC gc, int cx, int cy, int a, int b, double a1, double a2)
{
  if (a == 0 || b == 0) {
    xw_line(d, gc, cx - a, cy - b, cx + a, cy + b);
    return;
  }
  long a2s = (long)a * a, b2s = (long)b * b;
  long px = 0, py = b;
  /* region 1: slope > -1 */
  double dp = b2s - a2s * b + 0.25 * a2s;
  while (b2s * px < a2s * py) {
    ellipse_points(d, gc, cx, cy, (int)px, (int)py, a1, a2);
    if (dp < 0) dp += b2s * (2 * px + 3);
    else { dp += b2s * (2 * px + 3) + a2s * (-2 * py + 2); py--; }
    px++;
  }
  /* region 2 */
  dp = b2s * (px + 0.5) * (px + 0.5) + a2s * (py - 1.0) * (py - 1.0) - (double)a2s * b2s;
  while (py >= 0) {
    ellipse_points(d, gc, cx, cy, (int)px, (int)py, a1, a2);
    if (dp > 0) dp += a2s * (-2 * py + 3);
    else { dp += b2s * (2 * px + 2) + a2s * (-2 * py + 3); px++; }
    py--;
  }
}

void xw_arc(xw_drawable *d, GC gc, int x, int y, int w, int h, int a1, int a2, int fill)
{
  double cx = x + w / 2.0, cy = y + h /2.0, rx = w / 2.0, ry = h / 2.0;
  double d1 = a1 / 64.0, d2 = a2 / 64.0;
  int full = d2 >= 360 || d2 <= -360;
  if (fill) {
    /* X: pixel centres are the integer points; the ellipse is centred at
       (x+w/2, y+h/2); a centre exactly on the boundary is inside only on
       the left half or at the top. Doubled coordinates keep it exact. */
    if (w <= 0 || h <= 0) return;
    long long A = w, B = h, AB = A * A * B * B;
    for (int j = y; j <= y + h; j++)
      for (int i = x; i <= x + w; i++) {
        long long DX = 2LL * i - (2LL * x + w), DY = 2LL * j - (2LL * y + h);
        long long v = B * B * DX * DX + A * A * DY * DY;
        if (v > AB) continue;
        if (v == AB && !(DX < 0 || (DX == 0 && DY < 0))) continue;
        if (!full && !angle_in(atan2(-(double)DY, (double)DX) * 180.0 / M_PI, d1, d2)) continue;
        plot(d, gc, i, j);
      }
    return;
  }
  if (gc->v.line_width >= 1) {
    /* wide arc: the band between ellipses of semi-axes a +- lw/2, same
       pixel-centre rule */
    double hw = gc->v.line_width / 2.0;
    double ao = rx + hw, bo = ry + hw, ai = rx - hw, bi = ry - hw;
    for (int j = (int)floor(cy - bo) - 1; j <= (int)ceil(cy + bo) + 1; j++)
      for (int i = (int)floor(cx - ao) - 1; i <= (int)ceil(cx + ao) + 1; i++) {
        double px = i - cx, py = j - cy;
        double vo = (px * px) / (ao * ao) + (py * py) / (bo * bo);
        if (vo > 1 + 1e-12) continue;
        if (fabs(vo - 1) <= 1e-12 && !(px < 0 || (px == 0 && py < 0))) continue;
        if (ai > 0 && bi > 0) {
          double vi = (px * px) / (ai * ai) + (py * py) / (bi * bi);
          if (vi < 1 - 1e-12) continue;
          if (fabs(vi - 1) <= 1e-12 && !(px > 0 || (px == 0 && py > 0))) continue;
        }
        if (!full && !angle_in(atan2(-py, px) * 180.0 / M_PI, d1, d2)) continue;
        plot(d, gc, i, j);
      }
    return;
  }
  if (w == 0 && h == 0) {
    plot(d, gc, x, y);
    return;
  }
  if (gc->v.line_width == 0 && w % 2 == 0 && h % 2 == 0) {
    thin_ellipse(d, gc, x + w / 2, y + h / 2, w / 2, h / 2, d1, d2);
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
