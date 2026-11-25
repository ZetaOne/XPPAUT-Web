/*
 * Tools for discrete dynamical systems:
 *   - stable manifold of a saddle fixed point of a planar map
 *     (Numerics/stabLe manifold sets the parameters; Sing pts computes)
 *   - cobweb diagrams for maps (Viewaxes/Cobweb)
 * Curves drawn here are kept in a small overlay store so that they survive
 * redraws, postscript and svg output.
 */
#include "mapview.h"
#include "mapmanifold.h"
#include "ggets.h"
#include "browse.h"
#include "graphics.h"
#include "graf_par.h"
#include "my_ps.h"
#include "dialog_box.h"
#include "pop_list.h"
#include "struct.h"
#include "xpplim.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PSFMT 1

extern GRAPH *MyGraph;
extern int NODE,METHOD,PltFmtFlag;
extern int StableManifoldColor;
extern double last_ic[MAXODE];
extern int (*rhs)();
extern char uvar_names[MAXODE][12];
extern int XNullColor,YNullColor;
extern double DELTA_T,TEND,TRANS;

/* ------------------------------------------------------------------ */
/*  overlay store                                                      */
/* ------------------------------------------------------------------ */

typedef struct ovchain {
  int col,xv,yv;
  int n,cap;
  float *s;                 /* 4 floats per segment */
  struct ovchain *next;
} OvChain;

static OvChain *ov_head=NULL,*ov_tail=NULL;

static OvChain *ov_new(int col,int xv,int yv)
{
  OvChain *c=(OvChain *)calloc(1,sizeof(OvChain));
  if(c==NULL)return NULL;
  c->col=col;
  c->xv=xv;
  c->yv=yv;
  if(ov_tail)ov_tail->next=c;
  else ov_head=c;
  ov_tail=c;
  return c;
}

static void ov_seg(OvChain *c,double x1,double y1,double x2,double y2)
{
  if(c==NULL)return;
  if(c->n>=c->cap){
    int nc=2*c->cap+64;
    float *ns=(float *)realloc(c->s,4*nc*sizeof(float));
    if(ns==NULL)return;
    c->s=ns;
    c->cap=nc;
  }
  c->s[4*c->n]=(float)x1;
  c->s[4*c->n+1]=(float)y1;
  c->s[4*c->n+2]=(float)x2;
  c->s[4*c->n+3]=(float)y2;
  c->n++;
}

static int cw_active=0;   /* a live cobweb is attached to the plot   */
static int cw_ivar=0;     /* its variable (0-based)                  */
static void cobweb_draw(void);

void map_overlay_clear(void)
{
  OvChain *c=ov_head,*d;
  cw_active=0;
  while(c){
    d=c->next;
    if(c->s)free(c->s);
    free(c);
    c=d;
  }
  ov_head=ov_tail=NULL;
}

void map_overlay_redraw(void)
{
  OvChain *c;
  int i,any=0;
  if(MyGraph==NULL||MyGraph->ThreeDFlag||MyGraph->TimeFlag)return;
  if(cw_active&&METHOD==0&&MyGraph->xv[0]==cw_ivar+1&&
     MyGraph->yv[0]==cw_ivar+1){
    cobweb_draw();
    any=1;
  }
  for(c=ov_head;c;c=c->next){
    if(c->xv!=MyGraph->xv[0]||c->yv!=MyGraph->yv[0])continue;
    set_linestyle(c->col);
    for(i=0;i<c->n;i++)
      line_abs(c->s[4*i],c->s[4*i+1],c->s[4*i+2],c->s[4*i+3]);
    any=1;
  }
  if(any){
    if(PltFmtFlag==PSFMT)ps_stroke();
    set_linestyle(MyGraph->color[0]);
  }
}

/* ------------------------------------------------------------------ */
/*  the map as seen by the algorithms                                  */
/* ------------------------------------------------------------------ */

typedef struct {
  double base[MAXODE];  /* values of all variables                    */
  int i1,i2;            /* indices of the free variables (0-based)    */
} XppMap;

