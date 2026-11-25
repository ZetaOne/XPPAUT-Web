#include "mapmanifold.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define MF_NSAMP 32      /* samples on the search arc                    */
#define MF_WIN   40      /* forward window (segments) for the search     */
#define MF_BISECT 60

static int mf_ok(double a)
{
  return (a==a)&&(fabs(a)<1e100);
}

static int mf_push(MfBranch *b,double x,double y,int idx)
{
  if(b->n>=b->cap){
    int nc=2*b->cap+16;
    double *nx=(double *)realloc(b->x,nc*sizeof(double));
    double *ny;
    int *ni;
    if(nx==NULL)return 0;
    b->x=nx;
    ny=(double *)realloc(b->y,nc*sizeof(double));
    if(ny==NULL)return 0;
    b->y=ny;
    ni=(int *)realloc(b->idx,nc*sizeof(int));
    if(ni==NULL)return 0;
    b->idx=ni;
    b->cap=nc;
  }
  b->x[b->n]=x;
  b->y[b->n]=y;
  b->idx[b->n]=idx;
  b->n++;
  return 1;
}

void mf_free(MfBranch *b)
{
  if(b->x)free(b->x);
  if(b->y)free(b->y);
  if(b->idx)free(b->idx);
  b->x=b->y=NULL;
  b->idx=NULL;
  b->n=b->cap=0;
}

/* proper intersection of segments a1a2 and b1b2 */
static int mf_seg_cross(double a1x,double a1y,double a2x,double a2y,
			double b1x,double b1y,double b2x,double b2y)
{
  double dx=a2x-a1x,dy=a2y-a1y;
  double ex=b2x-b1x,ey=b2y-b1y;
  double den=dx*ey-dy*ex;
  double fx=b1x-a1x,fy=b1y-a1y;
  double t,u;
  if(den==0.0)return 0;
  t=(fx*ey-fy*ex)/den;
  u=(fx*dy-fy*dx)/den;
  return (t>=0.0&&t<=1.0&&u>=0.0&&u<=1.0);
}

typedef struct {
  MapFn F;
  void *ctx;
} MfEval;

static int mf_img(MfEval *E,double zx,double zy,double *wx,double *wy)
{
  double z[2],w[2];
  z[0]=zx;
  z[1]=zy;
  w[0]=w[1]=0.0;
  if(!E->F(z,w,E->ctx))return 0;
  if(!mf_ok(w[0])||!mf_ok(w[1]))return 0;
  *wx=w[0];
  *wy=w[1];
  return 1;
}

/* ---- high-order interpolation of the (already computed) target ----
   The target branch is a polyline whose vertices lie on the manifold.
   Testing the image of the search arc against the chords would be limited
   by the chord error O(h^2), which can be large compared with the normal
   spread of the image of the arc when stable and unstable directions are
   nearly parallel.  Hence every segment is replaced by a cubic through
   the four neighbouring vertices (Lagrange form in chord-length
   parameter, error O(h^4)), subdivided into MF_SUB pieces.              */

#define MF_SUB 4

/* points u_q=q/MF_SUB, q=0..MF_SUB of the interpolant on segment j */
static void mf_hermite(const MfBranch *T,int j,double *px,double *py)
{
  int n=T->n,a,m,i,l,q;
  double s[4],X[4],Y[4];
  double s0;
  a=j-1;
  if(a>n-4)a=n-4;
  if(a<0)a=0;
  m=n-a;
  if(m>4)m=4;
  s[0]=0.0;
  X[0]=T->x[a];
  Y[0]=T->y[a];
  for(i=1;i<m;i++){
    double dx=T->x[a+i]-T->x[a+i-1],dy=T->y[a+i]-T->y[a+i-1];
    s[i]=s[i-1]+sqrt(dx*dx+dy*dy);
    X[i]=T->x[a+i];
    Y[i]=T->y[a+i];
  }
  s0=s[j-a];
  for(q=0;q<=MF_SUB;q++){
    double u=(double)q/(double)MF_SUB;
    double sv=s0+u*(s[j-a+1]-s0);
    double vx=0.0,vy=0.0;
    for(i=0;i<m;i++){
      double L=1.0;
      for(l=0;l<m;l++){
	if(l==i)continue;
	L*=(sv-s[l])/(s[i]-s[l]);
      }
      vx+=L*X[i];
      vy+=L*Y[i];
    }
    px[q]=vx;
    py[q]=vy;
  }
}

