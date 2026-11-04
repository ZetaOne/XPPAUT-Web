/*
 * Small read/set hooks into XPP for the page's touch controls (src/touch.ts):
 * the coordinates under a finger, the parameter list, the three Par/Var
 * sliders, data as CSV, and the state as a .set file for auto-save.
 *
 * Nothing here runs XPP's numerics directly: the page changes a parameter by
 * moving XPP's own slider with ordinary pointer events, so XPP re-runs the
 * integration from its own event loop exactly as when the slider is dragged
 * by mouse. WebAssembly build only (links against XPP's globals).
 */
#include <emscripten.h>
#include <stdio.h>
#include <string.h>
#include <X11/Xlib.h>
#include "xpplim.h"
#include "init_conds.h"
#include "xw.h"
#include "autlim.h"
#include "auto_nox.h"
#include "auto_x11.h"

#define PARAMBOX 1 /* init_conds.c */
#define ICBOX 2

extern Window draw_win;
extern int DLeft, DRight, DTop, DBottom;
extern int IXPLT, IYPLT;
extern int NODE, NUPAR, NEQ, NMarkov, storind;
extern float **storage;
extern char upar_names[MAXPAR][11], uvar_names[MAXODE][12];
extern PAR_SLIDER my_par_slide[3];
extern char this_file[];
extern BIFUR Auto;
extern AUTOWIN AutoW;
void get_auto_str(char *xlabel, char *ylabel);

void get_draw_area(void);
void scale_to_real(int i, int j, float *x, float *y);
int get_val(char *name, double *value);
int set_val(char *name, double value);
void redraw_params(void);
void redraw_ics(void);
extern double last_ic[MAXODE];

int xw_slider_where(int k, int *out);

static const char *axis_name(int i)
{
  if (i == 0) return "t";
  if (i > 0 && i <= NEQ) return uvar_names[i - 1];
  return "?";
}

/*
 * The graph point under root coordinates (rx, ry). out: x, y; names: "x\ty"
 * axis names. Returns 1 when the point is inside XPP's current graph area.
 */
EMSCRIPTEN_KEEPALIVE int xw_graph_xy(int rx, int ry, double *out, char *names, int nlen)
{
  int ox, oy;
  /* AUTO's bifurcation diagram: the formula of its own pointer readout
     (auto_x11.c, motion in AutoW.canvas) */
  xw_drawable *a = Auto.exist ? xw_lookup(AutoW.canvas) : NULL;
  if (a && xw_viewable(a)) {
    xw_root_origin(a, &ox, &oy);
    int i = rx - ox, j = ry - oy;
    if (i >= Auto.x0 && i <= Auto.x0 + Auto.wid && j >= Auto.y0 && j <= Auto.y0 + Auto.hgt) {
      out[0] = Auto.xmin + (double)(i - Auto.x0) * (Auto.xmax - Auto.xmin) / (double)Auto.wid;
      out[1] = Auto.ymin + (double)(Auto.y0 - j + Auto.hgt) * (Auto.ymax - Auto.ymin) / (double)Auto.hgt;
      char xl[64], yl[64];
      get_auto_str(xl, yl);
      snprintf(names, nlen, "%s\t%s", xl, yl);
      return 1;
    }
  }
  xw_drawable *w = xw_lookup(draw_win);
  if (!w || !xw_viewable(w)) return 0;
  xw_root_origin(w, &ox, &oy);
  int i = rx - ox, j = ry - oy;
  if (i < 0 || j < 0 || i >= w->width || j >= w->height) return 0;
  get_draw_area();
  /* DBottom is the larger pixel row (y grows downwards) */
  if (i < DLeft || i > DRight || j < DTop || j > DBottom) return 0;
  float x, y;
  scale_to_real(i, j, &x, &y);
  out[0] = x;
  out[1] = y;
  snprintf(names, nlen, "%s\t%s", axis_name(IXPLT), axis_name(IYPLT));
  return 1;
}