static int xpp_map2(const double *x,double *y,void *ctx)
{
  XppMap *m=(XppMap *)ctx;
  double in[MAXODE],out[MAXODE];
  int i;
  for(i=0;i<NODE;i++)in[i]=m->base[i];
  in[m->i1]=x[0];
  in[m->i2]=x[1];
  (*rhs)(0.0,in,out,NODE);
  y[0]=out[m->i1];
  y[1]=out[m->i2];
  return 1;
}

/* ------------------------------------------------------------------ */
/*  parameters of the stable manifold computation (Numerics menu)      */
/* ------------------------------------------------------------------ */

double MF_INIT=1e-3;      /* initial step                       */
double MF_LEN=100.0;       /* arclength                          */
double MF_AMIN=0.2;
double MF_AMAX=0.3;
double MF_DAMIN=1e-6;     /* (Delta alpha)_min                  */
double MF_DAMAX=1e-5;     /* (Delta alpha)_max                  */
double MF_DMIN=1e-6;      /* Delta_min                          */
double MF_DMAX=0.1;       /* Delta_max                          */

void map_manifold_params(void)
{
  static char *n[]={"Arclength","Initial step","alpha_min","alpha_max",
		    "(D alpha)_min","(D alpha)_max","Delta_min","Delta_max"};
  char values[8][MAX_LEN_SBOX];
  int status;
  sprintf(values[0],"%g",MF_LEN);
  sprintf(values[1],"%g",MF_INIT);
  sprintf(values[2],"%g",MF_AMIN);
  sprintf(values[3],"%g",MF_AMAX);
  sprintf(values[4],"%g",MF_DAMIN);
  sprintf(values[5],"%g",MF_DAMAX);
  sprintf(values[6],"%g",MF_DMIN);
  sprintf(values[7],"%g",MF_DMAX);
  status=do_string_box(8,8,1,"Stable manifolds of maps",n,values,25);
  if(status!=0){
    double v[8];
    int i,bad=0;
    for(i=0;i<8;i++)v[i]=atof(values[i]);
    for(i=0;i<8;i++)if(!(v[i]>0.0))bad=1;
    if(v[2]>v[3]||v[4]>v[5]||v[6]>v[7])bad=1;
    if(bad){
      err_msg("All values must be positive with alpha_min<=alpha_max,\n(D alpha)_min<=(D alpha)_max, Delta_min<=Delta_max");
      return;
    }
    MF_LEN=v[0];
    MF_INIT=v[1];
    MF_AMIN=v[2];
    MF_AMAX=v[3];
    MF_DAMIN=v[4];
    MF_DAMAX=v[5];
    MF_DMIN=v[6];
    MF_DMAX=v[7];
  }
}

/* ------------------------------------------------------------------ */
/*  stable manifold of a saddle of a planar map                        */
/* ------------------------------------------------------------------ */

static const char *why_text(int w)
{
  switch(w){
  case MF_STOP_BOX:  return "left the computational region";
  case MF_STOP_LEN:  return "reached the requested arclength";
  case MF_STOP_PTS:  return "reached the maximum number of points";
  case MF_STOP_STEP: return "step fell below Delta_min (very sharp fold?)";
  case MF_STOP_MEM:  return "out of memory";
  }
  return "stopped";
}


/* Accurate saddle data.  The fixed point and the eigenvector handed over by
   the singular point code are only good to about NEWT_ERR (forward
   differences), but the manifold algorithm needs the first points on the
   manifold to many digits.  Polish the fixed point by Newton's method with
   central differences and compute the stable multiplier and eigenvector of
   the 2x2 Jacobian directly. */
static void map_jac2(XppMap *m,const double *p,double J[4])
{
  int j;
  for(j=0;j<2;j++){
    double q[2],a[2],b[2];
    double h=1e-6*(fabs(p[j])>1.0?fabs(p[j]):1.0);
    q[0]=p[0];
    q[1]=p[1];
    q[j]=p[j]+h;
    xpp_map2(q,a,m);
    q[j]=p[j]-h;
    xpp_map2(q,b,m);
    J[0+j]=(a[0]-b[0])/(2.0*h);
    J[2+j]=(a[1]-b[1])/(2.0*h);
  }
}