/* signed distance of w from the line through a->b */
static double mf_sd2(double ax,double ay,double bx,double by,
		     double wx,double wy)
{
  double dx=bx-ax,dy=by-ay;
  double l=sqrt(dx*dx+dy*dy);
  if(l==0.0)return 0.0;
  return (dx*(wy-ay)-dy*(wx-ax))/l;
}

/* Find the next point on branch B (>=3 points) using search circle of
   radius Delta.  T is the branch that contains F(B).  Returns 1 on success
   and fills *zx,*zy,*jhit,*alpha. */
static int mf_find_next(MfEval *E,const MfBranch *B,const MfBranch *T,
			double Delta,double *zx,double *zy,int *jhit,
			double *alpha,double amax)
{
  int k=B->n-1;
  double cx=B->x[k],cy=B->y[k];
  double thc=atan2(B->y[k]-B->y[k-1],B->x[k]-B->x[k-1]);
  double thp=thc;      /* centre of the search arc (curvature predicted) */
  double th[MF_NSAMP+1],wx[MF_NSAMP+1],wy[MF_NSAMP+1];
  int val[MF_NSAMP+1];
  int i,j,q,pass,nseg=T->n-1;
  int lo,hi,bi=-1,bj=-1,bq=-1;
  double bd=1e30;
  double hx[MF_SUB+1],hy[MF_SUB+1];

  if(nseg<1)return 0;
  if(k>=2){
    /* extrapolate the turning of the last two chords */
    double dx1=B->x[k-1]-B->x[k-2],dy1=B->y[k-1]-B->y[k-2];
    double dx2=B->x[k]-B->x[k-1],dy2=B->y[k]-B->y[k-1];
    double l1=sqrt(dx1*dx1+dy1*dy1),l2=sqrt(dx2*dx2+dy2*dy2);
    double a1=atan2(dy1,dx1);
    double turn=thc-a1;
    while(turn>M_PI)turn-=2.0*M_PI;
    while(turn<-M_PI)turn+=2.0*M_PI;
    if(l1>0.0&&l2>0.0){
      double curv=turn/(0.5*(l1+l2));
      double pred=curv*0.5*(l2+Delta);
      if(pred>amax)pred=amax;
      if(pred<-amax)pred=-amax;
      thp=thc+pred;
    }
  }
  for(i=0;i<=MF_NSAMP;i++){
    th[i]=thp+amax*(-1.0+2.0*(double)i/(double)MF_NSAMP);
    val[i]=mf_img(E,cx+Delta*cos(th[i]),cy+Delta*sin(th[i]),&wx[i],&wy[i]);
  }
  lo=B->idx[k]-2;
  if(lo<0)lo=0;
  hi=B->idx[k]+MF_WIN;
  if(hi>nseg-1)hi=nseg-1;
  for(pass=0;pass<2;pass++){
    for(j=lo;j<=hi;j++){
      mf_hermite(T,j,hx,hy);
      for(q=0;q<MF_SUB;q++){
	for(i=0;i<MF_NSAMP;i++){
	  double d;
	  if(!val[i]||!val[i+1])continue;
	  d=fabs(0.5*(th[i]+th[i+1])-thp);
	  if(d>=bd)continue;
	  if(mf_seg_cross(wx[i],wy[i],wx[i+1],wy[i+1],
			  hx[q],hy[q],hx[q+1],hy[q+1])){
	    bd=d;
	    bi=i;
	    bj=j;
	    bq=q;
	  }
	}
      }
    }
    if(bi>=0)break;
    if(lo==0&&hi==nseg-1)break;   /* already searched everything */
    lo=0;
    hi=nseg-1;
  }
  if(bi<0)return 0;

  /* refine by bisection on the signed distance to the Hermite piece */
  {
    double ax,ay,bx,by;
    double ta=th[bi],tb=th[bi+1];
    double ga,gb;
    double tm=0.5*(ta+tb),gm,mx=0.0,my=0.0;
    double dx,dy,t;
    int it;
    mf_hermite(T,bj,hx,hy);
    ax=hx[bq];
    ay=hy[bq];
    bx=hx[bq+1];
    by=hy[bq+1];
    ga=mf_sd2(ax,ay,bx,by,wx[bi],wy[bi]);
    gb=mf_sd2(ax,ay,bx,by,wx[bi+1],wy[bi+1]);
    if(ga*gb>0.0)return 0;
    for(it=0;it<MF_BISECT;it++){
      tm=0.5*(ta+tb);
      if(!mf_img(E,cx+Delta*cos(tm),cy+Delta*sin(tm),&mx,&my))return 0;
      gm=mf_sd2(ax,ay,bx,by,mx,my);
      if(gm==0.0)break;
      if(ga*gm<0.0){tb=tm;gb=gm;}
      else {ta=tm;ga=gm;}
      if(fabs(tb-ta)<1e-14)break;
    }
    if(!mf_img(E,cx+Delta*cos(tm),cy+Delta*sin(tm),&mx,&my))return 0;
    /* the image must really lie on the piece (allow a little slack) */
    dx=bx-ax;
    dy=by-ay;
    t=((mx-ax)*dx+(my-ay)*dy)/(dx*dx+dy*dy);
    if(t<-0.3||t>1.3)return 0;
    *zx=cx+Delta*cos(tm);
    *zy=cy+Delta*sin(tm);
    *jhit=bj;
    *alpha=fabs(tm-thc);
  }
  return 1;
}

