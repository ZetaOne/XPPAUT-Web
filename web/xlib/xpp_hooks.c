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

/* ---- everything for the page's "Save session" ----------------------------
 * XPP's own exports, written without its file dialogs into `dir`: each graph
 * window as SVG and PostScript (as Graphic stuff -> SVG / Postscript would),
 * the AUTO diagram as SVG and PostScript (as AUTO's File -> SVG / Postscript),
 * the state as a .set file (File -> Write set) and the data as CSV. Called
 * from the page's input queue (XPP waiting for events), and from bye_bye()
 * just before XPP quits, while the windows and the AUTO diagram still exist.
 * Returns the number of files written. */
#include "struct.h"
#include "graphics.h"
#include "many_pops.h"
#include "my_svg.h"
#include "my_ps.h"
#include "autevd.h"
#include "lunch-new.h"
#include "adj2.h"
#include "arrayplot.h"
#include "integrate.h"
#include "load_eqn.h"
#include <time.h>
#include <sys/stat.h>
#include <stdlib.h>
#include <libgen.h>
#include <ctype.h>

extern GRAPH graph[MAXPOP], *MyGraph;
extern int current_pop, PS_Color, METHOD, MaxPoints;
extern DIAGRAM *bifd;
void draw_svg_axes(void);
void draw_ps_axes(void);
void set_normal_scale(void);
void add_ps_point(double *par, double per, double *uhigh, double *ulow, double *ubar,
                  double a, int type, int flg, int lab, int npar, int icp1, int icp2,
                  int flag2, double *evr, double *evi);

static void auto_points(void)
{
  for (DIAGRAM *d = bifd; d; d = d->next) {
    int type = get_bif_type(d->ibr, d->ntot, d->lab);
    add_ps_point(d->par, d->per, d->uhi, d->ulo, d->ubar, d->norm, type, d->ntot != 1,
                 d->lab, d->nfpar, d->icp1, d->icp2, d->flag2, d->evr, d->evi);
  }
}

extern int NAutoPar;
extern char this_auto_file[];
int save_diagram(FILE *fp, int n);

/* AUTO File > Write pts (write_pts in diagram.c), without its dialog:
   the points of the diagram as plotted, "x y1 y2 type branch flag" */
static int write_diagram_dat(const char *path)
{
  FILE *fp = fopen(path, "w");
  if (!fp) return 0;
  for (DIAGRAM *d = bifd; d; d = d->next) {
    double x, y1, y2, par1 = d->par[d->icp1], par2 = 0;
    if (d->icp2 < NAutoPar) par2 = d->par[d->icp2];
    if (check_plot_type(d->flag2, d->icp1, d->icp2) == 1) {
      auto_xy_plot(&x, &y1, &y2, par1, par2, d->per, d->uhi, d->ulo, d->ubar, d->norm);
      fprintf(fp, "%g %g %g %d %d %d\n", x, y1, y2,
              get_bif_type(d->ibr, d->ntot, d->lab), abs(d->ibr), d->flag2);
    }
  }
  fclose(fp);
  return 1;
}

/* AUTO File > All info (write_info_out in diagram.c), without its dialog */
static int write_allinfo(const char *path)
{
  FILE *fp = fopen(path, "w");
  if (!fp) return 0;
  for (DIAGRAM *d = bifd; d; d = d->next) {
    double par1 = d->par[d->icp1], par2 = par1;
    if (d->icp2 < NAutoPar) par2 = d->par[d->icp2];
    fprintf(fp, "%d %d %d %g %g %g ", get_bif_type(d->ibr, d->ntot, d->lab), d->ibr,
            d->flag2, par1, par2, d->per);
    for (int i = 0; i < NODE; i++) fprintf(fp, "%g ", d->uhi[i]);
    for (int i = 0; i < NODE; i++) fprintf(fp, "%g ", d->ulo[i]);
    for (int i = 0; i < NODE; i++) fprintf(fp, "%g %g ", d->evr[i], d->evi[i]);
    fprintf(fp, "\n");
  }
  fclose(fp);
  return 1;
}