static int map_saddle_data(XppMap *m,double *p,double *lam,double *v)
{
  double J[4],F[2],r0,r1,det,tr,disc,l1,l2,ls,vn;
  int it;
  for(it=0;it<30;it++){
    xpp_map2(p,F,m);
    r0=F[0]-p[0];
    r1=F[1]-p[1];
    if(fabs(r0)+fabs(r1)<1e-14)break;
    map_jac2(m,p,J);
    J[0]-=1.0;
    J[3]-=1.0;
    det=J[0]*J[3]-J[1]*J[2];
    if(det==0.0)return 0;
    p[0]-=(J[3]*r0-J[1]*r1)/det;
    p[1]-=(-J[2]*r0+J[0]*r1)/det;
  }
  map_jac2(m,p,J);
  tr=J[0]+J[3];
  det=J[0]*J[3]-J[1]*J[2];
  disc=tr*tr-4.0*det;
  if(disc<=0.0)return 0;
  l1=0.5*(tr+sqrt(disc));
  l2=0.5*(tr-sqrt(disc));
  if(fabs(l1)<1.0&&fabs(l2)>1.0)ls=l1;
  else if(fabs(l2)<1.0&&fabs(l1)>1.0)ls=l2;
  else return 0;
  v[0]=J[1];
  v[1]=ls-J[0];
  vn=sqrt(v[0]*v[0]+v[1]*v[1]);
  if(vn<1e-10*(fabs(J[0])+fabs(J[1])+fabs(J[2])+fabs(J[3]))){
    v[0]=ls-J[3];
    v[1]=J[2];
    vn=sqrt(v[0]*v[0]+v[1]*v[1]);
  }
  if(vn==0.0)return 0;
  v[0]/=vn;
  v[1]/=vn;
  *lam=ls;
  return 1;
}

/* x: the fixed point, lambda: the stable multiplier, evec its eigenvector.
   Called from the singular point routine. */
void map_stable_manifold(double *x,double lambda,double *evec,int n)
{
  MfParams par;
  MfBranch br[2];
  XppMap m;
  double w,h,p[2],v[2];
  int i,b,ret;
  OvChain *c;

  if(METHOD!=0)return;
  if(n!=2){
    plintf("Stable manifold of maps: only for two-dimensional maps\n");
    return;
  }
  if(MyGraph->ThreeDFlag||MyGraph->xv[0]!=1||MyGraph->yv[0]!=2){
    err_msg("Plot variable 1 vs variable 2 to compute the stable manifold");
    return;
  }
  for(i=0;i<NODE;i++)m.base[i]=x[i];
  m.i1=0;
  m.i2=1;
  p[0]=x[0];
  p[1]=x[1];
  if(!map_saddle_data(&m,p,&lambda,v)){
    err_msg("Could not compute the saddle accurately");
    return;
  }
  m.base[0]=p[0];
  m.base[1]=p[1];
  w=MyGraph->xmax-MyGraph->xmin;
  h=MyGraph->ymax-MyGraph->ymin;
  memset(&par,0,sizeof(par));
  par.delta0=MF_INIT;
  par.dmin=MF_DMIN;
  par.dmax=MF_DMAX;
  par.amin=MF_AMIN;
  par.amax=MF_AMAX;
  par.devmin=MF_DAMIN;
  par.dev=MF_DAMAX;
  par.maxlen=MF_LEN;
  par.maxpts=200000;
  /* computational box: the window enlarged by half its size on each side;
     for a negative multiplier the branches need each other's images */
  par.xlo=MyGraph->xmin-0.5*w;
  par.xhi=MyGraph->xmax+0.5*w;
  par.ylo=MyGraph->ymin-0.5*h;
  par.yhi=MyGraph->ymax+0.5*h;

  plintf("Stable manifold of the saddle at (%.10g,%.10g), stable multiplier %.10g\n",p[0],p[1],lambda);
  plintf("To repeat: @ MFLEN=%.10g,MFINIT=%.10g,MFAMIN=%.10g,MFAMAX=%.10g,MFDAMIN=%.10g,MFDAMAX=%.10g,MFDMIN=%.10g,MFDMAX=%.10g\n",
	 MF_LEN,MF_INIT,MF_AMIN,MF_AMAX,MF_DAMIN,MF_DAMAX,MF_DMIN,MF_DMAX);
  ret=mf_stable_manifold(xpp_map2,&m,p,v,lambda,&par,br);
  if(ret!=0){
    err_msg("Could not start the stable manifold computation");
    return;
  }
  for(b=0;b<2;b++){
    c=ov_new(StableManifoldColor,1,2);
    for(i=1;i<br[b].n;i++)
      ov_seg(c,br[b].x[i-1],br[b].y[i-1],br[b].x[i],br[b].y[i]);
    plintf("Stable manifold, branch %d: %d points, arclength %g; %s\n",
	   b+1,br[b].n,br[b].len,why_text(br[b].why));
    mf_free(&br[b]);
  }
  redraw_the_graph();
}