/* one accepted step for branch B; returns 1 if a point was added */
static int mf_step(MfEval *E,MfBranch *B,const MfBranch *T,const MfParams *par)
{
  double zx,zy,alpha;
  int j;
  while(1){
    if(B->Delta<par->dmin){
      B->active=0;
      B->why=MF_STOP_STEP;
      return 0;
    }
    if(!mf_find_next(E,B,T,B->Delta,&zx,&zy,&j,&alpha,par->amax)){
      B->Delta*=0.5;
      continue;
    }
    if(alpha>2.0*par->amax||
       (alpha*B->Delta>par->dev&&B->Delta>2.0*par->dmin)){
      B->Delta*=0.5;
      continue;
    }
    break;
  }
  if(!mf_push(B,zx,zy,j)){
    B->active=0;
    B->why=MF_STOP_MEM;
    return 0;
  }
  B->len+=B->Delta;
  if(alpha<par->amin&&alpha*B->Delta<par->devmin){
    B->Delta*=1.5;
    if(B->Delta>par->dmax)B->Delta=par->dmax;
  }
  if(zx<par->xlo||zx>par->xhi||zy<par->ylo||zy>par->yhi){
    B->active=0;
    B->why=MF_STOP_BOX;
  } else if(B->len>=par->maxlen){
    B->active=0;
    B->why=MF_STOP_LEN;
  } else if(B->n>=par->maxpts){
    B->active=0;
    B->why=MF_STOP_PTS;
  }
  return 1;
}

int mf_stable_manifold(MapFn F,void *ctx,const double *p,const double *v,
		       double lambda,const MfParams *par,MfBranch br[2])
{
  MfEval E;
  int b,alive;
  double al=fabs(lambda);
  double vn=sqrt(v[0]*v[0]+v[1]*v[1]);
  double ux,uy,d1,d2;
  if(!(al>0.0&&al<1.0)||vn==0.0||par->delta0<=0.0)return 1;
  E.F=F;
  E.ctx=ctx;
  ux=v[0]/vn;
  uy=v[1]/vn;
  d1=par->delta0;
  d2=par->delta0/al;
  for(b=0;b<2;b++){
    double s=(b==0)?1.0:-1.0;
    memset(&br[b],0,sizeof(MfBranch));
    br[b].active=1;
    if(!mf_push(&br[b],p[0],p[1],0)||
       !mf_push(&br[b],p[0]+s*d1*ux,p[1]+s*d1*uy,0)||
       !mf_push(&br[b],p[0]+s*d2*ux,p[1]+s*d2*uy,0)){
      mf_free(&br[0]);
      mf_free(&br[1]);
      return 2;
    }
    br[b].len=d2;
    br[b].Delta=d2-d1;
    if(br[b].Delta<par->dmin*4.0)br[b].Delta=par->dmin*4.0;
  }
  do{
    alive=0;
    for(b=0;b<2;b++){
      /* if lambda>0 the image of a branch lies on itself, otherwise on
	 the other branch */
      const MfBranch *T=(lambda>0.0)?&br[b]:&br[1-b];
      if(!br[b].active)continue;
      mf_step(&E,&br[b],T,par);
      if(br[b].active)alive=1;
    }
  }while(alive);
  return 0;
}