/* AUTO File > Save diagram (save_auto in auto_nox.c), without its dialog:
   loads back with File > Load diagram */
static int write_auto_file(const char *path)
{
  FILE *fp = fopen(path, "w");
  if (!fp) return 0;
  save_auto_numerics(fp);
  save_auto_graph(fp);
  if (save_diagram(fp, NODE) == 1) save_q_file(fp);
  fclose(fp);
  return 1;
}

static int write_set(const char *path)
{
  FILE *fp = fopen(path, "w");
  if (!fp) return 0;
  time_t t = time(0);
  fprintf(fp, "## Set file for %s on %s", this_file, ctime(&t));
  io_int(&NEQ, fp, 0, "Number of equations and auxiliaries");
  io_int(&NUPAR, fp, 0, "Number of parameters");
  io_numerics(0, fp);
  if (METHOD == 6) io_int(&MaxPoints, fp, 0, "Max points for volterra"); /* VOLTERRA */
  io_exprs(0, fp);
  io_graph(0, fp);
  dump_transpose_info(fp, 0);
  dump_h_stuff(fp, 0);
  dump_aplot(fp, 0);
  dump_torus(fp, 0);
  dump_range(fp, 0);
  dump_eqn(fp);
  fclose(fp);
  return 1;
}

#include "nullcline.h"
#include <unistd.h>
extern int NULL_HERE, num_x_n, num_y_n, n_nstore, DF_FLAG, DFSuppress, PltFmtFlag;
extern float *X_n, *Y_n;
extern NCLINES *ncperm;
extern CURVE frz[MAXFRZ];

static int empty_file(const char *path)
{
  struct stat st;
  if (stat(path, &st) == 0 && st.st_size > 0) return 0;
  unlink(path);
  return 1;
}

/* the data of graph window i, as XPP writes it (the window must be the
   current one): Graphic stuff > Export data, the direction field arrows
   and the frozen curves */
static int write_graph_data(const char *dir, int i)
{
  char fn[1024];
  int n = 0;
  FILE *fp;
  /* Export data: x and each plotted y (x y z for a 3D view) */
  snprintf(fn, sizeof fn, "%s/graph-%d-curve.dat", dir, i + 1);
  if ((fp = fopen(fn, "w"))) {
    export_data(fp);
    fclose(fp);
    if (!empty_file(fn)) n++;
  }
  /* direction field arrows "x y x_end y_end": XPP writes them to
     dirfields.dat in the current folder, so do that inside dir */
  if ((DF_FLAG == 1 || DF_FLAG == 4) && PltFmtFlag == 0) {
    char cwd[1024];
    if (getcwd(cwd, sizeof cwd) && chdir(dir) == 0) {
      DFSuppress = 1;
      redraw_dfield();
      DFSuppress = 0; /* redraw_dfield leaves it set when the field does not apply */
      snprintf(fn, sizeof fn, "graph-%d-dirfield.dat", i + 1);
      if (rename("dirfields.dat", fn) == 0 && !empty_file(fn)) n++;
      if (chdir(cwd) != 0) chdir("/");
    }
  }
  /* frozen curves of this window: x y (x y z for 3D) */
  for (int k = 0; k < MAXFRZ; k++) {
    CURVE *c = &frz[k];
    if (c->use != 1 || c->w != graph[i].w || c->len <= 0) continue;
    char name[16];
    int m = 0;
    for (const char *s = c->name; *s && m < 10; s++)
      name[m++] = (isalnum((unsigned char)*s) || *s == '-') ? *s : '_';
    name[m] = 0;
    snprintf(fn, sizeof fn, "%s/graph-%d-frozen-%02d%s%s.dat", dir, i + 1, k + 1, m ? "-" : "", name);
    if (!(fp = fopen(fn, "w"))) continue;
    for (int j = 0; j < c->len; j++) {
      if (c->type > 0 && c->zv) fprintf(fp, "%g %g %g\n", c->xv[j], c->yv[j], c->zv[j]);
      else fprintf(fp, "%g %g\n", c->xv[j], c->yv[j]);
    }
    fclose(fp);
    n++;
  }
  return n;
}