/* ------------------------------------------------------------------ */
/*  cobweb                                                             */
/*                                                                     */
/*  The cobweb is not stored: it is recomputed every time the graph is */
/*  redrawn, from the current parameters, initial condition, Numerics  */
/*  total/transient and plot window, so that it follows sliders and    */
/*  parameter edits.                                                   */
/* ------------------------------------------------------------------ */

#define CW_MAXITER 100000
#define CW_NCURVE 400
#define CW_SYMSIZE .00175   /* same as the Sing pts symbols */

static double cw_xlo=0.0,cw_xhi=1.0;

static double cw_f(int iv,double x)
{
  double in[MAXODE],out[MAXODE];
  int i;
  for(i=0;i<NODE;i++)in[i]=last_ic[i];
  in[iv]=x;
  (*rhs)(0.0,in,out,NODE);
  return out[iv];
}

static int cw_good(double a)
{
  return (a==a)&&(fabs(a)<1e30);
}

static void cobweb_draw(void)
{
  int iv=cw_ivar,i,n,ntrans;
  double fv[CW_NCURVE+1];
  double lo=MyGraph->xmin,hi=MyGraph->xmax,dx,x,y,yn,xn;
  double dt=fabs(DELTA_T);
  if(dt<=0.0)dt=1.0;
  n=(int)(TEND/dt+0.5);
  ntrans=(int)(TRANS/dt+0.5);
  if(n>CW_MAXITER)n=CW_MAXITER;
  if(ntrans>CW_MAXITER)ntrans=CW_MAXITER;
  /* diagonal */
  set_linestyle(YNullColor);
  line_abs((float)lo,(float)lo,(float)hi,(float)hi);
  /* graph of f over the window */
  set_linestyle(XNullColor);
  dx=(hi-lo)/(double)CW_NCURVE;
  x=lo;
  y=cw_f(iv,x);
  fv[0]=y;
  for(i=1;i<=CW_NCURVE;i++){
    xn=lo+i*dx;
    yn=cw_f(iv,xn);
    fv[i]=yn;
    if(cw_good(y)&&cw_good(yn))line_abs((float)x,(float)y,(float)xn,(float)yn);
    x=xn;
    y=yn;
  }
  /* the orbit of the initial condition */
  set_linestyle(0);
  x=last_ic[iv];
  for(i=0;i<ntrans;i++){
    x=cw_f(iv,x);
    if(!cw_good(x))goto fixed;
  }
  for(i=0;i<n;i++){
    y=cw_f(iv,x);
    if(!cw_good(y))break;
    line_abs((float)x,(float)x,(float)x,(float)y);   /* to the graph of f */
    line_abs((float)x,(float)y,(float)y,(float)y);   /* to the diagonal   */
    x=y;
  }
fixed:
  /* fixed points in the window: circle = stable, box = unstable, drawn
     exactly as Sing pts draws its symbols (eq_symb) */
  set_linestyle(0);   /* black, as Sing pts draws them */
  {
    int nroot=0,bi;
    for(i=0;i<=CW_NCURVE&&nroot<50;i++){
      double g0=fv[i]-(lo+i*dx),g1,a,b,ga,xr,h,d,mult;
      if(!cw_good(fv[i]))continue;
      if(g0==0.0){
	xr=lo+i*dx;
      } else {
	if(i==CW_NCURVE||!cw_good(fv[i+1]))continue;
	g1=fv[i+1]-(lo+(i+1)*dx);
	if(!(g0*g1<0.0))continue;
	a=lo+i*dx;
	b=a+dx;
	ga=g0;
	for(bi=0;bi<60;bi++){
	  double m=0.5*(a+b),gm=cw_f(iv,m)-m;
	  if(gm==0.0){a=b=m;break;}
	  if(ga*gm<0.0)b=m;
	  else {a=m;ga=gm;}
	}
	xr=0.5*(a+b);
      }
      nroot++;
      h=1e-6*(fabs(xr)>1.0?fabs(xr):1.0);
      d=cw_f(iv,xr+h)-cw_f(iv,xr-h);
      mult=d/(2.0*h);
      if(!cw_good(mult))continue;
      if(fabs(mult)<1.0){
	draw_symbol((float)xr,(float)xr,CW_SYMSIZE,3);   /* stable   */
      } else
	draw_symbol((float)xr,(float)xr,CW_SYMSIZE,0);   /* unstable */
      point_abs((float)xr,(float)xr);
    }
  }
}