/* "name=value\n" for every parameter, then "@name=value\n" for variables */
EMSCRIPTEN_KEEPALIVE int xw_params(char *buf, int n)
{
  int len = 0;
  buf[0] = 0;
  for (int i = 0; i < NUPAR && len < n - 64; i++) {
    double v = 0;
    get_val(upar_names[i], &v);
    len += snprintf(buf + len, n - len, "%s=%.10g\n", upar_names[i], v);
  }
  for (int i = 0; i < NODE + NMarkov && len < n - 64; i++)
    len += snprintf(buf + len, n - len, "@%s=%.10g\n", uvar_names[i], last_ic[i]);
  return len;
}

/*
 * Set up XPP's Par/Var slider k (0-2) for `name` on [lo, hi] at val, as its
 * own "Set Sliders" dialog does. out: slide window's root x, y, width,
 * height. Returns 0 (bad name or range) or 1.
 */
EMSCRIPTEN_KEEPALIVE int xw_slider_setup(int k, const char *name, double lo, double hi, double val, int *out)
{
  if (k < 0 || k > 2 || hi <= lo || val < lo || val > hi || strlen(name) >= 20) return 0;
  PAR_SLIDER *p = &my_par_slide[k];
  char nm[20];
  strcpy(nm, name);
  int idx = find_user_name(PARAMBOX, nm);
  if (idx >= 0) p->type = PARAMBOX;
  else if ((idx = find_user_name(ICBOX, nm)) >= 0) p->type = ICBOX;
  else return 0;
  p->index = idx;
  p->val = val;
  p->lo = lo;
  p->hi = hi;
  strcpy(p->parname, nm);
  set_val(p->parname, val);
  if (p->type == ICBOX) last_ic[p->index] = val;
  redraw_params();
  redraw_ics();
  p->use = 1;
  set_slide_pos(p);
  redraw_slide(p);
  return xw_slider_where(k, out);
}

/* where slider k's slide is (root coordinates), and its length (p->l) */
EMSCRIPTEN_KEEPALIVE int xw_slider_where(int k, int *out)
{
  if (k < 0 || k > 2) return 0;
  PAR_SLIDER *p = &my_par_slide[k];
  xw_drawable *w = xw_lookup(p->slide);
  if (!w || !xw_viewable(w)) return 0;
  xw_root_origin(w, &out[0], &out[1]);
  out[2] = p->l;
  out[3] = w->height;
  return 1;
}

/* what slider k shows: in use, value, low, high; name in `name` */
EMSCRIPTEN_KEEPALIVE int xw_slider_info(int k, double *out, char *name, int nlen)
{
  if (k < 0 || k > 2) return 0;
  PAR_SLIDER *p = &my_par_slide[k];
  out[0] = p->use;
  out[1] = p->val;
  out[2] = p->lo;
  out[3] = p->hi;
  snprintf(name, nlen, "%s", p->use ? p->parname : "");
  return 1;
}

/* the data XPP holds (as in its Data Viewer) as CSV; returns rows written */
EMSCRIPTEN_KEEPALIVE int xw_write_csv(const char *path)
{
  FILE *f = fopen(path, "w");
  if (!f) return -1;
  fputs("t", f);
  for (int i = 0; i < NEQ; i++) fprintf(f, ",%s", uvar_names[i]);
  fputc('\n', f);
  for (int j = 0; j < storind; j++) {
    fprintf(f, "%.10g", storage[0][j]);
    for (int i = 1; i <= NEQ; i++) fprintf(f, ",%.10g", storage[i][j]);
    fputc('\n', f);
  }
  fclose(f);
  return storind;
}

/* set a parameter, or a variable's initial value (ic), as the Parameters
   and Initial Data windows do; returns 0 for an unknown name */
EMSCRIPTEN_KEEPALIVE int xw_set_value(const char *name, double v, int ic)
{
  char nm[20];
  if (strlen(name) >= sizeof nm) return 0;
  strcpy(nm, name);
  int idx = find_user_name(ic ? ICBOX : PARAMBOX, nm);
  if (idx < 0) return 0;
  if (ic) last_ic[idx] = v;
  else set_val(nm, v);
  redraw_params();
  redraw_ics();
  return 1;
}