/* Nullcline > Save (save_the_nullclines), without its dialogs: the current
   nullclines, and each frozen set as nullclines-frozen-K.dat */
static int write_nullclines(const char *dir)
{
  char fn[1024];
  int n = 0;
  FILE *fp;
  if (!NULL_HERE) return 0;
  snprintf(fn, sizeof fn, "%s/nullclines.dat", dir);
  if ((fp = fopen(fn, "w"))) {
    dump_clines(fp, X_n, num_x_n, Y_n, num_y_n);
    fclose(fp);
    if (!empty_file(fn)) n++;
  }
  if (n_nstore == 0) return n;
  int k = 1;
  for (NCLINES *z = ncperm; z && (z->nmx || z->nmy); z = z->n, k++) {
    snprintf(fn, sizeof fn, "%s/nullclines-frozen-%d.dat", dir, k);
    if (!(fp = fopen(fn, "w"))) break;
    dump_clines(fp, z->xn, z->nmx, z->yn, z->nmy);
    fclose(fp);
    n++;
  }
  return n;
}

EMSCRIPTEN_KEEPALIVE int xw_export_session(const char *dir)
{
  char fn[1024];
  int n = 0;
  mkdir(dir, 0777);
  /* graph windows: make each the current one in turn, as XPP's expose
     handler does, then put everything back */
  int cp = current_pop;
  Window keep = draw_win;
  for (int i = 0; i < MAXPOP; i++) {
    if (!graph[i].Use) continue;
    current_pop = i;
    MyGraph = &graph[i];
    draw_win = graph[i].w;
    get_draw_area();
    snprintf(fn, sizeof fn, "%s/graph-%d.svg", dir, i + 1);
    if (svg_init(fn, PS_Color)) { svg_restore(); n++; }
    get_draw_area();
    snprintf(fn, sizeof fn, "%s/graph-%d.ps", dir, i + 1);
    if (ps_init(fn, PS_Color)) { ps_restore(); n++; }
    get_draw_area();
    n += write_graph_data(dir, i);
  }
  /* the nullclines (Nullcline > Save), current set and frozen ones */
  n += write_nullclines(dir);
  draw_win = keep;
  MyGraph = &graph[cp];
  current_pop = cp;
  get_draw_area();
  /* the AUTO diagram, if AUTO has computed anything */
  if (bifd && bifd->next) {
    snprintf(fn, sizeof fn, "%s/auto-diagram.svg", dir);
    if (svg_init(fn, PS_Color)) { draw_svg_axes(); auto_points(); svg_end(); n++; }
    snprintf(fn, sizeof fn, "%s/auto-diagram.ps", dir);
    if (ps_init(fn, PS_Color)) { draw_ps_axes(); auto_points(); ps_end(); n++; }
    set_normal_scale();
    /* the files AUTO's File menu writes, under the names it suggests */
    snprintf(fn, sizeof fn, "%s/diagram.dat", dir);
    n += write_diagram_dat(fn);
    snprintf(fn, sizeof fn, "%s/allinfo.dat", dir);
    n += write_allinfo(fn);
    snprintf(fn, sizeof fn, "%s/%s.auto", dir, basename(this_auto_file));
    n += write_auto_file(fn);
  }
  snprintf(fn, sizeof fn, "%s/state.set", dir);
  n += write_set(fn);
  snprintf(fn, sizeof fn, "%s/data.csv", dir);
  if (xw_write_csv(fn) >= 0) n++;
  return n;
}

/* bye_bye() calls this first (xppaut/main.c): the page's Save session after
   quitting still gets the figures, the AUTO diagram and the state */
void xw_before_quit(void)
{
  extern int Xup;
  if (!Xup) return;
  xw_export_session("/xw-session-quit");
}