/* called after parameters or initial conditions change */
void map_cobweb_refresh(void)
{
  if(cw_active&&METHOD==0&&MyGraph->xv[0]==cw_ivar+1&&
     MyGraph->yv[0]==cw_ivar+1&&!MyGraph->ThreeDFlag)
    redraw_the_graph();
}

void do_cobweb(void)
{
  static char *nm[]={"*0Variable","Xmin","Xmax"};
  char values[3][MAX_LEN_SBOX];
  int status,i,xv=MyGraph->xv[0];
  double lo,hi;

  if(METHOD!=0||NODE!=1){
    err_msg("Cobwebbing is only for one-dimensional discrete maps");
    return;
  }
  if(xv<1||xv>NODE)xv=1;
  /* take the current window if it is already a cobweb view */
  if(MyGraph->xv[0]==MyGraph->yv[0]&&MyGraph->xmin==MyGraph->ymin&&
     MyGraph->xmax==MyGraph->ymax){
    cw_xlo=MyGraph->xmin;
    cw_xhi=MyGraph->xmax;
  }
  sprintf(values[0],"%s",uvar_names[xv-1]);
  sprintf(values[1],"%g",cw_xlo);
  sprintf(values[2],"%g",cw_xhi);
  status=do_string_box(3,3,1,"Cobweb",nm,values,25);
  if(status==0)return;
  find_variable(values[0],&i);
  if(i<1||i>NODE){
    err_msg("Choose a state variable");
    return;
  }
  lo=atof(values[1]);
  hi=atof(values[2]);
  if(!(hi>lo)){
    err_msg("Need Xmin<Xmax");
    return;
  }
  cw_xlo=lo;
  cw_xhi=hi;
  cw_ivar=i-1;
  cw_active=1;

  /* view: variable against itself, square window */
  MyGraph->xv[0]=i;
  MyGraph->yv[0]=i;
  MyGraph->xmin=MyGraph->ymin=lo;
  MyGraph->xmax=MyGraph->ymax=hi;
  MyGraph->xlo=MyGraph->ylo=lo;
  MyGraph->xhi=MyGraph->yhi=hi;
  sprintf(MyGraph->xlabel,"%s(n)",uvar_names[cw_ivar]);
  sprintf(MyGraph->ylabel,"%s(n+1)",uvar_names[cw_ivar]);
  MyGraph->TimeFlag=0;
  MyGraph->ThreeDFlag=0;
  redraw_the_graph();
}
